const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { generateDepositHistoryPdf } = require('../utils/depositHistoryPdf');

const DEPOSIT_HISTORY_PHOTO = 'https://i.ibb.co/m5vBQLZd/Chat-GPT-Image-Aug-25-2026-03-16-09-PM.png';
const RECENT_LIMIT = 5;

/**
 * Deposits live in two separate tables (UPI/Razorpay `transactions` and
 * Telegram `star_transactions`). This fetches both and returns one
 * newest-first list with a consistent shape for both the UI and the PDF.
 */
async function fetchAllDeposits(telegramId) {
  const [txnRes, starRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('*')
      .eq('telegram_id', telegramId)
      .order('created_at', { ascending: false }),
    supabase
      .from('star_transactions')
      .select('*')
      .eq('telegram_id', telegramId)
      .order('created_at', { ascending: false }),
  ]);

  if (txnRes.error) console.error('Deposit history (UPI) fetch error:', txnRes.error.message);
  if (starRes.error) console.error('Deposit history (Stars) fetch error:', starRes.error.message);

  const upiDeposits = (txnRes.data || []).map((t) => ({
    method: 'UPI',
    amount_inr: t.amount_inr,
    reference: t.payment_id,
    rp_credited: t.rp_credited,
    created_at: t.created_at,
  }));

  const starDeposits = (starRes.data || []).map((s) => ({
    method: 'Stars',
    stars_amount: s.stars_amount,
    reference: s.charge_id,
    rp_credited: s.rp_credited,
    created_at: s.created_at,
  }));

  return [...upiDeposits, ...starDeposits].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

async function depositHistoryHandler(ctx) {
  try {
    const telegramId = ctx.from.id;
    const allDeposits = await fetchAllDeposits(telegramId);
    const recent = allDeposits.slice(0, RECENT_LIMIT);

    let caption = `💰 <b>Deposit History</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

    if (recent.length === 0) {
      caption += `<i>You haven't made any deposits yet.</i>`;
    } else {
      for (const d of recent) {
        const date = new Date(d.created_at).toLocaleDateString();
        const line = d.method === 'Stars' ? `${d.stars_amount} ⭐ Stars` : `₹${d.amount_inr} via UPI`;
        caption += `• <b>${line}</b>\n  +${d.rp_credited} RP💎 — ${date}\n\n`;
      }
      caption += `<i>Showing latest ${recent.length} of ${allDeposits.length} deposit${allDeposits.length === 1 ? '' : 's'}</i>`;
    }

    const rows = [];
    if (allDeposits.length > 0) {
      rows.push([Markup.button.callback('📄 Download Full History (PDF)', 'deposits:download_pdf')]);
    }
    rows.push([Markup.button.callback('🔙 Return To Menu', 'menu_profile')]);

    await sendOrEditUI(ctx, { photo: DEPOSIT_HISTORY_PHOTO, caption, keyboard: Markup.inlineKeyboard(rows) });
  } catch (err) {
    console.error('Deposit history handler error:', err.message);
    ctx.answerCbQuery('⚠️ Something went wrong. Please try again.', { show_alert: true }).catch(() => {});
  }
}

async function downloadDepositHistoryPdfHandler(ctx) {
  try {
    const telegramId = ctx.from.id;
    const allDeposits = await fetchAllDeposits(telegramId);

    if (allDeposits.length === 0) {
      return ctx.answerCbQuery('You haven\'t made any deposits yet.', { show_alert: true });
    }

    ctx.answerCbQuery('📄 Generating your PDF...').catch(() => {});

    const user = {
      telegram_id: telegramId,
      first_name: ctx.from.first_name,
      username: ctx.from.username,
    };

    const pdfBuffer = await generateDepositHistoryPdf(user, allDeposits);

    await ctx.replyWithDocument(
      { source: pdfBuffer, filename: `deposit-history-${telegramId}.pdf` },
      { caption: `📄 <b>Your complete deposit history</b>\n${allDeposits.length} total deposit${allDeposits.length === 1 ? '' : 's'}`, parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('Download deposit history PDF error:', err.message);
    ctx.answerCbQuery('⚠️ Something went wrong. Please try again.', { show_alert: true }).catch(() => {});
  }
}

module.exports = { depositHistoryHandler, downloadDepositHistoryPdfHandler };
