const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');

// Profile photo
const PROFILE_PHOTO = 'https://i.ibb.co/m5vBQLZd/Chat-GPT-Image-Aug-25-2026-03-16-09-PM.png';

const profileKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('📊 Stats', 'profile_stats'),
    Markup.button.callback('➕ Deposit', 'profile_deposit'),
  ],
  [Markup.button.callback('📜 My Orders', 'profile_orders')],
  [Markup.button.callback('🔙 Return To Menu', 'menu_main')],
]);

async function profileHandler(ctx) {
  const tgUser = ctx.from;

  try {

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', tgUser.id)
      .single();

    if (error || !user) {
      console.error('Profile fetch error:', error?.message);
      return ctx.answerCbQuery('⚠️ Could not load profile. Try again.', { show_alert: true });
    }

    const balance = user.balance ?? 0;
    const deposit = user.deposit_amount ?? 0;
    const spend = user.spend_amount ?? 0;
    const joinedDate = user.created_at
      ? new Date(user.created_at).toLocaleDateString()
      : 'N/A';

    const caption =
      `<b>👤 Name:</b> ${tgUser.first_name}\n` +
      `<b>🆔 Telegram ID:</b> <code>${tgUser.id}</code>\n\n` +
      `<b>💰 Balance:</b> <code>${balance}</code> <b>RP💎</b>\n` +
      `<b>➕ Total Deposit:</b> <code>${deposit}</code> <b>RP💎</b>\n` +
      `<b>🛒 Total Spend:</b> <code>${spend}</code> <b>RP💎</b>\n\n` +
      `<b>💕 Bot Joined Date:</b> <code>${joinedDate}</code>`;

    await sendOrEditUI(ctx, { photo: PROFILE_PHOTO, caption, keyboard: profileKeyboard });
  } catch (err) {
    console.error('Profile handler error:', err.message);
  }
}

module.exports = { profileHandler, profileKeyboard };
