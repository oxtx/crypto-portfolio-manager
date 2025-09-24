import 'dotenv/config';
import { pool } from 'lib/dbPool';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const { rows: values } = await client.query(`
      with latest_prices as (
        select distinct on (token_symbol) token_symbol, price_usd
        from token_prices
        order by token_symbol, fetched_at desc
      )
      select h.user_id,
             coalesce(sum(h.total_amount * lp.price_usd),0) as total_value
      from holdings h
      left join latest_prices lp using (token_symbol)
      group by h.user_id
    `);

    const now = new Date();
    for (const v of values) {
      await client.query(
        `insert into portfolio_values(user_id, total_value_usd, calculated_at)
         values ($1,$2,$3)`,
        [v.user_id, v.total_value, now]
      );
      await client.query(
        `insert into portfolio_values_latest(user_id, total_value_usd, calculated_at)
         values ($1,$2,$3)
         on conflict (user_id) do update
           set total_value_usd = EXCLUDED.total_value_usd,
               calculated_at = EXCLUDED.calculated_at`,
        [v.user_id, v.total_value, now]
      );
    }

    await client.query(`
      update portfolio_values_latest l
      set pct_gain_24h = case
        when old_snapshot.total_value_usd > 0 then
          round(((l.total_value_usd - old_snapshot.total_value_usd)/old_snapshot.total_value_usd)*100, 6)
        else null end
      from lateral (
        select pv.total_value_usd
        from portfolio_values pv
        where pv.user_id = l.user_id
          and pv.calculated_at <= now() - interval '24 hours'
        order by pv.calculated_at desc
        limit 1
      ) old_snapshot
      where true;
    `);

    await client.query('commit');
    console.log('Portfolio values updated');
  } catch (e: any) {
    await client.query('rollback');
    console.error('Compute failure:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
