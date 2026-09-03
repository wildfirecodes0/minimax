const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { generateOrderHistoryPdf } = require('../utils/orderHistoryPdf');

// TODO: Replace with your actual photo once ready
const ORDERS_PHOTO = 'https://i.ibb.co/m5vBQLZd/Chat-GPT-Image-Aug-25-2026-03-16-09-PM.png';

// Only the latest 5 are ever shown inside the bot UI (keeps this screen fast
// and short). The FULL history is always available via the PDF download
// button below it, regardless of how many total orders the user has.
const RECENT_LIMIT = 5;

async function ordersHandler(ctx) {
  const telegramId = ctx.from.id;

  const { data: orders, error, count } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .range(0, RECENT_LIMIT - 1);

  if (error) console.error('Orders fetch error:', error.message);

  const totalCount = count || 0;
  let caption = `📜 <b>My Orders</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

  if (!orders || orders.length === 0) {
    caption += `<i>You haven't purchased anything yet.</i>`;
  } else {
    for (const o of orders) {
      const date = new Date(o.created_at).toLocaleDateString();
      caption += `• <b>${o.product_name}</b> (${o.type === 'bot' ? 'Bot' : 'API'})\n  ${o.price} RP💎 — ${date}\n\n`;
    }
    caption += `<i>Showing latest ${orders.length} of ${totalCount} order${totalCount === 1 ? '' : 's'}</i>`;
  }

  const rows = [];
  if (totalCount > 0) {
    rows.push([Markup.button.callback('📄 Download Full History (PDF)', 'orders:download_pdf')]);
  }
  rows.push([Markup.button.callback('🔙 Return To Menu', 'menu_main')]);

  await sendOrEditUI(ctx, { photo: ORDERS_PHOTO, caption, keyboard: Markup.inlineKeyboard(rows) });
}

async function downloadOrdersPdfHandler(ctx) {
  const telegramId = ctx.from.id;

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('telegram_id', telegramId)
      .order('created_at', { ascending: false });

    if (error) console.error('Orders PDF fetch error:', error.message);

    if (!orders || orders.length === 0) {
      return ctx.answerCbQuery('You haven\'t purchased anything yet.', { show_alert: true });
    }

    ctx.answerCbQuery('📄 Generating your PDF...').catch(() => {});

    const user = {
      telegram_id: telegramId,
      first_name: ctx.from.first_name,
      username: ctx.from.username,
    };

    const pdfBuffer = await generateOrderHistoryPdf(user, orders);

    await ctx.replyWithDocument(
      { source: pdfBuffer, filename: `order-history-${telegramId}.pdf` },
      { caption: `📄 <b>Your complete order history</b>\n${orders.length} total order${orders.length === 1 ? '' : 's'}`, parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('Download orders PDF error:', err.message);
    ctx.answerCbQuery('⚠️ Something went wrong. Please try again.', { show_alert: true }).catch(() => {});
  }
}

module.exports = { ordersHandler, downloadOrdersPdfHandler };
