const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');

// Stats photo
const STATS_PHOTO = 'https://i.ibb.co/C5HVn6Gh/Chat-GPT-Image-Aug-25-2026-03-18-53-PM.png';

async function statsHandler(ctx) {
  try {
    await ctx.answerCbQuery();

    // Total registered users
    const { count: totalUsers, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (countError) console.error('Stats count error:', countError.message);

    // Total system deposit & spend (summed from all users)
    const { data: sums, error: sumsError } = await supabase
      .from('users')
      .select('deposit_amount, spend_amount');

    if (sumsError) console.error('Stats sums error:', sumsError.message);

    const totalDeposit = (sums || []).reduce((acc, u) => acc + Number(u.deposit_amount || 0), 0);
    const totalSpend = (sums || []).reduce((acc, u) => acc + Number(u.spend_amount || 0), 0);

    // Total sold bots/APIs — from actual purchase records
    const { count: totalSoldBot, error: soldBotError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'bot');
    if (soldBotError) console.error('Sold bot count error:', soldBotError.message);

    const { count: totalSoldApi, error: soldApiError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'api');
    if (soldApiError) console.error('Sold api count error:', soldApiError.message);

    const caption =
      `📊 <b>Global Bot Statistics & Overview</b>\n\n` +
      `<b>👥 Total Users:</b> <code>${totalUsers ?? 0}</code>\n` +
      `<b>🤖 Total Sold Bots:</b> <code>${totalSoldBot ?? 0}</code>\n` +
      `<b>🔌 Total Sold APIs:</b> <code>${totalSoldApi ?? 0}</code>\n\n` +
      `<b>💰 Total System Deposit:</b> <code>${totalDeposit}</code> <b>RP💎</b>\n` +
      `<b>🛒 Total System Spend:</b> <code>${totalSpend}</code> <b>RP💎</b>\n\n` +
      `<b>⚡ Bot Status:</b> 🟢 Online`;

    // If opened from the Admin Panel, "Back" should return there — not to
    // the buyer's main menu.
    const backTarget = ctx.state?.adminRole ? 'admin:panel' : 'menu_main';
    const statsKeyboard = Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', backTarget)]]);

    await sendOrEditUI(ctx, { photo: STATS_PHOTO, caption, keyboard: statsKeyboard });
  } catch (err) {
    console.error('Stats handler error:', err.message);
  }
}

module.exports = statsHandler;
