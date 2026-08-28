/**
 * Message Manager
 * -----------------
 * Handles the "single editable message" UI pattern used throughout the bot.
 * Instead of sending a new message every time, we track the last message_id
 * per user and EDIT it (caption + photo + buttons) instead of sending a new one.
 *
 * NOTE: Currently using in-memory storage (Map) for speed during development.
 * Once all features are finalized, we'll move this to a Supabase table
 * (e.g. `user_sessions`) so it survives bot restarts. SQL for that will be
 * included in the final combined schema.
 */

const fs = require('fs');
const path = require('path');

const sessions = new Map(); // telegram_id -> { chatId, messageId }

// Caches the Telegram file_id returned after the FIRST upload of each local
// image. Every subsequent send/edit reuses that file_id instead of
// re-uploading the raw file — this is what makes repeat menu navigation fast.
const fileIdCache = new Map(); // local photo path -> telegram file_id

function setSession(userId, chatId, messageId) {
  sessions.set(userId, { chatId, messageId });
}

function getSession(userId) {
  return sessions.get(userId);
}

function clearSession(userId) {
  sessions.delete(userId);
}

/**
 * Accepts either:
 *  - a full http(s) URL (used as-is)
 *  - a Telegram file_id (used as-is)
 *  - a local file path (read from disk and uploaded — but only on first use;
 *    after that the cached file_id is reused)
 */
function resolvePhotoSource(photo) {
  if (/^https?:\/\//i.test(photo)) return photo;
  if (fileIdCache.has(photo)) return fileIdCache.get(photo); // instant, no upload
  const resolvedPath = path.isAbsolute(photo) ? photo : path.join(process.cwd(), photo);
  if (fs.existsSync(resolvedPath)) {
    return { source: fs.createReadStream(resolvedPath) };
  }
  // Not a URL and not a local file -> assume it's already a Telegram file_id
  return photo;
}

/**
 * After a successful send/edit, remembers the file_id Telegram assigned to
 * this photo so future uses skip the re-upload entirely.
 */
function cachePhotoResult(photoKey, resultMessage) {
  if (/^https?:\/\//i.test(photoKey) || fileIdCache.has(photoKey)) return;
  const photos = resultMessage && resultMessage.photo;
  if (Array.isArray(photos) && photos.length > 0) {
    fileIdCache.set(photoKey, photos[photos.length - 1].file_id);
  }
}

/**
 * Sends a new photo+caption message OR edits the existing one for this user.
 *
 * @param {object} ctx - Telegraf context
 * @param {object} options
 * @param {string} options.photo - Photo URL or file_id
 * @param {string} options.caption - HTML formatted caption text
 * @param {object} [options.keyboard] - Inline keyboard markup (optional)
 */
/**
 * Retries an async function once after a short delay if it fails —
 * helps ride out transient network blips (e.g. "socket hang up") without
 * crashing or leaving the user with no response at all.
 */
async function withRetry(fn, retries = 1, delayMs = 300) {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      await new Promise((res) => setTimeout(res, delayMs));
      return withRetry(fn, retries - 1, delayMs);
    }
    throw err;
  }
}

async function sendOrEditUI(ctx, { photo, caption, keyboard }) {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const session = getSession(userId);

  // Telegram hard-limits photo captions to 1024 characters. If a caption
  // exceeds that, editMessageMedia/sendPhoto silently fail — trim it here so
  // that never happens (this is what caused "About Us" to always send a new
  // message instead of editing: its caption was 1381 characters).
  const CAPTION_LIMIT = 1024;
  const safeCaption =
    caption.length > CAPTION_LIMIT ? caption.slice(0, CAPTION_LIMIT - 1) + '…' : caption;

  const extra = {
    caption: safeCaption,
    parse_mode: 'HTML',
    ...(keyboard ? { reply_markup: keyboard.reply_markup || keyboard } : {}),
  };

  // Try editing the existing message first
  if (session && session.chatId === chatId) {
    try {
      const result = await withRetry(() =>
        ctx.telegram.editMessageMedia(
          chatId,
          session.messageId,
          undefined,
          { type: 'photo', media: resolvePhotoSource(photo), caption: safeCaption, parse_mode: 'HTML' },
          keyboard ? { reply_markup: keyboard.reply_markup || keyboard } : {}
        )
      );
      cachePhotoResult(photo, result);
      return session.messageId;
    } catch (err) {
      // Telegram throws this when the new content is identical to what's
      // already showing (e.g. double-tapping the same button) — that's not
      // a real failure, just a no-op, so don't fall through to sending a
      // brand new message (which would defeat the whole point of editing).
      if (err.description && err.description.includes('message is not modified')) {
        return session.messageId;
      }
      // Message might be too old / deleted by user / not editable -> fallback to sending new
      console.warn('Edit failed, sending new message instead:', err.message);
    }
  }

  // Send a fresh message (with retry — a NEW file stream is created on every attempt,
  // since a stream can only be read once)
  try {
    const sent = await withRetry(() => ctx.replyWithPhoto(resolvePhotoSource(photo), extra));
    cachePhotoResult(photo, sent);
    setSession(userId, chatId, sent.message_id);
    return sent.message_id;
  } catch (err) {
    // Photo delivery failed even after retries (e.g. network issue) —
    // fall back to a text-only message so the user still gets a response.
    console.error('Photo send failed after retries, falling back to text:', err.message);
    const sent = await ctx.reply(caption, {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: keyboard.reply_markup || keyboard } : {}),
    });
    setSession(userId, chatId, sent.message_id);
    return sent.message_id;
  }
}

module.exports = { sendOrEditUI, setSession, getSession, clearSession, resolvePhotoSource, cachePhotoResult };
