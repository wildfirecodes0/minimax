const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { BOT_USERNAME, REFERRAL_SIGNUP_BONUS, REFERRAL_DEPOSIT_PERCENT, REFERRAL_PURCHASE_PERCENT } = require('../config');

const INVITE_PHOTO = 'https://i.ibb.co/kgQLGnGY/Chat-GPT-Image-Aug-29-2026-10-53-32-AM.png';

const inviteKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 Return To Menu', 'menu_main')],
]);

async function inviteHandler(ctx) {
  try {
    const userId = ctx.from.id;

    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', userId);

    if (error) console.error('Invite count error:', error.message);

    const refCount = count || 0;
    const referLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;

    const caption =
      `<b>👥 Total Invites : ${refCount} User(s)</b>\n\n` +
      `🚀 Refer your friends with your link, and get first one time <b>${REFERRAL_SIGNUP_BONUS} RP💎</b> and life time get <b>${REFERRAL_DEPOSIT_PERCENT}%</b> when your friend deposits in our bot and <b>${REFERRAL_PURCHASE_PERCENT}%</b> from your referrals spending on Purchase!!\n\n` +
      `🔗 Here is Your Referral Link:\n${referLink}`;

    await sendOrEditUI(ctx, { photo: INVITE_PHOTO, caption, keyboard: inviteKeyboard });
  } catch (err) {
    console.error('Invite handler error:', err.message);
    // FIX: previously silent — user tapped the button and got nothing back.
    ctx.answerCbQuery('⚠️ Something went wrong. Please try again.', { show_alert: true }).catch(() => {});
  }
}

module.exports = { inviteHandler };
