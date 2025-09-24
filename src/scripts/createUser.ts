import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { data, error } = await client.auth.admin.createUser({
    email: 'alice@example.com',
    password: 'Passw0rd!',
    email_confirm: true
  });
  console.log('User create result:', data, error);
})();
