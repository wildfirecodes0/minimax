const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { WELCOME_PHOTO, mainMenuKeyboard, welcomeCaption } = require('../ui/mainMenu');
const { REFERRAL_SIGNUP_BONUS } = require('../config');
const { setState, getState, clearState } = require('../utils/stateManager');

async function startHandler(ctx) {
  const tgUser = ctx.from;

  // In a callback query context (called from checkJoinHandler), ctx.chat can
  // sometimes be null if Telegraf couldn't resolve it. Fall back to
  // callbackQuery.message.chat so sendOrEditUI always has a valid chatId.
  if (!ctx.chat && ctx.callbackQuery?.message?.chat) {
    ctx.chat = ctx.callbackQuery.message.chat;
  }

  try {
    // Use maybeSingle() instead of single() — maybeSingle() returns null (no error)
    // when 0 rows are found, whereas single() throws PGRST116 which we have to
    // special-case. maybeSingle() is simpler and safer.
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('telegram_id')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Fetch error in startHandler:', fetchError.message);
      // Don't block the user — if we can't check, proceed to insert attempt
      // The unique constraint on telegram_id will prevent duplicates.
    }

    if (existingUser) {
      // Already registered — show welcome-back UI
      return sendOrEditUI(ctx, {
        photo: WELCOME_PHOTO,
        caption: welcomeCaption(tgUser, false),
        keyboard: mainMenuKeyboard,
      });
    }

    // ── Referral payload ─────────────────────────────────────────────────────
    // ctx.startPayload is set when called directly from bot.start().
    // When called from checkJoinHandler (callback), we read it from stateManager
    // where bot.js middleware saved it before the force-join gate ran.
    let startPayload = ctx.startPayload || null;

    if (!startPayload) {
      const savedState = getState(tgUser.id);
      if (savedState && savedState.step === 'pending_start' && savedState.data?.startPayload) {
        startPayload = savedState.data.startPayload;
      }
    }

    // Clear pending_start state now that we've consumed it
    const currentState = getState(tgUser.id);
    if (currentState && currentState.step === 'pending_start') {
      clearState(tgUser.id);
    }

    let referredBy = null;
    if (startPayload && startPayload.startsWith('ref_')) {
      const referrerId = Number(startPayload.slice(4));
      if (Number.isInteger(referrerId) && referrerId !== tgUser.id) {
        const { data: referrerExists } = await supabase
          .from('users')
          .select('telegram_id')
          .eq('telegram_id', referrerId)
          .maybeSingle();
        if (referrerExists) referredBy = referrerId;
      }
    }

    // ── Insert new user ───────────────────────────────────────────────────────
    const { error: insertError } = await supabase.from('users').insert([
      {
        telegram_id: tgUser.id,
        username: tgUser.username || null,
        first_name: tgUser.first_name || null,
        last_name: tgUser.last_name || null,
        role: 'buyer',
        referred_by: referredBy,
      },
    ]);

    if (insertError) {
      // Unique constraint violation = user was inserted by a concurrent request
      // (e.g. double-click on "I've Joined"). Treat as already-registered.
      if (insertError.code === '23505') {
        console.log(`User ${tgUser.id} already exists (race condition) — showing welcome-back.`);
        return sendOrEditUI(ctx, {
          photo: WELCOME_PHOTO,
          caption: welcomeCaption(tgUser, false),
          keyboard: mainMenuKeyboard,
        });
      }

      console.error('Insert error:', insertError.code, insertError.message);
      return ctx.reply('⚠️ Something went wrong while registering you. Please try again.');
    }

    // ── Welcome new user ─────────────────────────────────────────────────────
    await sendOrEditUI(ctx, {
      photo: WELCOME_PHOTO,
      caption: welcomeCaption(tgUser, true),
      keyboard: mainMenuKeyboard,
    });

    // ── Referral signup bonus ────────────────────────────────────────────────
    if (referredBy) {
      const { data: referrer, error: referrerFetchError } = await supabase
        .from('users')
        .select('balance')
        .eq('telegram_id', referredBy)
        .maybeSingle();

      if (!referrerFetchError && referrer) {
        const referrerNewBalance = Number(referrer.balance || 0) + REFERRAL_SIGNUP_BONUS;
        const { error: referrerUpdateError } = await supabase
          .from('users')
          .update({ balance: referrerNewBalance })
          .eq('telegram_id', referredBy);

        if (!referrerUpdateError) {
          await ctx.telegram
            .sendMessage(
              referredBy,
              `🎉 <b>New Referral!</b>\n\n` +
              `${tgUser.first_name} just joined using your referral link! You earned <b>${REFERRAL_SIGNUP_BONUS} RP💎</b>.\n` +
              `💰 New Balance: <code>${referrerNewBalance}</code> RP💎`,
              { parse_mode: 'HTML' }
            )
            .catch((err) => console.error('Referral signup notify error:', err.message));
        } else {
          console.error('Referral signup bonus update error:', referrerUpdateError.message);
        }
      }
    }

    // ── Notify admin ─────────────────────────────────────────────────────────
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
      const usernameText = tgUser.username ? `@${tgUser.username}` : '<i>(no username)</i>';
      await ctx.telegram
        .sendMessage(
          adminChatId,
          `🆕 <b>New User Registered</b>\n\n` +
          `👤 <b>Name:</b> ${tgUser.first_name} ${tgUser.last_name || ''}\n` +
          `🔗 <b>Username:</b> ${usernameText}\n` +
          `🆔 <b>Telegram ID:</b> <code>${tgUser.id}</code>\n` +
          `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
          { parse_mode: 'HTML' }
        )
        .catch((err) => console.error('Admin new-user notify error:', err.message));
    }
  } catch (err) {
    console.error('Start handler error:', err.message);
    ctx.reply('⚠️ Unexpected error. Please try again later.').catch(() => {});
  }
}

module.exports = startHandler;
