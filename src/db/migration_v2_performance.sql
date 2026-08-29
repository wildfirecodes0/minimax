-- =========================================================
-- Migration v2 — Performance Indexes
-- Run this in Supabase SQL Editor if your database was created
-- before v2 (schema.sql didn't have these indexes).
-- Safe to run multiple times (IF NOT EXISTS on all).
-- =========================================================

-- Ban gate — bot.js checks is_banned on every interaction
create index if not exists idx_users_is_banned         on users (telegram_id, is_banned);

-- Referral balance lookup — credited during deposits and purchases
create index if not exists idx_users_referred_by_bal   on users (telegram_id, balance) where referred_by is not null;

-- Orders per user — "My Orders" screen
create index if not exists idx_orders_telegram_id      on orders (telegram_id, created_at desc);

-- Transactions per user — deposit history lookup
create index if not exists idx_transactions_tg_id      on transactions (telegram_id);

-- Stats screen — sum across all users
create index if not exists idx_users_stats             on users (deposit_amount, spend_amount);

-- referred_by column (add if missing from older schema)
alter table users add column if not exists referred_by bigint;
create index if not exists idx_users_referred_by on users (referred_by);
