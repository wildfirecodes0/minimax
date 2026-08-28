const { Telegraf } = require('telegraf');
const https = require('https');
const http = require('http');
require('dotenv').config();

const supabase = require('./supabase');
const { getAdminRole } = require('./utils/isAdmin');

const startHandler = require('./handlers/start');
const { profileHandler } = require('./handlers/profile');
const mainMenuHandler = require('./handlers/menu');
const aboutUsHandler = require('./handlers/aboutUs');
const statsHandler = require('./handlers/stats');
const { depositHandler, depositPaidHandler, handleTransactionIdText } = require('./handlers/deposit');
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
const { ordersHandler } = require('./handlers/orders');
const { isChannelMember, sendJoinPrompt, checkJoinHandler } = require('./handlers/forceJoin');

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    // Disabling keep-alive avoids a known node-fetch/Node.js 19+ bug where
    // reused sockets randomly fail with "socket hang up" / ECONNRESET.
    agent: new https.Agent({ keepAlive: false }),
  },
});

// ---------------- Auto-cleanup ----------------
// Deletes the user's own incoming message (text, commands, etc.) right after
// it has been fully processed — keeps the chat looking like a single clean
// app screen instead of a scrolling log of typed inputs.
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

// ---------------- Force-Join Gate ----------------
// Every private-chat interaction is blocked with a "please join our channel"
// prompt until the user is a verified member — except the "I've Joined"
// button itself, which must always be reachable to re-check membership.
bot.use(async (ctx, next) => {
  if (!ctx.chat || ctx.chat.type !== 'private') return next();
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_join') return next();

  const joined = await isChannelMember(ctx.telegram, ctx.from.id);
  if (!joined) {
    return sendJoinPrompt(ctx);
  }
  return next();
});

bot.action('check_join', checkJoinHandler);

// ---------------- Ban Gate ----------------
// A banned user's Ban toggle previously only changed a database flag with no
// real effect — this enforces it: banned users can't use the bot at all,
// except to see why they're blocked. Admins are exempt so a banned admin
// account (edge case) doesn't lock itself out of fixing things.
bot.use(async (ctx, next) => {
  if (!ctx.chat || ctx.chat.type !== 'private') return next();

  const { data: user, error } = await supabase
    .from('users')
    .select('is_banned')
    .eq('telegram_id', ctx.from.id)
    .maybeSingle();

  if (error) console.error('Ban check error:', error.message);

  if (user && user.is_banned) {
    const role = await getAdminRole(ctx.from.id);
    if (!role) {
      return ctx.reply('🚫 You have been banned from using this bot. Contact support if you think this is a mistake.');
    }
  }

  return next();
});

// ---------------- Buyer-side ----------------

bot.start(startHandler);

bot.action('menu_profile', profileHandler);
bot.action('menu_main', mainMenuHandler);
bot.action('menu_about_us', aboutUsHandler);

bot.action('profile_stats', statsHandler);
bot.action('profile_deposit', depositHandler);
bot.action('deposit_paid', depositPaidHandler);
bot.action('profile_orders', (ctx) => ordersHandler(1, ctx));
bot.action(/^orders:list:(\d+)$/, (ctx) => ordersHandler(Number(ctx.match[1]), ctx));

bot.action('menu_buy_bot', async (ctx) => {
  await ctx.answerCbQuery();
  return showListHandler('bot', 1, ctx);
});
bot.action('menu_buy_api', async (ctx) => {
  await ctx.answerCbQuery();
  return showListHandler('api', 1, ctx);
});

bot.action(/^cat:(bot|api):(list|item|buy|filter|setsort):(.+)$/, catalogRouter);

// ---------------- Admin-side ----------------

bot.command('ra_ro_by_panel', adminPanelCommand);

// All admin:* callbacks go through requireAdmin first
bot.action('admin:panel', requireAdmin, (ctx) => showPanel(ctx, ctx.state.adminRole));
bot.action('admin:close', requireAdmin, closePanelHandler);
bot.action('admin:stats', requireAdmin, statsHandler);

// Products
bot.action('admin:products:menu', requireAdmin, async (ctx) => {
  await ctx.answerCbQuery();
  return productsMenuHandler(ctx);
});
bot.action('admin:products:add:bot', requireAdmin, (ctx) => startAddProduct('bot', ctx));
bot.action('admin:products:add:api', requireAdmin, (ctx) => startAddProduct('api', ctx));
bot.action('admin:products:add:confirm', requireAdmin, confirmAddProduct);
bot.action('admin:products:add:cancel', requireAdmin, cancelAddProduct);
bot.action(/^admin:products:list:(bot|api):(\d+)$/, requireAdmin, async (ctx) => {
  await ctx.answerCbQuery();
  return listProductsHandler(ctx.match[1], Number(ctx.match[2]), ctx);
});
bot.action(/^admin:products:view:(bot|api):(\d+)$/, requireAdmin, async (ctx) => {
  await ctx.answerCbQuery();
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

// Manage Admins (owner only, enforced inside handlers)
bot.action('admin:admins:menu', requireAdmin, async (ctx) => {
  await ctx.answerCbQuery();
  return adminsMenuHandler(ctx);
});
bot.action('admin:admins:add', requireAdmin, startAddAdmin);
bot.action(/^admin:admins:confirmremove:(\d+)$/, requireAdmin, (ctx) => confirmRemoveAdminHandler(ctx.match[1], ctx));
bot.action(/^admin:admins:remove:(\d+)$/, requireAdmin, (ctx) => removeAdminHandler(ctx.match[1], ctx));

// ---------------- Global text router (multi-step flows) ----------------

const textStateHandlers = [
  handleTransactionIdText,
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

// Document uploads (used for Add Product / Edit File steps, and document broadcasts)
bot.on('document', async (ctx, next) => {
  if (await handleAddProductFile(ctx)) return;
  if (await handleEditProductFile(ctx)) return;
  if (await handleBroadcastMedia(ctx)) return;
  return next();
});

// Photo / Video / GIF uploads (used for media broadcasts)
bot.on(['photo', 'video', 'animation'], async (ctx, next) => {
  if (await handleBroadcastMedia(ctx)) return;
  return next();
});

// Global error handler — prevents a single failed action (e.g. a network
// hiccup while sending a photo) from crashing the entire bot process.
bot.catch((err, ctx) => {
  console.error(`Unhandled error for update type "${ctx.updateType}":`, err.message);
});

// ---------------- Health-check HTTP server ----------------
// This bot only talks to Telegram via long polling and normally doesn't need
// an HTTP port at all. BUT if it's deployed on Render as a "Web Service"
// (the only free-tier option), Render requires SOMETHING listening on
// process.env.PORT within ~60s of deploy — otherwise it repeatedly kills the
// instance with a port-scan timeout, which looks like "Deploy failed" even
// though the bot code itself is fine. Binding a tiny server here fixes that
// regardless of which Render service type is chosen.
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
