# alongCrypto Portfolio Manager

Minimal backend scaffold for:
- Importing crypto transactions (CSV)
- Maintaining per‑user holdings (incremental triggers)
- Fetching token prices (Coingecko)
- Computing portfolio USD values
- Leaderboard snapshots

## Stack
- Supabase (Postgres + Auth + Storage)
- TypeScript (Node 18+)
- Jobs: plain Node scripts (cron-capable)

## Quick Start (Local)
```bash
git clone https://github.com/oxtx/crypto-portfolio-manager
cd crypto-portfolio-manager
npm install
supabase start
supabase migration up
npx ts-node src/scripts/seedTokens.ts
npx ts-node -r dotenv/config src/scripts/createUser.ts   # note the user_id
npx ts-node src/scripts/manualInsertTx.ts <USER_ID>
npm run job:prices
npm run job:portfolio
npm run job:leaderboard
