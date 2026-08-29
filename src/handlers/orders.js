const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');

// TODO: Replace with your actual photo once ready
const ORDERS_PHOTO = 'https://i.ibb.co/m5vBQLZd/Chat-GPT-Image-Aug-25-2026-03-16-09-PM.png';
const PAGE_SIZE = 10;

async function ordersHandler(page, ctx) {
  const telegramId = ctx.from.id;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: orders, error, count } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) console.error('Orders fetch error:', error.message);

  const totalCount = count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  let caption = `📜 <b>My Orders</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

  if (!orders || orders.length === 0) {
    caption += `<i>You haven't purchased anything yet.</i>`;
  } else {
    for (const o of orders) {
      const date = new Date(o.created_at).toLocaleDateString();
      caption += `• <b>${o.product_name}</b> (${o.type === 'bot' ? 'Bot' : 'API'})\n  ${o.price} RP💎 — ${date}\n\n`;
    }
    caption += `<i>Page ${page} of ${totalPages}</i>`;
  }

  const navRow = [];
  if (page > 1) navRow.push(Markup.button.callback('◀️ Previous', `orders:list:${page - 1}`));
  if (page < totalPages) navRow.push(Markup.button.callback('Next ▶️', `orders:list:${page + 1}`));

  const rows = [];
  if (navRow.length) rows.push(navRow);
  rows.push([Markup.button.callback('🔙 Return To Menu', 'menu_main')]);

  await sendOrEditUI(ctx, { photo: ORDERS_PHOTO, caption, keyboard: Markup.inlineKeyboard(rows) });
}

module.exports = { ordersHandler };
