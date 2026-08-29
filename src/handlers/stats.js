const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');

const STATS_PHOTO = 'https://i.ibb.co/C5HVn6Gh/Chat-GPT-Image-Aug-25-2026-03-18-53-PM.png';

async function statsHandler(ctx) {
  try {
    // Run ALL 4 queries in parallel instead of sequentially.
    // Sequential: 4 × ~200ms = ~800ms+
    // Parallel:   max(~200ms each) = ~200ms
    const [
      { count: totalUsers },
      { data: sums },
      { count: totalSoldBot },
      { count: totalSoldApi },
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('deposit_amount, spend_amount'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('type', 'bot'),
      supabase.from('orders').select('*', { count: 'exact', head: true }).eq('type', 'api'),
    ]);

    const totalDeposit = (sums || []).reduce((acc, u) => acc + Number(u.deposit_amount || 0), 0);
    const totalSpend = (sums || []).reduce((acc, u) => acc + Number(u.spend_amount || 0), 0);

    const caption =
      `📊 <b>Global Bot Statistics & Overview</b>\n\n` +
      `<b>👥 Total Users:</b> <code>${totalUsers ?? 0}</code>\n` +
      `<b>🤖 Total Sold Bots:</b> <code>${totalSoldBot ?? 0}</code>\n` +
      `<b>🔌 Total Sold APIs:</b> <code>${totalSoldApi ?? 0}</code>\n\n` +
      `<b>💰 Total System Deposit:</b> <code>${totalDeposit}</code> <b>RP💎</b>\n` +
      `<b>🛒 Total System Spend:</b> <code>${totalSpend}</code> <b>RP💎</b>\n\n` +
      `<b>⚡ Bot Status:</b> 🟢 Online`;

    const backTarget = ctx.state?.adminRole ? 'admin:panel' : 'menu_main';
    const statsKeyboard = Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', backTarget)]]);

    await sendOrEditUI(ctx, { photo: STATS_PHOTO, caption, keyboard: statsKeyboard });
  } catch (err) {
    console.error('Stats handler error:', err.message);
  }
}

module.exports = statsHandler;
