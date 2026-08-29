-- =========================================================
-- Mini Max Seller Bot — Combined Supabase SQL Schema
-- Run this entire file once in Supabase SQL Editor before hosting.
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
  code integer not null,                     -- display number within its type (01, 02, ...) — auto-generated
  emoji text,
  name text not null,
  price numeric not null default 0,          -- final price in RP💎 (0 = Free)
  original_price numeric,                    -- optional, shown as strike-through if set
  description text,
  file_id text,                              -- Telegram file_id of the deliverable (sent to buyer on purchase)
  file_name text,                            -- original filename, shown in admin views
  created_at timestamp with time zone default now(),
  unique (type, code)
);

-- ---------------------------------------------------------
-- 3. TRANSACTIONS — every verified deposit (prevents double-credit)
-- ---------------------------------------------------------
create table if not exists transactions (
  id bigserial primary key,
  telegram_id bigint not null,
  payment_id text unique not null,           -- from payment gateway, must be unique
  amount_inr numeric not null,
  rp_credited numeric not null,
  created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------
-- 4. ADMINS — bot owner + sub-admins (for /ra_ro_by_panel)
-- ---------------------------------------------------------
create table if not exists admins (
  id bigserial primary key,
  telegram_id bigint unique not null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  added_by bigint,                           -- telegram_id of admin who added this one (null for owner)
  created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------
-- 5. ORDERS — every completed purchase (powers Stats "Total Sold")
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
-- Helpful indexes
-- ---------------------------------------------------------
create index if not exists idx_users_telegram_id on users (telegram_id);
create index if not exists idx_products_type_code on products (type, code);
create index if not exists idx_transactions_payment_id on transactions (payment_id);
create index if not exists idx_admins_telegram_id on admins (telegram_id);
create index if not exists idx_orders_type on orders (type);
create index if not exists idx_users_referred_by on users (referred_by);
