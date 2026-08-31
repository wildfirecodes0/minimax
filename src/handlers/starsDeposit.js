const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { setState, getState, clearState } = require('../utils/stateManager');
const { STARS_PER_RP, BOT_USERNAME, REFERRAL_DEPOSIT_PERCENT } = require('../config');

// Reuse the same QR/deposit visual so the whole Deposit section feels consistent
const DEPOSIT_PHOTO = 'https://i.ibb.co/PzW6bwBc/IMG-20260827-080855.png';

// Quick-buy Star packages shown as buttons (amount in Stars)
const STAR_PACKAGES = [75, 150, 375, 750, 1500];

const resultKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 Return To Menu', 'menu_main')],
]);

function formatRp(rp) {
  // Trim trailing zeros but keep it readable (e.g. 5, 5.4, 5.33)
  return Number(rp.toFixed(4)).toString();
}

// ---- Step 1: Show Stars package picker ----
async function starsDepositHandler(ctx) {
  try {
    const rows = STAR_PACKAGES.map((stars) => [
      Markup.button.callback(
        `⭐ ${stars} Stars  →  ${formatRp(stars / STARS_PER_RP)} RP💎`,
        `stars_pkg:${stars}`
      ),
    ]);
    rows.push([Markup.button.callback('✏️ Custom Amount', 'stars_custom')]);
    rows.push([Markup.button.callback('🔙 Back', 'profile_deposit')]);

    const caption =
      `⭐ <b>Deposit with Telegram Stars</b>\n\n` +
      `Instant &amp; fully automatic — no waiting for verification!\n\n` +
      `💱 <b>Rate:</b> <code>${STARS_PER_RP} Stars = 1 RP💎</code>\n\n` +
      `Choose a package below, or enter a custom amount:`;

    await sendOrEditUI(ctx, { photo: DEPOSIT_PHOTO, caption, keyboard: Markup.inlineKeyboard(rows) });
  } catch (err) {
    console.error('Stars deposit handler error:', err.message);
  }
}

// ---- Step 2a: Preset package button tapped ----
async function starsPackageHandler(starsAmount, ctx) {
  try {
    await ctx.answerCbQuery();
    await sendStarsInvoice(ctx, starsAmount);
  } catch (err) {
    console.error('Stars package handler error:', err.message);
  }
}

// ---- Step 2b: "Custom Amount" tapped -> ask user to type a number ----
async function startCustomStarsAmount(ctx) {
  const userId = ctx.from.id;
  try {
    const caption =
      `<i>How many <b>Telegram Stars</b> you want to pay</i>`;

    const messageId = await sendOrEditUI(ctx, {
      photo: DEPOSIT_PHOTO,
      caption,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'profile_deposit')]]),
    });

    setState(userId, 'awaiting_stars_amount', {}, messageId);
  } catch (err) {
    console.error('Start custom stars amount error:', err.message);
  }
}

// ---- Step 2c: User typed the custom Stars amount ----
async function handleCustomStarsAmountText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'awaiting_stars_amount') return false;

  clearState(userId);

  const raw = ctx.message.text.trim();
  const starsAmount = Number(raw);

  if (!Number.isInteger(starsAmount) || starsAmount < 1) {
    await sendOrEditUI(ctx, {
      photo: DEPOSIT_PHOTO,
      caption:
        `⚠️ <b>Invalid Amount</b>\n\n` +
        `Please enter a whole number of Stars, minimum <code>1</code>.`,
      keyboard: resultKeyboard,
    });
    return true;
  }

  await sendStarsInvoice(ctx, starsAmount);
  return true;
}

// ---- Sends the actual Telegram Stars invoice (currency = XTR) ----
async function sendStarsInvoice(ctx, starsAmount) {
  const rpCredited = starsAmount / STARS_PER_RP;

  // Telegram's invoice card itself does NOT render HTML — title/description
  // there are always shown as plain text. So the nicely formatted line goes
  // as a normal chat message right before the invoice, and the invoice card
  // gets a clean plain-text version of the same info.
  await ctx.reply(
    `👌 <b>Instantly credit ${formatRp(rpCredited)} RP💎 to your wallet by paying ${starsAmount} Telegram Stars.</b>`,
    { parse_mode: 'HTML' }
  );

  await ctx.replyWithInvoice({
    title: `Deposit ${formatRp(rpCredited)} RP💎`,
    description: `Instantly credit ${formatRp(rpCredited)} RP💎 to your wallet by paying ${starsAmount} Telegram Stars.`,
    payload: `stars_deposit:${ctx.from.id}:${starsAmount}`,
    provider_token: '', // empty string = Telegram Stars payment (no external payment provider needed)
    currency: 'XTR',
    prices: [{ label: `${starsAmount} Stars`, amount: starsAmount }],
  });
}

// ---- Telegram calls this right before charging the user — must approve within 10s ----
async function preCheckoutHandler(ctx) {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('Pre-checkout error:', err.message);
  }
}

// ---- Fires the moment Telegram confirms the Stars payment — fully automatic ----
async function successfulPaymentHandler(ctx) {
  const payment = ctx.message?.successful_payment;
  if (!payment) return;

  const userId = ctx.from.id;
  const starsAmount = payment.total_amount; // for XTR this IS the Star count (no /100)
  const chargeId = payment.telegram_payment_charge_id;
  const rpCredited = starsAmount / STARS_PER_RP;

  try {
    // Insert first — unique constraint on charge_id blocks any double-credit
    // if Telegram ever redelivers this update.
    const { error: insertTxnError } = await supabase.from('star_transactions').insert([
      {
        telegram_id: userId,
        charge_id: chargeId,
        stars_amount: starsAmount,
        rp_credited: rpCredited,
      },
    ]);

    if (insertTxnError) {
      if (insertTxnError.code === '23505') {
        console.log(`Stars payment ${chargeId} already credited — skipping duplicate.`);
        return;
      }
      console.error('Star transaction insert error:', insertTxnError.message);
      await ctx.reply('⚠️ Payment received but recording it failed. Please contact support with your payment details.');
      return;
    }

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('balance, deposit_amount, referred_by')
      .eq('telegram_id', userId)
      .single();

    if (fetchError || !user) {
      console.error('User fetch error during stars deposit:', fetchError?.message);
      await ctx.reply('⚠️ Payment received but we could not update your balance. Please contact support.');
      return;
    }

    const newBalance = Number(user.balance || 0) + rpCredited;
    const newDeposit = Number(user.deposit_amount || 0) + rpCredited;

    const { error: updateError } = await supabase
      .from('users')
      .update({ balance: newBalance, deposit_amount: newDeposit })
      .eq('telegram_id', userId);

    if (updateError) {
      console.error('Balance update error (stars):', updateError.message);
      await supabase.from('star_transactions').delete().eq('charge_id', chargeId);
      await ctx.reply('⚠️ Payment received but balance update failed. Please try again or contact support.');
      return;
    }

    // ── Confirm to the buyer ─────────────────────────────────────────────
    await sendOrEditUI(ctx, {
      photo: DEPOSIT_PHOTO,
      caption:
        `✅ <b>Deposit Successful!</b>\n\n` +
        `⭐ <b>Paid:</b> <code>${starsAmount}</code> Telegram Stars\n` +
        `💎 <b>Credited:</b> <code>${formatRp(rpCredited)}</code> RP💎\n` +
        `💰 <b>New Balance:</b> <code>${formatRp(newBalance)}</code> RP💎`,
      keyboard: resultKeyboard,
    });

    // ── Referral commission (same lifetime % as INR deposits) ───────────
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
              `${buyerName} just deposited via Stars, and you earned <b>${formatRp(referralBonus)} RP💎</b> (${REFERRAL_DEPOSIT_PERCENT}%)!\n` +
              `💰 New Balance: <code>${formatRp(referrerNewBalance)}</code> RP💎`,
              { parse_mode: 'HTML' }
            )
            .catch((err) => console.error('Referral stars notify error:', err.message));
        } else {
          console.error('Referral stars bonus update error:', referrerUpdateError.message);
        }
      }
    }

    // ── Auto-post to public channel — same format style as the INR announcement ──
    const channelId = process.env.PUBLIC_CHANNEL_ID;
    if (channelId) {
      const maskedId =
        chargeId.length > 8 ? `${chargeId.slice(0, Math.ceil(chargeId.length / 2))}******` : chargeId;
      const realDate = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });
      const buyerName = ctx.from.first_name || 'A user';

      await ctx.telegram
        .sendMessage(
          channelId,
          `❤️ New <b>Deposit Arrived!</b> ❤️\n\n` +
          `👤 <b>${buyerName}</b> deposited:\n` +
          `~ <b>${starsAmount} ⭐ Telegram Stars</b> (<i>${formatRp(rpCredited)} RP💎</i>)\n\n` +
          `📎 <b>Charge ID:</b> <code>${maskedId}</code>\n\n` +
          `📅 <b>Date:</b> ${realDate}\n\n` +
          `🤩 <i>Get Now Your Advanced Bots &amp; APIs Here</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('🤖 Get Bots & APIs Now', `https://t.me/${BOT_USERNAME}`)]]),
          }
        )
        .catch((err) => console.error('Channel post error (stars):', err.message));
    }
  } catch (err) {
    console.error('Successful payment (stars) handler error:', err.message);
    await ctx.reply('⚠️ Something went wrong while processing your Stars payment. Please contact support.').catch(() => {});
  }
}

module.exports = {
  starsDepositHandler,
  starsPackageHandler,
  startCustomStarsAmount,
  handleCustomStarsAmountText,
  preCheckoutHandler,
  successfulPaymentHandler,
};
