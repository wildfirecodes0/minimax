const { Markup } = require('telegraf');
const { sendOrEditUI } = require('../utils/messageManager');
const { WELCOME_PHOTO } = require('../ui/mainMenu');
const {
  FORCE_JOIN_CHANNEL_USERNAME,
  FORCE_JOIN_CHANNEL_LINK,
  FORCE_JOIN_CHANNEL_NAME,
} = require('../config');
const { setState, getState } = require('../utils/stateManager');
const { get, set, invalidate, TTL } = require('../utils/cache');

/**
 * Checks whether a user is currently a member of the mandatory channel.
 * Result is cached for 3 minutes — this is called on EVERY interaction so
 * without cache it adds 300-500ms to every single button press.
 *
 * NOTE: the bot must be an ADMIN of that channel for this check to work
 * reliably — otherwise Telegram may reject the getChatMember call.
 */
async function isChannelMember(telegram, userId) {
  const cacheKey = `channel_member:${userId}`;
  const cached = get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const member = await telegram.getChatMember(FORCE_JOIN_CHANNEL_USERNAME, userId);
    const isMember = ['member', 'administrator', 'creator'].includes(member.status);
    set(cacheKey, isMember, TTL.CHANNEL_MEMBER);
    return isMember;
  } catch (err) {
    console.error(
      `Force-join check failed (is the bot an admin of ${FORCE_JOIN_CHANNEL_USERNAME}?):`,
      err.message
    );
    // Fail-safe: if we genuinely can't verify, don't lock everyone out.
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
  // Invalidate cache so we do a fresh check when they click "I've Joined"
  invalidate(`channel_member:${ctx.from.id}`);

  const joined = await isChannelMember(ctx.telegram, ctx.from.id);

  if (!joined) {
    return ctx.answerCbQuery("❌ You haven't joined yet. Please join first.", { show_alert: true });
  }

  await ctx.answerCbQuery('✅ Verified! Welcome.');

  // NOTE: ctx.startPayload is NOT available here (callback query context).
  // The referral payload was saved to stateManager by bot.js middleware
  // before the force-join gate ran. startHandler reads it back from there.
  const startHandler = require('./start');
  return startHandler(ctx);
}

module.exports = { isChannelMember, sendJoinPrompt, checkJoinHandler };
