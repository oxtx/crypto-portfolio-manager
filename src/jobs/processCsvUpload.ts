import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { pool } from 'lib/dbPool';
import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = 500;

async function processLocalFile(userId: string, filePath: string) {
  const supa = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const filename = path.basename(filePath);
  const uploadRes = await supa.from('csv_uploads').insert({
    user_id: userId,
    filename,
    status: 'UPLOADED'
  }).select('id').single();
  if (uploadRes.error) throw uploadRes.error;
  const uploadId = uploadRes.data.id;

  await supa.from('csv_uploads').update({ status: 'PROCESSING' }).eq('id', uploadId);

  const rowsValid: any[] = [];
  const errors: any[] = [];
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true }))
      .on('data', (row) => {
        total++;
        const errs: string[] = [];
        if (!row.token_symbol) errs.push('token_symbol missing');
        if (!row.tx_type) errs.push('tx_type missing');
        if (!row.amount || isNaN(Number(row.amount)) || Number(row.amount) <= 0) errs.push('amount invalid');
        if (!row.occurred_at || isNaN(Date.parse(row.occurred_at))) errs.push('occurred_at invalid');

        if (errs.length) {
          errors.push({ row: total, errors: errs });
        } else {
          rowsValid.push({
            user_id: userId,
            external_tx_id: row.external_tx_id || null,
            token_symbol: row.token_symbol,
            tx_type: row.tx_type,
            amount: row.amount,
            occurred_at: row.occurred_at,
            source_file_id: uploadId
          });
        }
      })
      .on('error', reject)
      .on('end', () => resolve());
  });

  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query('begin');
    while (rowsValid.length) {
      const batch = rowsValid.splice(0, BATCH_SIZE);
      const cols = ['user_id','external_tx_id','token_symbol','tx_type','amount','occurred_at','source_file_id'];
      const values: string[] = [];
      const params: any[] = [];

      batch.forEach((r, i) => {
        const base = i * cols.length;
        params.push(r.user_id, r.external_tx_id, r.token_symbol, r.tx_type, r.amount, r.occurred_at, r.source_file_id);
        values.push(
          `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`
        );
      });

      await client.query(
        `insert into transactions (user_id, external_tx_id, token_symbol, tx_type, amount, occurred_at, source_file_id)
         values ${values.join(',')}
         on conflict (user_id, external_tx_id) where external_tx_id is not null do nothing`,
        params
      );
      processed += batch.length;
    }
    await client.query('commit');
  } catch (e: any) {
    await client.query('rollback');
    errors.push({ fatal: e.message });
  } finally {
    client.release();
  }

  const status =
    errors.length && processed
      ? 'PARTIAL'
      : errors.length && !processed
        ? 'FAILED'
        : 'COMPLETED';

  await supa.from('csv_uploads').update({
    status,
    total_rows: total,
    processed_rows: processed,
    invalid_rows: errors.length,
    errors,
    completed_at: new Date().toISOString()
  }).eq('id', uploadId);

  console.log(`Upload ${uploadId} status=${status} processed=${processed}/${total} errors=${errors.length}`);
}

(async () => {
  const userId = process.argv[2];
  const file = process.argv[3];
  if (!userId || !file) {
    console.error('Usage: ts-node processCsvUpload.ts <USER_ID> <CSV_PATH>');
    process.exit(1);
  }
  await processLocalFile(userId, file);
  await pool.end();
})();
