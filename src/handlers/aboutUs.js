const { Markup } = require('telegraf');
const { sendOrEditUI } = require('../utils/messageManager');
const { BOT_NAME } = require('../config');

// About Us photo
const ABOUT_PHOTO = 'https://i.ibb.co/nqv7pvC3/Chat-GPT-Image-Aug-25-2026-03-17-53-PM.png';

const aboutUsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔙 Return To Menu', 'menu_main')],
]);

async function aboutUsHandler(ctx) {
  try {
    const caption =
      `🕸 <b>About Us & Information</b>\n\n` +
      `Welcome to <b>${BOT_NAME}</b> — your trusted destination for premium Telegram Bots and APIs! 🚀\n\n` +
      `<b>🛠 What We Offer:</b>\n` +
      `• Ready-made, secure Telegram Bots 🤖\n` +
      `• Fast, developer-friendly APIs 🔌\n` +
      `• Secure RP💎 wallet for deposits & spending 💎\n\n` +
      `<b>💡 Why Choose Us?</b>\n` +
      `• Tested for quality & reliability ⚡\n` +
      `• Instant delivery, right in this chat ⏱️\n` +
      `• Your balance & data kept secure 🛡️\n` +
      `• Catalog updated regularly with new tools 📈\n\n` +
      `Thank you for choosing us as your tech partner! ✨`;

    await sendOrEditUI(ctx, { photo: ABOUT_PHOTO, caption, keyboard: aboutUsKeyboard });
  } catch (err) {
    console.error('About Us handler error:', err.message);
    // FIX: previously silent — user tapped the button and got nothing back.
    ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
  }
}

module.exports = aboutUsHandler;
