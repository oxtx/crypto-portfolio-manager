import 'dotenv/config';
import { pool } from 'lib/dbPool';
import { createClient } from '@supabase/supabase-js';
import { Parser } from 'json2csv';

async function main() {
  const supa = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: pending } = await supa.from('export_requests')
    .select('*')
    .eq('status','PENDING')
    .limit(10);

  if (!pending || !pending.length) {
    console.log('No pending exports');
    return;
  }

  for (const req of pending) {
    await supa.from('export_requests').update({ status: 'GENERATING' }).eq('id', req.id);

    const { rows } = await pool.query(`
      with lp as (
        select distinct on (token_symbol) token_symbol, price_usd
        from token_prices
        order by token_symbol, fetched_at desc
      )
      select h.token_symbol,
             h.total_amount,
             (h.total_amount * lp.price_usd) as value_usd
      from holdings h
      left join lp using (token_symbol)
      where h.user_id = $1
    `, [req.user_id]);

    if (req.format === 'CSV') {
      const parser = new Parser({ fields: ['token_symbol','total_amount','value_usd'] });
      const csv = parser.parse(rows);
      // For MVP store inline (better: upload to storage)
      await supa.from('export_requests').update({
        status: 'READY',
        result_url: 'data:text/csv;base64,' + Buffer.from(csv).toString('base64'),
        completed_at: new Date().toISOString()
      }).eq('id', req.id);
    } else {
      await supa.from('export_requests').update({
        status: 'READY',
        result_url: 'data:application/json;base64,' + Buffer.from(JSON.stringify(rows)).toString('base64'),
        completed_at: new Date().toISOString()
      }).eq('id', req.id);
    }
  }
  console.log('Exports processed');
  await pool.end();
}

main();
