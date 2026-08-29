const { Markup } = require('telegraf');
const supabase = require('../../supabase');
const { invalidate } = require('../../utils/cache');
const { sendOrEditUI } = require('../../utils/messageManager');
const { setState, getState, clearState } = require('../../utils/stateManager');
const { getAdminRole } = require('../../utils/isAdmin');

const ADMIN_PHOTO = './src/assets/adminpanel.png';

function userProfileKeyboard(telegramId, isBanned) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Add Balance', `admin:users:addbal:${telegramId}`),
      Markup.button.callback('➖ Deduct Balance', `admin:users:subbal:${telegramId}`),
    ],
    [
      Markup.button.callback(isBanned ? '✅ Unban User' : '🚫 Ban User', `admin:users:toggleban:${telegramId}`),
    ],
    [Markup.button.callback('🔙 Back to Panel', 'admin:panel')],
  ]);
}

async function renderUserProfile(ctx, user) {
  const caption =
    `👤 <b>${user.first_name || 'Unknown'}</b>\n` +
    `🆔 <code>${user.telegram_id}</code>\n` +
    `🔗 ${user.username ? '@' + user.username : '<i>(no username)</i>'}\n\n` +
    `💰 <b>Balance:</b> <code>${user.balance ?? 0}</code> RP💎\n` +
    `➕ <b>Total Deposit:</b> <code>${user.deposit_amount ?? 0}</code> RP💎\n` +
    `🛒 <b>Total Spend:</b> <code>${user.spend_amount ?? 0}</code> RP💎\n\n` +
    `🚦 <b>Status:</b> ${user.is_banned ? '🚫 Banned' : '✅ Active'}`;

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption,
    keyboard: userProfileKeyboard(user.telegram_id, user.is_banned),
  });
}

// ---- Step 1: Ask for user to search ----
async function startUserSearch(ctx) {
  setState(ctx.from.id, 'admin_search_user');

  const caption = `🔍 <b>Search User</b>\n\nSend the user's <b>Telegram ID</b> or <b>@username</b>:`;
  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption,
    keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Panel', 'admin:panel')]]),
  });
}

async function handleUserSearchText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'admin_search_user') return false;
  if (!(await getAdminRole(userId))) { clearState(userId); return true; }

  clearState(userId);
  const query = ctx.message.text.trim().replace(/^@/, '');

  let dbQuery = supabase.from('users').select('*');
  dbQuery = /^\d+$/.test(query) ? dbQuery.eq('telegram_id', query) : dbQuery.ilike('username', query);

  const { data: user, error } = await dbQuery.single();

  if (error || !user) {
    setState(userId, 'admin_search_user');
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ User not found. Please check the ID/username and try again:`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Panel', 'admin:panel')]]),
    });
    return true;
  }

  await renderUserProfile(ctx, user);
  return true;
}

// ---- Step 2: Add / Deduct balance ----
async function startBalanceAdjust(action, telegramId, ctx) {
  setState(ctx.from.id, 'admin_adjust_balance', { action, telegramId });

  const label = action === 'add' ? 'Add' : 'Deduct';
  const caption = `💰 <b>${label} Balance</b>\n\nSend the amount of RP💎 to ${label.toLowerCase()} for user <code>${telegramId}</code>:`;
  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption,
    keyboard: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin:panel')]]),
  });
}

async function handleAdjustBalanceText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'admin_adjust_balance') return false;
  if (!(await getAdminRole(userId))) { clearState(userId); return true; }

  const { action, telegramId } = state.data;
  const amount = parseFloat(ctx.message.text.trim());

  if (Number.isNaN(amount) || amount <= 0) {
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ Please send a valid positive number:`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin:panel')]]),
    });
    return true;
  }

  clearState(userId);

  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('balance')
    .eq('telegram_id', telegramId)
    .single();

  if (fetchError || !user) {
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ User not found.`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Panel', 'admin:panel')]]),
    });
    return true;
  }

  const currentBalance = Number(user.balance || 0);
  const newBalance = action === 'add' ? currentBalance + amount : Math.max(0, currentBalance - amount);

  const { data: updated, error: updateError } = await supabase
    .from('users')
    .update({ balance: newBalance })
    .eq('telegram_id', telegramId)
    .select()
    .single();

  if (updateError) {
    console.error('Balance adjust error:', updateError.message);
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ Failed to update balance.`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Panel', 'admin:panel')]]),
    });
    return true;
  }

  // Show the refreshed profile (with a small success note baked into the same screen)
  await renderUserProfile(ctx, updated);

  // Notify the affected user directly (separate chat — this is a legitimate
  // notification for them, not clutter in the admin's screen)
  await ctx.telegram
    .sendMessage(
      telegramId,
      action === 'add'
        ? `💰 <b>${amount} RP💎</b> has been added to your balance by the admin.`
        : `⚠️ <b>${amount} RP💎</b> has been deducted from your balance by the admin.`,
      { parse_mode: 'HTML' }
    )
    .catch(() => {});

  return true;
}

// ---- Ban / Unban toggle ----
async function toggleBanHandler(telegramId, ctx) {
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('is_banned')
    .eq('telegram_id', telegramId)
    .single();

  if (fetchError || !user) {
    return ctx.answerCbQuery('⚠️ User not found.', { show_alert: true });
  }

  const { data: updated, error: updateError } = await supabase
    .from('users')
    .update({ is_banned: !user.is_banned })
    .eq('telegram_id', telegramId)
    .select()
    .single();

  if (updateError) {
    console.error('Ban toggle error:', updateError.message);
    return ctx.answerCbQuery('⚠️ Failed to update.', { show_alert: true });
  }

  // Invalidate cache so the next interaction reflects the new ban status immediately
  invalidate(`ban_status:${telegramId}`);
  await renderUserProfile(ctx, updated);
}

module.exports = {
  startUserSearch,
  handleUserSearchText,
  startBalanceAdjust,
  handleAdjustBalanceText,
  toggleBanHandler,
};
