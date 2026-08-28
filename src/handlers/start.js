const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { WELCOME_PHOTO, mainMenuKeyboard, welcomeCaption } = require('../ui/mainMenu');

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

    // New user -> insert into Supabase
    const { error: insertError } = await supabase.from('users').insert([
      {
        telegram_id: tgUser.id,
        username: tgUser.username || null,
        first_name: tgUser.first_name || null,
        last_name: tgUser.last_name || null,
        role: 'buyer',
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
