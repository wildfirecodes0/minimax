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

## 👑 Becoming the Admin/Owner

Send `/ra_ro_by_panel` to your bot from Telegram. **The first person to run this command automatically becomes the Owner.** After that, only registered admins can access the panel. The Owner can add/remove additional admins from inside the panel.

## 🔒 Mandatory Channel Join

Every user must join the channel configured in `src/config.js` (`FORCE_JOIN_CHANNEL_USERNAME`) before using the bot. **The bot must be an Admin of that channel**, or the membership check will fail.

## 💳 Deposits

Users tap "🚀 Pay" (Razorpay/UPI link in `src/config.js` → `PAYMENT_LINK`), pay, then tap "🦋 Paid" and submit their Transaction ID. The bot verifies it against `rparinfo.onrender.com`'s API before crediting RP💎 — the credited amount always comes from the verified API response, never from user input, and each payment ID can only be used once (enforced at the database level to prevent double-crediting).

## 🌐 Hosting

This bot uses **long polling** (`bot.launch()`), so it needs to run continuously.

- **Render** — create it as a **Background Worker** (NOT "Web Service" — this bot doesn't listen on any HTTP port and will be killed by Render's port-scan timeout if deployed as a Web Service)
- **Railway** — auto-detects Node.js, just set env vars and deploy
- **VPS + PM2** — `pm2 start src/bot.js --name minimax-bot`

## 💱 Currency

Internal currency: **RP💎**. Users pay via UPI/Razorpay; RP💎 is credited based on the verified payment amount.

## 📝 Notes / Known Placeholders

- All screen photos are hosted on ImgBB — replace the URLs in each handler file (or `config.js`) if you want to change them later.
- Admin Panel photo is still a **local file** (`src/assets/adminpanel.png`) by request — replace this file directly if you want to change it, or send a new image link to switch it to a URL like the others.
- Deposit verification API field mapping is based on the real API response from `rparinfo.onrender.com`.
- "My Orders" and "Total Sold" stats are powered by the `orders` table, recorded automatically on every successful purchase.
