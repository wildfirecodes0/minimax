const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { WELCOME_PHOTO, mainMenuKeyboard, welcomeCaption } = require('../ui/mainMenu');
const { REFERRAL_SIGNUP_BONUS } = require('../config');

async function startHandler(ctx) {
  const tgUser = ctx.from;

  try {
    // Check if user already exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', tgUser.id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Fetch error:', fetchError.message);
    }

    if (existingUser) {
      // Already registered — show welcome-back UI (edited, not resent)
      return sendOrEditUI(ctx, {
        photo: WELCOME_PHOTO,
        caption: welcomeCaption(tgUser, false),
        keyboard: mainMenuKeyboard,
      });
    }

    // Parse a referral payload, e.g. /start ref_123456789 (from a link like
    // https://t.me/BotUsername?start=ref_123456789). Ignore anything
    // malformed or self-referral — referredBy stays null in those cases.
    let referredBy = null;
    const startPayload = ctx.startPayload; // telegraf strips the leading "/start "
    if (startPayload && startPayload.startsWith('ref_')) {
      const referrerId = Number(startPayload.slice(4));
      if (Number.isInteger(referrerId) && referrerId !== tgUser.id) {
        const { data: referrerExists } = await supabase
          .from('users')
          .select('telegram_id')
          .eq('telegram_id', referrerId)
          .single();
        if (referrerExists) referredBy = referrerId;
      }
    }

    // New user -> insert into Supabase
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
      console.error('Insert error:', insertError.message);
      return ctx.reply('⚠️ Something went wrong while registering you. Please try again.');
    }

    await sendOrEditUI(ctx, {
      photo: WELCOME_PHOTO,
      caption: welcomeCaption(tgUser, true),
      keyboard: mainMenuKeyboard,
    });

    // One-time referral signup bonus, credited to the referrer right away
    if (referredBy) {
      const { data: referrer, error: referrerFetchError } = await supabase
        .from('users')
        .select('balance')
        .eq('telegram_id', referredBy)
        .single();

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

    // Notify admin about new registration (HTML formatted)
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (adminChatId) {
      const usernameText = tgUser.username ? `@${tgUser.username}` : '<i>(no username)</i>';
      await ctx.telegram.sendMessage(
        adminChatId,
        `🆕 <b>New User Registered</b>\n\n` +
        `👤 <b>Name:</b> ${tgUser.first_name} ${tgUser.last_name || ''}\n` +
        `🔗 <b>Username:</b> ${usernameText}\n` +
        `🆔 <b>Telegram ID:</b> <code>${tgUser.id}</code>\n` +
        `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    console.error('Start handler error:', err.message);
    ctx.reply('⚠️ Unexpected error. Please try again later.');
  }
}

module.exports = startHandler;
