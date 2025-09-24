import { serviceClient } from 'lib/supabaseClient';
import 'dotenv/config';

const userId = process.argv[2];

if (!userId) {
  console.error('Usage: ts-node manualInsertTx.ts <USER_ID>');
  process.exit(1);
}

(async () => {
  const { data, error } = await serviceClient.from('transactions')
    .insert([{
      user_id: userId,
      token_symbol: 'BTC',
      tx_type: 'BUY',
      amount: '0.01',
      occurred_at: new Date().toISOString()
    }])
    .select('*');

  console.log('Inserted transaction:', data, error);

  const holdings = await serviceClient.from('holdings')
    .select('*')
    .eq('user_id', userId);

  console.log('Holdings now:', holdings.data);
})();
