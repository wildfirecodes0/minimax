const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { WELCOME_PHOTO, mainMenuKeyboard, welcomeCaption } = require('../ui/mainMenu');

async function mainMenuHandler(ctx) {
  const tgUser = ctx.from;

  try {
    await ctx.answerCbQuery();

    await sendOrEditUI(ctx, {
      photo: WELCOME_PHOTO,
      caption: welcomeCaption(tgUser, false),
      keyboard: mainMenuKeyboard,
    });
  } catch (err) {
    console.error('Main menu handler error:', err.message);
  }
}

module.exports = mainMenuHandler;
