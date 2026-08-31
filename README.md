# 🤖 Mini Max Seller Bot

Telegram e-commerce bot (@MiniMaxSellerBot) for selling Telegram bots and APIs, with a Supabase-backed wallet system (RP💎), Razorpay/UPI deposit verification, mandatory channel-join gate, and a full admin panel.

## 📁 Project Structure

```
src/
├── bot.js                     # Main entry point — registers all handlers + global middleware
├── config.js                  # Shared constants (bot name, channel, payment link, etc.)
├── supabase.js                # Supabase client
├── db/
│   ├── schema.sql             # Run this ONCE in Supabase SQL Editor
│   └── seed.js                # Optional: seeds a few demo products
├── ui/
│   └── mainMenu.js            # Shared main menu keyboard + welcome caption
├── utils/
│   ├── messageManager.js      # Edit-based UI pattern (single message, always edited)
│   ├── stateManager.js        # Tracks multi-step conversations
│   └── isAdmin.js             # Admin role-check helpers
└── handlers/
    ├── start.js                # /start — registers user + notifies admin
    ├── menu.js                 # Return to main menu
    ├── profile.js               # 👤 Profile (balance, deposit, spend)
    ├── orders.js                 # 📜 My Orders — buyer's purchase history
    ├── aboutUs.js                # 🕸 About Us
    ├── stats.js                  # 📊 Global stats
    ├── deposit.js                 # ➕ Deposit — QR/Pay link + payment verification
    ├── catalog.js                  # 🤖 Buy Bot / 🔌 Buy API (paginated catalog + purchase flow)
    ├── forceJoin.js                 # Mandatory channel-join gate
    └── admin/
        ├── panel.js                 # /ra_ro_by_panel — entry + main admin menu
        ├── products.js                # Add/Edit/Delete catalog products (with file delivery)
        ├── users.js                    # Search user, adjust balance, ban/unban
        ├── broadcast.js                 # Broadcast text/photo/video/GIF/document to all users
        └── admins.js                     # Manage sub-admins (Owner only)
```

## 🚀 Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up Supabase
1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste the contents of `src/db/schema.sql` → Run
3. Go to **Project Settings → API** → copy your `Project URL` and `service_role` key

### 3. Configure environment variables
Set these in your hosting platform (e.g. Render → Environment tab) — no `.env` file needed if deploying that way:
```
BOT_TOKEN=your_telegram_bot_token_here      # from @BotFather
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_service_role_key
ADMIN_CHAT_ID=your_telegram_numeric_chat_id  # for new-user/sale notifications
PUBLIC_CHANNEL_ID=your_public_channel_id     # e.g. @yourchannel — for deposit/new-product announcements
NODE_VERSION=22                              # required by @supabase/supabase-js
```

> To find your numeric Telegram ID, message **@userinfobot** on Telegram.

### 4. (Optional) Seed demo products
```bash
npm run seed
```

### 5. Run the bot
```bash
npm start
```

## ⭐ Telegram Stars Auto-Deposit

Users can now deposit RP💎 instantly using **Telegram Stars** — fully automatic, no manual Transaction ID verification needed.

- **Rate:** `15 Stars = 1 RP💎` (change via `STARS_PER_RP` in `src/config.js`)
- Flow: Deposit screen → "⭐ Pay with Telegram Stars" → pick a package or enter a custom amount → Telegram's native payment sheet → balance credited the instant payment succeeds.
- On success: the user gets a formatted confirmation, their referrer (if any) gets their usual lifetime deposit commission, and the same channel (`PUBLIC_CHANNEL_ID`) gets a "New Deposit Arrived" post — same style as the existing INR deposit announcement.
- **Setup required:** run `src/db/migration_stars_deposit.sql` once in the Supabase SQL Editor (creates the `star_transactions` table used to prevent double-crediting).
- No extra `.env` variable needed — Telegram Stars payments don't require a payment provider token.

## 👑 Becoming the Admin/Owner

Send `/ra_ro_by_panel` to your bot from Telegram. **The first person to run this command automatically becomes the Owner.** After that, only registered admins can access the panel. The Owner can add/remove additional admins from inside the panel.

## 🔒 Mandatory Channel Join

Every user must join the channel configured in `src/config.js` (`FORCE_JOIN_CHANNEL_USERNAME`) before using the bot. **The bot must be an Admin of that channel**, or the membership check will fail.

## 💳 Deposits

Users tap "🚀 Pay" (Razorpay/UPI link in `src/config.js` → `PAYMENT_LINK`), pay, then tap "🦋 Paid" and submit their Transaction ID. The bot verifies it against `rparinfo.onrender.com`'s API before crediting RP💎 — the credited amount always comes from the verified API response, never from user input, and each payment ID can only be used once (enforced at the database level to prevent double-crediting).

## 🩸 Referral Program

Every user gets a personal link — `https://t.me/<bot>?start=ref_<their_telegram_id>` (shown via "🩸 Invite Your Friends" in the main menu). When someone joins through it:

- The **referrer** gets a one-time signup bonus (`REFERRAL_SIGNUP_BONUS` in `src/config.js`, default `0.1` RP💎)
- Then, for life, the referrer earns `REFERRAL_DEPOSIT_PERCENT`% (default `40%`) of every deposit, and `REFERRAL_PURCHASE_PERCENT`% (default `10%`) of every purchase, that referred friend makes
- If your database was created before this feature was added, run `src/db/migration_referrals.sql` once in Supabase (fresh setups just use the updated `schema.sql`)

## 🌐 Hosting

This bot uses **long polling** (`bot.launch()`), so it needs to run continuously.

- **Render** — a tiny health-check HTTP server (`src/bot.js`) now listens on `process.env.PORT`, so the bot deploys fine even as a free-tier **Web Service** without hitting Render's port-scan timeout. A **Background Worker** (paid plan) still works too and is the more "correct" service type for a polling bot, but is no longer required to avoid deploy failures.
- **Railway** — auto-detects Node.js, just set env vars and deploy
- **VPS + PM2** — `pm2 start src/bot.js --name minimax-bot`

## 💱 Currency

Internal currency: **RP💎**. Users pay via UPI/Razorpay; RP💎 is credited based on the verified payment amount.

## 📝 Notes / Known Placeholders

- All screen photos are hosted on ImgBB — replace the URLs in each handler file (or `config.js`) if you want to change them later.
- Admin Panel photo is still a **local file** (`src/assets/adminpanel.png`) by request — replace this file directly if you want to change it, or send a new image link to switch it to a URL like the others.
- Deposit verification API field mapping is based on the real API response from `rparinfo.onrender.com`.
- "My Orders" and "Total Sold" stats are powered by the `orders` table, recorded automatically on every successful purchase.
