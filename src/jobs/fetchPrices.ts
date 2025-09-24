import 'dotenv/config';
import fetch from 'node-fetch';
import { pool } from 'lib/dbPool';

async function main() {
    const { rows: tokens } = await pool.query(
        `select symbol, coingecko_id from tokens where coingecko_id is not null and is_active = true`
    );

    if (tokens.length === 0) {
        console.log('No tokens to price');
        return;
    }

    const ids = tokens.map(t => t.coingeckoid || t.coingecko_id).join(',');
    const url = `${process.env.COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd`;

    const res = await fetch(url);
    if (!res.ok) {
        console.error('Coingecko error:', res.status, await res.text());
        return;
    }
    const raw = await res.json();
    if (typeof raw !== 'object' || raw === null) {
        console.error('Unexpected Coingecko payload shape');
        return;
    }
    const json = raw as Record<string, { usd?: number }>;
    const client = await pool.connect();
    try {
        await client.query('begin');
        for (const t of tokens) {
            const price = json[t.coingecko_id]?.usd;
            if (price === undefined) continue;
            await client.query(
                `insert into token_prices (token_symbol, price_usd, source, fetched_at)
         values ($1,$2,'coingecko', now())`,
                [t.symbol, price]
            );
        }
        await client.query('commit');
        console.log('Prices inserted');
    } catch (e: any) {
        await client.query('rollback');
        console.error('Insert failure:', e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
