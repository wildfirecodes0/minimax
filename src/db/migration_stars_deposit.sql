-- =========================================================
-- Migration: Telegram Stars Auto-Deposit
-- Run this ONCE in Supabase SQL Editor (safe to re-run).
-- =========================================================

-- Records every Telegram Stars payment that has been credited.
-- The UNIQUE constraint on charge_id is what prevents double-crediting if
-- Telegram ever redelivers the same successful_payment update.
create table if not exists star_transactions (
  id bigserial primary key,
  telegram_id bigint not null,
  charge_id text unique not null,       -- telegram_payment_charge_id from successful_payment
  stars_amount integer not null,        -- how many Stars were paid
  rp_credited numeric not null,         -- RP💎 credited (stars_amount / STARS_PER_RP)
  created_at timestamp with time zone default now()
);

create index if not exists idx_star_transactions_tg_id on star_transactions (telegram_id);
