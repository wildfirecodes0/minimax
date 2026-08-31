const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { setState, getState, clearState } = require('../utils/stateManager');
const { mainMenuKeyboard, welcomeCaption, WELCOME_PHOTO } = require('../ui/mainMenu');
const { PAYMENT_LINK, BOT_USERNAME, REFERRAL_DEPOSIT_PERCENT } = require('../config');

// Deposit / QR photo
const DEPOSIT_PHOTO = 'https://i.ibb.co/PzW6bwBc/IMG-20260827-080855.png';

const VERIFY_API_BASE = 'https://rparinfo.onrender.com/api/verify-by-utr';

const cancelKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 Back', 'menu_main')],
]);

const depositKeyboard = Markup.inlineKeyboard([
  [Markup.button.url('🚀 Pay', PAYMENT_LINK)],
  [
    Markup.button.callback('🔙 Back', 'menu_main'),
    Markup.button.callback('🦋 Paid', 'deposit_paid'),
  ],
  [Markup.button.callback('⭐ Pay with Telegram Stars (Instant)', 'deposit_stars')],
]);

// ---- Step 1: Show QR + Pay screen ----
async function depositHandler(ctx) {
  try {
    const caption =
      `➕ <b>Deposit RP💎 Balance</b>\n\n` +
      `Scan the QR code above or tap 🚀 Pay to complete your payment via Any UPI App.\n\n` +
      `Once paid, tap 🦋 Paid below and send your Transaction ID.\n\n` +
      `⭐ <b>Prefer instant, automatic deposit?</b> Tap "Pay with Telegram Stars" below — no waiting, credited immediately.`;

    await sendOrEditUI(ctx, { photo: DEPOSIT_PHOTO, caption, keyboard: depositKeyboard });
  } catch (err) {
    console.error('Deposit handler error:', err.message);
  }
}

// ---- Step 2: "Paid" clicked -> ask for Transaction ID ----
async function depositPaidHandler(ctx) {
  const userId = ctx.from.id;

  try {
    const caption = `💜 <b>Send Transaction Order ID:</b>`;

    const messageId = await sendOrEditUI(ctx, {
      photo: DEPOSIT_PHOTO,
      caption,
      keyboard: cancelKeyboard,
    });

    // Mark this user as "awaiting transaction id" text input
    setState(userId, 'awaiting_transaction_id', {}, messageId);
  } catch (err) {
    console.error('Deposit paid handler error:', err.message);
  }
}

const resultKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 Return To Menu', 'menu_main')],
]);

// ---- Step 3: User sends Transaction ID as text -> verify via API ----
async function handleTransactionIdText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);

  if (!state || state.step !== 'awaiting_transaction_id') return false; // not in this flow

  const transactionId = ctx.message.text.trim();
  clearState(userId);

  try {
    const response = await fetch(`${VERIFY_API_BASE}/${encodeURIComponent(transactionId)}`);
    const result = await response.json().catch(() => null);

    // Real API shape:
    // { success: true, data: { payment_id, status, captured, amount, amount_paise,
    //   currency, date, time, method, ... } }
    const payment = result?.data;
    const isCaptured =
      result?.success === true && payment?.captured === true && payment?.status === 'captured';

    if (!response.ok || !isCaptured || !payment?.amount) {
      await sendOrEditUI(ctx, {
        photo: DEPOSIT_PHOTO,
        caption:
          `❌ <b>Verification Failed</b>\n\n` +
          `We couldn't verify Transaction ID: <code>${transactionId}</code>\n` +
          `Please check the ID and try again, or contact support.`,
        keyboard: resultKeyboard,
      });
      return true;
    }

    const amountInr = Number(payment.amount);
    const rpCredited = amountInr / 10; // Rate: 10 INR = 1 RP💎

    // Insert the transaction record FIRST — the `payment_id` column has a
    // UNIQUE constraint in the database, so if two requests for the same
    // transaction ID race each other, only ONE insert can ever succeed.
    // This is what actually prevents double-crediting (checking-then-inserting
    // separately would leave a race window).
    const { error: insertTxnError } = await supabase.from('transactions').insert([
      {
        telegram_id: userId,
        payment_id: payment.payment_id,
        amount_inr: amountInr,
        rp_credited: rpCredited,
      },
    ]);

    if (insertTxnError) {
      // Unique violation (Postgres code 23505) -> someone already used this ID
      if (insertTxnError.code === '23505') {
        await sendOrEditUI(ctx, {
          photo: DEPOSIT_PHOTO,
          caption: `⚠️ <b>Already Used</b>\n\nThis Transaction ID has already been credited before.`,
          keyboard: resultKeyboard,
        });
        return true;
      }

      console.error('Transaction insert error:', insertTxnError.message);
      await sendOrEditUI(ctx, {
        photo: DEPOSIT_PHOTO,
        caption: `⚠️ Something went wrong while recording your payment. Please try again or contact support.`,
        keyboard: resultKeyboard,
      });
      return true;
    }

    // Fetch current user, then update balance + deposit_amount
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('balance, deposit_amount, referred_by')
      .eq('telegram_id', userId)
      .single();

    if (fetchError || !user) {
      console.error('User fetch error during deposit:', fetchError?.message);
      await sendOrEditUI(ctx, {
        photo: DEPOSIT_PHOTO,
        caption: `⚠️ Payment verified but we could not update your balance. Please contact support.`,
        keyboard: resultKeyboard,
      });
      return true;
    }

    const newBalance = Number(user.balance || 0) + rpCredited;
    const newDeposit = Number(user.deposit_amount || 0) + rpCredited;

    const { error: updateError } = await supabase
      .from('users')
      .update({ balance: newBalance, deposit_amount: newDeposit })
      .eq('telegram_id', userId);

    if (updateError) {
      console.error('Balance update error:', updateError.message);
      // Compensate: remove the transaction record so the user can retry
      // this same Transaction ID without being told "already used".
      await supabase.from('transactions').delete().eq('payment_id', payment.payment_id);
      await sendOrEditUI(ctx, {
        photo: DEPOSIT_PHOTO,
        caption: `⚠️ Payment verified but balance update failed. Please try again or contact support.`,
        keyboard: resultKeyboard,
      });
      return true;
    }

    // Confirm to the user (edits the same session message — no new clutter)
    await sendOrEditUI(ctx, {
      photo: DEPOSIT_PHOTO,
      caption:
        `✅ <b>Deposit Successful!</b>\n\n` +
        `💎 <b>Credited:</b> <code>${rpCredited}</code> RP💎\n` +
        `💰 <b>New Balance:</b> <code>${newBalance}</code> RP💎`,
      keyboard: resultKeyboard,
    });

    // Referral commission — the depositor's referrer (if any) gets a lifetime
    // cut of every deposit their referral makes.
    if (user.referred_by) {
      const referralBonus = rpCredited * (REFERRAL_DEPOSIT_PERCENT / 100);

      const { data: referrer, error: referrerFetchError } = await supabase
        .from('users')
        .select('balance')
        .eq('telegram_id', user.referred_by)
        .single();

      if (!referrerFetchError && referrer) {
        const referrerNewBalance = Number(referrer.balance || 0) + referralBonus;

        const { error: referrerUpdateError } = await supabase
          .from('users')
          .update({ balance: referrerNewBalance })
          .eq('telegram_id', user.referred_by);

        if (!referrerUpdateError) {
          const buyerName = ctx.from.first_name || 'Your referral';
          await ctx.telegram
            .sendMessage(
              user.referred_by,
              `🎉 <b>Referral Bonus!</b>\n\n` +
              `${buyerName} just deposited, and you earned <b>${referralBonus} RP💎</b> (${REFERRAL_DEPOSIT_PERCENT}%)!\n` +
              `💰 New Balance: <code>${referrerNewBalance}</code> RP💎`,
              { parse_mode: 'HTML' }
            )
            .catch((err) => console.error('Referral deposit notify error:', err.message));
        } else {
          console.error('Referral deposit bonus update error:', referrerUpdateError.message);
        }
      }
    }

    // Auto-post to public channel
    const channelId = process.env.PUBLIC_CHANNEL_ID;
    if (channelId) {
      // Mask the transaction/payment ID for privacy — keep the first half visible
      const rawId = payment.payment_id || '';
      const maskedId = rawId.length > 8 ? `${rawId.slice(0, Math.ceil(rawId.length / 2))}******` : rawId;

      // Real, accurate date — prefer the payment's own unix timestamp
      // (most reliable) over its separate date string
      const realDate = payment.timestamp_unix
        ? new Date(payment.timestamp_unix * 1000).toLocaleDateString('en-IN', { dateStyle: 'medium' })
        : payment.date;

      const methodLabel = (payment.method || 'N/A').toUpperCase();
      const buyerName = ctx.from.first_name || 'A user';

      await ctx.telegram
        .sendMessage(
          channelId,
          `❤️ New <b>Deposit Arrived!</b> ❤️\n\n` +
          `👤 <b>${buyerName}</b> deposited:\n` +
          `~ <b>₹${payment.amount} INR</b> (<i>${rpCredited} RP💎</i>) by ${methodLabel}\n\n` +
          `📎 <b>Transaction ID:</b> <code>${maskedId}</code>\n\n` +
          `📅 <b>Date:</b> ${realDate}\n\n` +
          `🤩 <i>Get Now Your Advanced Bots & APIs Here</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('🤖 Get Bots & APIs Now', `https://t.me/${BOT_USERNAME}`)]]),
          }
        )
        .catch((err) => console.error('Channel post error:', err.message));
    }
  } catch (err) {
    console.error('Transaction verify error:', err.message);
    await sendOrEditUI(ctx, {
      photo: DEPOSIT_PHOTO,
      caption: `⚠️ Something went wrong while verifying your payment. Please try again or contact support.`,
      keyboard: resultKeyboard,
    });
  }

  return true;
}

module.exports = { depositHandler, depositPaidHandler, handleTransactionIdText };
