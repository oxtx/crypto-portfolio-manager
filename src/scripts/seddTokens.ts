import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const service = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const tokens = [
  { symbol: 'BTC', name: 'Bitcoin', coingecko_id: 'bitcoin', decimals: 8 },
  { symbol: 'ETH', name: 'Ethereum', coingecko_id: 'ethereum', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin', coingecko_id: 'usd-coin', decimals: 6 }
];

(async () => {
  for (const t of tokens) {
    const { error } = await service.from('tokens').insert(t).single();
    if (error && !/duplicate/i.test(error.message)) {
      console.error('Insert error', t.symbol, error.message);
    }
  }
  console.log('Seed done');
})();
