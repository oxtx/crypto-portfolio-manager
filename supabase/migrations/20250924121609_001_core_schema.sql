-- ENABLE EXTENSIONS
create extension if not exists "pgcrypto";

-- TOKENS
create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  name text,
  coingecko_id text unique,
  decimals int not null default 18,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- CSV UPLOADS
create table public.csv_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  filename text not null,
  status text not null check(status in ('UPLOADED','PROCESSING','COMPLETED','FAILED','PARTIAL')),
  total_rows int default 0,
  processed_rows int default 0,
  invalid_rows int default 0,
  errors jsonb not null default '[]',
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- TRANSACTIONS
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  external_tx_id text,
  token_symbol text references public.tokens(symbol),
  tx_type text not null check (tx_type in ('BUY','SELL','TRANSFER_IN','TRANSFER_OUT','AIRDROP','STAKE','UNSTAKE')),
  amount numeric(38,18) not null check (amount > 0),
  fee numeric(38,18) default 0,
  occurred_at timestamptz not null,
  source_file_id uuid references public.csv_uploads(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.transactions
  add constraint transactions_unique_ext unique (user_id, external_tx_id) where external_tx_id is not null;

-- SIGNED AMOUNT
alter table public.transactions
  add column signed_amount numeric(38,18) generated always as (
    case
      when tx_type in ('BUY','TRANSFER_IN','AIRDROP','UNSTAKE') then amount
      else -amount
    end
  ) stored;

-- HOLDINGS
create table public.holdings (
  user_id uuid references auth.users(id) on delete cascade,
  token_symbol text references public.tokens(symbol),
  total_amount numeric(38,18) not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, token_symbol)
);

-- TOKEN PRICES
create table public.token_prices (
  token_symbol text references public.tokens(symbol),
  price_usd numeric(38,10) not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (token_symbol, fetched_at)
);

-- PORTFOLIO VALUES (HIST)
create table public.portfolio_values (
  user_id uuid references auth.users(id) on delete cascade,
  total_value_usd numeric(38,10) not null,
  total_value_change_24h numeric(38,10),
  calculated_at timestamptz not null default now(),
  primary key (user_id, calculated_at)
);

-- LATEST PORTFOLIO
create table public.portfolio_values_latest (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_value_usd numeric(38,10) not null,
  pct_gain_24h numeric(38,10),
  calculated_at timestamptz not null default now()
);

-- LEADERBOARD SNAPSHOTS
create table public.leaderboard_snapshots (
  snapshot_at timestamptz not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  rank int not null,
  total_value_usd numeric(38,10) not null,
  pct_gain_24h numeric(38,10),
  primary key (snapshot_at, user_id)
);

-- AUDIT LOGS
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- EXPORT REQUESTS
create table public.export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  format text not null check (format in ('CSV','JSON')),
  status text not null check (status in ('PENDING','GENERATING','READY','FAILED')),
  result_url text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- LATEST PRICE VIEW
create view public.tokens_latest_price as
select distinct on (token_symbol)
       token_symbol, price_usd, fetched_at
from public.token_prices
order by token_symbol, fetched_at desc;

-- INDEXES
create index idx_tx_user_time on public.transactions(user_id, occurred_at desc);
create index idx_tx_user_token on public.transactions(user_id, token_symbol);
create index idx_prices_symbol_time on public.token_prices(token_symbol, fetched_at desc);
create index idx_pv_time on public.portfolio_values(calculated_at desc);
create index idx_leaderboard_rank on public.leaderboard_snapshots(rank);

-- HOLDINGS TRIGGERS
create or replace function public.fn_holdings_after_insert()
returns trigger language plpgsql as $$
begin
  insert into public.holdings(user_id, token_symbol, total_amount, updated_at)
  values (NEW.user_id, NEW.token_symbol, NEW.signed_amount, now())
  on conflict (user_id, token_symbol)
    do update set total_amount = public.holdings.total_amount + excluded.total_amount,
                  updated_at = now();
  return NEW;
end; $$;

create or replace function public.fn_holdings_after_delete()
returns trigger language plpgsql as $$
declare new_total numeric(38,18);
begin
  update public.holdings
     set total_amount = total_amount - OLD.signed_amount,
         updated_at = now()
   where user_id = OLD.user_id and token_symbol = OLD.token_symbol
   returning total_amount into new_total;

  if new_total is not null and new_total = 0 then
    delete from public.holdings
      where user_id = OLD.user_id and token_symbol = OLD.token_symbol and total_amount = 0;
  end if;
  return OLD;
end; $$;

create or replace function public.fn_holdings_after_update()
returns trigger language plpgsql as $$
begin
  update public.holdings
     set total_amount = total_amount - OLD.signed_amount + NEW.signed_amount,
         updated_at = now()
   where user_id = NEW.user_id and token_symbol = NEW.token_symbol;
  return NEW;
end; $$;

create trigger trg_holdings_ai after insert on public.transactions
  for each row execute function public.fn_holdings_after_insert();

create trigger trg_holdings_ad after delete on public.transactions
  for each row execute function public.fn_holdings_after_delete();

create trigger trg_holdings_au after update on public.transactions
  for each row execute function public.fn_holdings_after_update();

-- AUDIT TRIGGER
create or replace function public.fn_audit_transactions()
returns trigger language plpgsql as $$
declare act text;
begin
  if TG_OP = 'INSERT' then act := 'CREATE';
  elsif TG_OP = 'UPDATE' then act := 'UPDATE';
  elsif TG_OP = 'DELETE' then act := 'DELETE';
  end if;

  insert into public.audit_logs(user_id, entity_type, entity_id, action, metadata)
  values (
    coalesce(NEW.user_id, OLD.user_id),
    'transaction',
    coalesce(NEW.id, OLD.id),
    act,
    case
      when TG_OP='DELETE' then jsonb_build_object('old', row_to_json(OLD))
      when TG_OP='UPDATE' then jsonb_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW))
      else jsonb_build_object('new', row_to_json(NEW))
    end
  );
  return coalesce(NEW, OLD);
end; $$;

create trigger trg_tx_audit
after insert or update or delete on public.transactions
for each row execute function public.fn_audit_transactions();

-- RLS ENABLE
alter table public.transactions enable row level security;
alter table public.holdings enable row level security;
alter table public.csv_uploads enable row level security;
alter table public.portfolio_values_latest enable row level security;
alter table public.portfolio_values enable row level security;
alter table public.audit_logs enable row level security;
alter table public.export_requests enable row level security;

-- RLS POLICIES
create policy "tx_select_own" on public.transactions for select using (auth.uid() = user_id);
create policy "tx_mod_own" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "holdings_select_own" on public.holdings for select using (auth.uid() = user_id);

create policy "csv_select_own" on public.csv_uploads for select using (auth.uid() = user_id);
create policy "csv_insert_own" on public.csv_uploads for insert with check (auth.uid() = user_id);

create policy "pv_latest_select_own" on public.portfolio_values_latest for select using (auth.uid() = user_id);
create policy "pv_select_own" on public.portfolio_values for select using (auth.uid() = user_id);

create policy "audit_select_own" on public.audit_logs for select using (auth.uid() = user_id);

create policy "export_select_own" on public.export_requests for select using (auth.uid() = user_id);
create policy "export_insert_own" on public.export_requests for insert with check (auth.uid() = user_id);

-- LEADERBOARD VIEW
create or replace view public.leaderboard_current as
select ls.user_id,
       ls.rank,
       ls.total_value_usd,
       ls.pct_gain_24h,
       ls.snapshot_at
from leaderboard_snapshots ls
where ls.snapshot_at = (select max(snapshot_at) from leaderboard_snapshots);
