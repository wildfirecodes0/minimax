-- =========================================================
-- Migration: add referral tracking to the users table
-- Run this ONCE in Supabase SQL Editor if your database was created
-- before this feature was added (i.e. schema.sql doesn't already
-- contain the `referred_by` column). If you're setting up fresh,
-- just use the updated schema.sql instead — you don't need this file.
-- =========================================================

alter table users add column if not exists referred_by bigint;

create index if not exists idx_users_referred_by on users (referred_by);
