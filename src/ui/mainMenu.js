const { Markup } = require('telegraf');

// Welcome / Main Menu photo (shown on /start and "Return To Menu")
const WELCOME_PHOTO = 'https://i.ibb.co/R4GNQxKT/Chat-GPT-Image-Aug-25-2026-03-14-32-PM.png';

// Main menu inline keyboard — reused everywhere "Return to Menu" is needed
const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('👤 Profile', 'menu_profile')],
  [
    Markup.button.callback('✅ Buy API', 'menu_buy_api'),
    Markup.button.callback('✳️ Buy Bot', 'menu_buy_bot'),
  ],
  [{ ...Markup.button.callback('🩸 Invite Your Friends', 'menu_invite'), style: 'success' }],
  [
    Markup.button.callback('🕸 About Us', 'menu_about_us'),
    Markup.button.url('🎫 Support', 'https://t.me/RaushanKakhaura'),
  ],
]);

function welcomeCaption(tgUser, isNew) {
  if (isNew) {
    return (
      `🎉 <b>Welcome to Mini Max Seller Bot!</b>\n\n` +
      `👋 Hi <b>${tgUser.first_name}</b>!\n\n` +
      `🛒 Browse products and place your orders right here.\n\n` +
      `📌 Use the menu below to get started.`
    );
  }
  return (
    `👋 <b>Welcome back, ${tgUser.first_name}!</b>\n\n` +
    `🛍️ Ready to explore? Use the menu below to browse products or manage your account.`
  );
}

module.exports = { WELCOME_PHOTO, mainMenuKeyboard, welcomeCaption };
