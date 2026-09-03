const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { WELCOME_PHOTO, mainMenuKeyboard, welcomeCaption } = require('../ui/mainMenu');

async function mainMenuHandler(ctx) {
  const tgUser = ctx.from;

  try {
    await sendOrEditUI(ctx, {
      photo: WELCOME_PHOTO,
      caption: welcomeCaption(tgUser, false),
      keyboard: mainMenuKeyboard,
    });
  } catch (err) {
    console.error('Main menu handler error:', err.message);
    // FIX: previously silent — user tapped the button and got nothing back.
    ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
  }
}

module.exports = mainMenuHandler;
