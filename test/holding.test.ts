import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const service = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

describe('Holdings trigger', () => {
  it('updates holdings on insert', async () => {
    // create temp user
    const { data: usr } = await service.auth.admin.createUser({
      email: `test_${Date.now()}@example.com`,
      password: 'Secret123!',
      email_confirm: true
    });
    const userId = usr?.user?.id!;
    await service.from('transactions').insert([{
      user_id: userId,
      token_symbol: 'BTC',
      tx_type: 'BUY',
      amount: '0.005',
      occurred_at: new Date().toISOString()
    }]);

    const { data: holdings } = await service.from('holdings')
      .select('*')
      .eq('user_id', userId)
      .eq('token_symbol', 'BTC')
      .single();

    expect(holdings?.total_amount).toBe('0.005');
  });
});
