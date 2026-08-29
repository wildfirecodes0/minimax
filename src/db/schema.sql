-- =========================================================
-- Mini Max Seller Bot — Combined Supabase SQL Schema v2
-- Run this entire file once in Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / IF NOT EXISTS everywhere.
-- =========================================================

-- ---------------------------------------------------------
-- 1. USERS — every Telegram user who has started the bot
-- ---------------------------------------------------------
create table if not exists users (
  id bigserial primary key,
  telegram_id bigint unique not null,
  username text,
  first_name text,
  last_name text,
  role text default 'buyer',                 -- buyer | seller | admin
  balance numeric default 0,                 -- current RP💎 balance
  deposit_amount numeric default 0,          -- lifetime total deposited (RP💎)
  spend_amount numeric default 0,            -- lifetime total spent (RP💎)
  is_banned boolean default false,
  referred_by bigint,                        -- telegram_id of the user who referred them (null if none)
  created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------
-- 2. PRODUCTS — catalog items for "Buy Bot" / "Buy API"
-- ---------------------------------------------------------
create table if not exists products (
  id bigserial primary key,
  type text not null check (type in ('bot', 'api')),
  code integer not null,
  emoji text,
  name text not null,
  price numeric not null default 0,
  original_price numeric,
  description text,
  file_id text,
  file_name text,
  created_at timestamp with time zone default now(),
  unique (type, code)
);

-- ---------------------------------------------------------
-- 3. TRANSACTIONS — every verified deposit (prevents double-credit)
-- ---------------------------------------------------------
create table if not exists transactions (
  id bigserial primary key,
  telegram_id bigint not null,
  payment_id text unique not null,
  amount_inr numeric not null,
  rp_credited numeric not null,
  created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------
-- 4. ADMINS — bot owner + sub-admins
-- ---------------------------------------------------------
create table if not exists admins (
  id bigserial primary key,
  telegram_id bigint unique not null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  added_by bigint,
  created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------
-- 5. ORDERS — every completed purchase
-- ---------------------------------------------------------
create table if not exists orders (
  id bigserial primary key,
  telegram_id bigint not null,
  type text not null check (type in ('bot', 'api')),
  product_code integer not null,
  product_name text not null,
  price numeric not null,
  created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------
-- INDEXES — critical for query speed
-- ---------------------------------------------------------

-- Core lookup indexes (already existed)
create index if not exists idx_users_telegram_id       on users (telegram_id);
create index if not exists idx_products_type_code      on products (type, code);
create index if not exists idx_transactions_payment_id on transactions (payment_id);
create index if not exists idx_admins_telegram_id      on admins (telegram_id);
create index if not exists idx_orders_type             on orders (type);
create index if not exists idx_users_referred_by       on users (referred_by);

-- NEW: Ban gate — bot.js checks is_banned on every interaction
create index if not exists idx_users_is_banned         on users (telegram_id, is_banned);

-- NEW: Referral lookup — start.js and deposit.js look up referred_by
create index if not exists idx_users_referred_by_bal   on users (telegram_id, balance) where referred_by is not null;

-- NEW: Orders per user — "My Orders" screen
create index if not exists idx_orders_telegram_id      on orders (telegram_id, created_at desc);

-- NEW: Transactions per user — duplicate deposit check
create index if not exists idx_transactions_tg_id      on transactions (telegram_id);

-- NEW: Stats screen — total deposit/spend sum across all users
create index if not exists idx_users_stats             on users (deposit_amount, spend_amount);

-- ---------------------------------------------------------
-- PERFORMANCE: Supabase connection pooling hint
-- Set this in your Supabase project → Settings → Database:
--   Pool Mode: Transaction  (for serverless / short-lived connections)
--   Pool Size: 10
-- This reduces connection overhead which is a major source of latency.
-- ---------------------------------------------------------
