const { Telegraf } = require('telegraf');
const https = require('https');
const http = require('http');
require('dotenv').config();

const supabase = require('./supabase');
const { getAdminRole } = require('./utils/isAdmin');
const { setState, getState } = require('./utils/stateManager');
const { get, set, invalidate, TTL } = require('./utils/cache');

const startHandler = require('./handlers/start');
const { profileHandler } = require('./handlers/profile');
const mainMenuHandler = require('./handlers/menu');
const aboutUsHandler = require('./handlers/aboutUs');
const statsHandler = require('./handlers/stats');
const { depositHandler, depositPaidHandler, handleTransactionIdText } = require('./handlers/deposit');
const {
  starsDepositHandler,
  starsPackageHandler,
  startCustomStarsAmount,
  handleCustomStarsAmountText,
  preCheckoutHandler,
  successfulPaymentHandler,
} = require('./handlers/starsDeposit');
const { inviteHandler } = require('./handlers/referral');
const { showListHandler, catalogRouter } = require('./handlers/catalog');

// Admin panel
const { adminPanelCommand, showPanel, requireAdmin, closePanelHandler } = require('./handlers/admin/panel');
const {
  productsMenuHandler,
  startAddProduct,
  handleAddProductText,
  handleAddProductFile,
  confirmAddProduct,
  cancelAddProduct,
  listProductsHandler,
  viewProductHandler,
  startEditField,
  handleEditProductText,
  handleEditProductFile,
  confirmDeleteHandler,
  deleteProductHandler,
} = require('./handlers/admin/products');
const {
  startUserSearch,
  handleUserSearchText,
  startBalanceAdjust,
  handleAdjustBalanceText,
  toggleBanHandler,
} = require('./handlers/admin/users');
const {
  startBroadcast,
  handleBroadcastText,
  handleBroadcastMedia,
  confirmBroadcast,
  cancelBroadcast,
} = require('./handlers/admin/broadcast');
const {
  adminsMenuHandler,
  startAddAdmin,
  handleAddAdminText,
  confirmRemoveAdminHandler,
  removeAdminHandler,
} = require('./handlers/admin/admins');
const { ordersHandler, downloadOrdersPdfHandler } = require('./handlers/orders');
const { isChannelMember, sendJoinPrompt, checkJoinHandler } = require('./handlers/forceJoin');

if (!process.env.BOT_TOKEN) {
  console.error(
    '\n❌ BOT_TOKEN missing.\n' +
    '   Project root mein ".env" file banao (".env.example" ko copy karke)\n' +
    '   aur usme apna asli bot token daalo (BotFather se milega):\n\n' +
    '   BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n'
  );
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    // Disabling keep-alive avoids a known node-fetch/Node.js 19+ bug where
    // reused sockets randomly fail with "socket hang up" / ECONNRESET.
    agent: new https.Agent({ keepAlive: false }),
  },
});

// ============================================================
// MIDDLEWARE ORDER — critical for speed:
//
//  1. answerCbQuery immediately (removes Telegram's spinner ASAP)
//  2. Save /start payload before force-join gate
//  3. Force-join gate   (cached — no DB/API hit on repeat clicks)
//  4. Ban gate          (cached — no DB hit on repeat clicks)
//  5. Auto-delete user message (after handler completes)
// ============================================================

// ---------------- 1. Instant answerCbQuery (SAFE — won't block real alerts) ----------------
// Telegram shows a loading spinner on the button until answerCbQuery() is
// called, AND a callback query can only ever be answered ONCE. The previous
// version answered immediately for every click, which silently broke every
// handler that needed to show a real popup afterward (Buy Now success/
// failure, Insufficient Balance, Access Denied, Item Not Found, etc.) —
// their answerCbQuery() call would fail because Telegram had already
// received an answer for that click.
//
// Fix: wrap ctx.answerCbQuery so only the FIRST call (whichever comes first)
// actually reaches Telegram. Then set a short fallback timer — if the real
// handler hasn't answered within 700ms (giving DB calls plenty of time), we
// send a blank ack ourselves just to remove the spinner. If the handler DOES
// answer in time (the common case), its real message/alert wins.
bot.use(async (ctx, next) => {
  if (!ctx.callbackQuery || ctx.callbackQuery.data === 'check_join') {
    return next();
  }

  let answered = false;
  const realAnswer = ctx.telegram.answerCbQuery.bind(ctx.telegram);
  const callbackId = ctx.callbackQuery.id;

  ctx.answerCbQuery = async (text, extra) => {
    if (answered) return; // already answered — silently no-op instead of throwing
    answered = true;
    return realAnswer(callbackId, text, extra).catch(() => {});
  };

  const fallbackTimer = setTimeout(() => {
    if (!answered) {
      answered = true;
      realAnswer(callbackId).catch(() => {});
    }
  }, 700);

  try {
    await next();
  } finally {
    clearTimeout(fallbackTimer);
  }
});

// ---------------- 2. Save /start payload BEFORE force-join gate ----------------
// When a new user clicks a referral link (/start ref_XXXX) but hasn't joined
// the channel yet, the force-join gate blocks them before startHandler runs.
// We save the payload here so it survives the gate and is available once they
// click "I've Joined" and startHandler is called from checkJoinHandler.
bot.use(async (ctx, next) => {
  if (
    ctx.chat &&
    ctx.chat.type === 'private' &&
    ctx.message &&
    ctx.message.text &&
    ctx.message.text.startsWith('/start')
  ) {
    const parts = ctx.message.text.split(' ');
    const payload = parts[1] || '';
    setState(ctx.from.id, 'pending_start', { startPayload: payload });
  }
  return next();
});

// ---------------- 3. Force-Join Gate (CACHED) ----------------
// getChatMember is now cached for 3 min — so repeat clicks don't each
// make an API call to Telegram. Only the first click per 3-min window hits the API.
bot.use(async (ctx, next) => {
  if (!ctx.chat || ctx.chat.type !== 'private') return next();
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_join') return next();
  // NEVER gate a Stars payment confirmation — the Stars have already been
  // charged, so this update MUST reach successfulPaymentHandler no matter what.
  if (ctx.message && ctx.message.successful_payment) return next();

  const joined = await isChannelMember(ctx.telegram, ctx.from.id);
  if (!joined) {
    return sendJoinPrompt(ctx);
  }
  return next();
});

bot.action('check_join', checkJoinHandler);

// ---------------- 4. Ban Gate (CACHED) ----------------
// Previously: DB query on EVERY button press (200-400ms each time).
// Now: cached for 5 min. toggleBanHandler invalidates cache on ban/unban.
bot.use(async (ctx, next) => {
  if (!ctx.chat || ctx.chat.type !== 'private') return next();
  // Same reasoning as the force-join gate — the Stars charge already happened.
  if (ctx.message && ctx.message.successful_payment) return next();

  const userId = ctx.from.id;
  const cacheKey = `ban_status:${userId}`;
  let isBanned = get(cacheKey);

  if (isBanned === undefined) {
    // Cache miss — go to DB
    const { data: user, error } = await supabase
      .from('users')
      .select('is_banned')
      .eq('telegram_id', userId)
      .maybeSingle();

    if (error) console.error('Ban check error:', error.message);
    isBanned = user ? (user.is_banned === true) : false;
    set(cacheKey, isBanned, TTL.BAN_STATUS);
  }

  if (isBanned) {
    const role = await getAdminRole(userId);
    if (!role) {
      return ctx.reply('🚫 You have been banned from using this bot. Contact support if you think this is a mistake.');
    }
  }

  return next();
});

// ---------------- 5. Auto-cleanup ----------------
bot.use(async (ctx, next) => {
  await next();
  if (ctx.chat && ctx.chat.type === 'private' && ctx.message && ctx.message.message_id) {
    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (err) {
      // Already deleted / too old / no permission — safe to ignore
    }
  }
});

// ---------------- Buyer-side ----------------

bot.start(startHandler);

bot.action('menu_profile', profileHandler);
bot.action('menu_main', mainMenuHandler);
bot.action('menu_about_us', aboutUsHandler);
bot.action('menu_invite', inviteHandler);

bot.action('profile_stats', statsHandler);
bot.action('profile_deposit', depositHandler);
bot.action('deposit_paid', depositPaidHandler);
bot.action('deposit_stars', starsDepositHandler);
bot.action(/^stars_pkg:(\d+)$/, (ctx) => starsPackageHandler(Number(ctx.match[1]), ctx));
bot.action('stars_custom', startCustomStarsAmount);

// Telegram Stars payment lifecycle — fully automatic, no manual verification
bot.on('pre_checkout_query', preCheckoutHandler);
bot.on('successful_payment', successfulPaymentHandler);
bot.action('profile_orders', ordersHandler);
bot.action('orders:download_pdf', downloadOrdersPdfHandler);

bot.action('menu_buy_bot', async (ctx) => {
  return showListHandler('bot', 1, ctx);
});
bot.action('menu_buy_api', async (ctx) => {
  return showListHandler('api', 1, ctx);
});

bot.action(/^cat:(bot|api):(list|item|buy|filter|setsort):(.+)$/, catalogRouter);

// ---------------- Admin-side ----------------

bot.command('ra_ro_by_panel', adminPanelCommand);

bot.action('admin:panel', requireAdmin, (ctx) => showPanel(ctx, ctx.state.adminRole));
bot.action('admin:close', requireAdmin, closePanelHandler);
bot.action('admin:stats', requireAdmin, statsHandler);

// Products
bot.action('admin:products:menu', requireAdmin, async (ctx) => {
  return productsMenuHandler(ctx);
});
bot.action('admin:products:add:bot', requireAdmin, (ctx) => startAddProduct('bot', ctx));
bot.action('admin:products:add:api', requireAdmin, (ctx) => startAddProduct('api', ctx));
bot.action('admin:products:add:confirm', requireAdmin, confirmAddProduct);
bot.action('admin:products:add:cancel', requireAdmin, cancelAddProduct);
bot.action(/^admin:products:list:(bot|api):(\d+)$/, requireAdmin, async (ctx) => {
  return listProductsHandler(ctx.match[1], Number(ctx.match[2]), ctx);
});
bot.action(/^admin:products:view:(bot|api):(\d+)$/, requireAdmin, async (ctx) => {
  return viewProductHandler(ctx.match[1], Number(ctx.match[2]), ctx);
});
bot.action(/^admin:products:editprice:(bot|api):(\d+)$/, requireAdmin, (ctx) =>
  startEditField('price', ctx.match[1], Number(ctx.match[2]), ctx)
);
bot.action(/^admin:products:editdesc:(bot|api):(\d+)$/, requireAdmin, (ctx) =>
  startEditField('description', ctx.match[1], Number(ctx.match[2]), ctx)
);
bot.action(/^admin:products:editfile:(bot|api):(\d+)$/, requireAdmin, (ctx) =>
  startEditField('file', ctx.match[1], Number(ctx.match[2]), ctx)
);
bot.action(/^admin:products:confirmdelete:(bot|api):(\d+)$/, requireAdmin, (ctx) =>
  confirmDeleteHandler(ctx.match[1], Number(ctx.match[2]), ctx)
);
bot.action(/^admin:products:delete:(bot|api):(\d+)$/, requireAdmin, (ctx) =>
  deleteProductHandler(ctx.match[1], Number(ctx.match[2]), ctx)
);

// Users
bot.action('admin:users:search', requireAdmin, startUserSearch);
bot.action(/^admin:users:addbal:(\d+)$/, requireAdmin, (ctx) => startBalanceAdjust('add', ctx.match[1], ctx));
bot.action(/^admin:users:subbal:(\d+)$/, requireAdmin, (ctx) => startBalanceAdjust('subtract', ctx.match[1], ctx));
bot.action(/^admin:users:toggleban:(\d+)$/, requireAdmin, (ctx) => toggleBanHandler(ctx.match[1], ctx));

// Broadcast
bot.action('admin:broadcast:start', requireAdmin, startBroadcast);
bot.action('admin:broadcast:confirm', requireAdmin, confirmBroadcast);
bot.action('admin:broadcast:cancel', requireAdmin, cancelBroadcast);

// Manage Admins
bot.action('admin:admins:menu', requireAdmin, async (ctx) => {
  return adminsMenuHandler(ctx);
});
bot.action('admin:admins:add', requireAdmin, startAddAdmin);
bot.action(/^admin:admins:confirmremove:(\d+)$/, requireAdmin, (ctx) => confirmRemoveAdminHandler(ctx.match[1], ctx));
bot.action(/^admin:admins:remove:(\d+)$/, requireAdmin, (ctx) => removeAdminHandler(ctx.match[1], ctx));

// ---------------- Global text router ----------------

const textStateHandlers = [
  handleTransactionIdText,
  handleCustomStarsAmountText,
  handleAddProductText,
  handleEditProductText,
  handleUserSearchText,
  handleAdjustBalanceText,
  handleBroadcastText,
  handleAddAdminText,
];

bot.on('text', async (ctx, next) => {
  for (const handler of textStateHandlers) {
    if (await handler(ctx)) return;
  }
  return next();
});

bot.on('document', async (ctx, next) => {
  if (await handleAddProductFile(ctx)) return;
  if (await handleEditProductFile(ctx)) return;
  if (await handleBroadcastMedia(ctx)) return;
  return next();
});

bot.on(['photo', 'video', 'animation'], async (ctx, next) => {
  if (await handleBroadcastMedia(ctx)) return;
  return next();
});

bot.catch((err, ctx) => {
  console.error(`Unhandled error for update type "${ctx.updateType}":`, err.message);
  // FIX: last-resort safety net — this used to only log, so any error that
  // slipped past every handler's own try/catch (or a handler missing one
  // entirely, like the old requireAdmin) left the user with total silence.
  // Now every update type gets SOME visible response no matter what breaks.
  if (ctx.callbackQuery) {
    ctx.answerCbQuery('⚠️ Something went wrong. Please try again.', { show_alert: true }).catch(() => {});
  } else if (ctx.chat) {
    ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
  }
});

// ---------------- Health-check HTTP server ----------------
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Mini Max Seller Bot is running.');
  })
  .listen(PORT, () => {
    console.log(`🌐 Health-check server listening on port ${PORT}`);
  });

bot.launch();
console.log('🚀 Mini Max Seller Bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
