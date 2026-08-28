const { Markup } = require('telegraf');
const { sendOrEditUI } = require('../utils/messageManager');
const { WELCOME_PHOTO } = require('../ui/mainMenu');
const {
  FORCE_JOIN_CHANNEL_USERNAME,
  FORCE_JOIN_CHANNEL_LINK,
  FORCE_JOIN_CHANNEL_NAME,
} = require('../config');

/**
 * Checks whether a user is currently a member of the mandatory channel.
 * NOTE: the bot must be an ADMIN of that channel for this check to work
 * reliably — otherwise Telegram may reject the getChatMember call.
 */
async function isChannelMember(telegram, userId) {
  try {
    const member = await telegram.getChatMember(FORCE_JOIN_CHANNEL_USERNAME, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error(
      `Force-join check failed (is the bot an admin of ${FORCE_JOIN_CHANNEL_USERNAME}?):`,
      err.message
    );
    // Fail-safe: if we genuinely can't verify, don't lock everyone out —
    // only block when Telegram explicitly confirms the user hasn't joined.
    return true;
  }
}

async function sendJoinPrompt(ctx) {
  const caption =
    `🔒 <b>Please join our channel to use this bot!</b>\n\n` +
    `📢 <b>${FORCE_JOIN_CHANNEL_NAME}</b>`;

  await sendOrEditUI(ctx, {
    photo: WELCOME_PHOTO,
    caption,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.url('🔔 Join Channel', FORCE_JOIN_CHANNEL_LINK)],
      [Markup.button.callback("✅ I've Joined", 'check_join')],
    ]),
  });
}

async function checkJoinHandler(ctx) {
  const joined = await isChannelMember(ctx.telegram, ctx.from.id);

  if (!joined) {
    return ctx.answerCbQuery("❌ You haven't joined yet. Please join first.", { show_alert: true });
  }

  await ctx.answerCbQuery('✅ Verified! Welcome.');

  // Re-uses the SAME message (edits it into the main menu) — no separate
  // delete-then-send needed, since sendOrEditUI already tracks this session.
  const startHandler = require('./start');
  return startHandler(ctx);
}

module.exports = { isChannelMember, sendJoinPrompt, checkJoinHandler };
