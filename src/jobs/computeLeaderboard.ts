import 'dotenv/config';
import { pool } from 'lib/dbPool';

async function main() {
  const client = await pool.connect();
  const snapshotAt = new Date();
  try {
    await client.query('begin');
    const { rows } = await client.query(`
      select user_id,
             total_value_usd,
             pct_gain_24h,
             dense_rank() over(order by total_value_usd desc) as rk
      from portfolio_values_latest
    `);

    for (const r of rows) {
      await client.query(
        `insert into leaderboard_snapshots (snapshot_at, user_id, rank, total_value_usd, pct_gain_24h)
         values ($1,$2,$3,$4,$5)`,
        [snapshotAt, r.user_id, r.rk, r.total_value_usd, r.pct_gain_24h]
      );
    }
    await client.query('commit');
    console.log('Leaderboard snapshot at', snapshotAt.toISOString());
  } catch (e: any) {
    await client.query('rollback');
    console.error('Leaderboard failure:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
