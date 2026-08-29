const { Markup } = require('telegraf');
const supabase = require('../../supabase');
const { sendOrEditUI } = require('../../utils/messageManager');
const { setState, getState, clearState } = require('../../utils/stateManager');
const { getAdminRole } = require('../../utils/isAdmin');
const { showPanel } = require('./panel');

const ADMIN_PHOTO = './src/assets/adminpanel.png';

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Send Now', 'admin:broadcast:confirm'),
      Markup.button.callback('❌ Cancel', 'admin:broadcast:cancel'),
    ],
  ]);
}

async function startBroadcast(ctx) {
  setState(ctx.from.id, 'admin_broadcast');

  const caption =
    `📢 <b>Broadcast Message</b>\n\n` +
    `Send what you want to broadcast to <b>all users</b> — plain text, a photo, video, GIF, or document (with an optional caption).`;
  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption,
    keyboard: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin:panel')]]),
  });
}

async function cleanupPreview(ctx, state) {
  const previewMessageId = state?.data?.previewMessageId;
  if (previewMessageId) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, previewMessageId);
    } catch (err) {
      // already gone — ignore
    }
  }
}

// ---- Plain text broadcast ----
async function handleBroadcastText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'admin_broadcast') return false;
  if (!(await getAdminRole(userId))) { clearState(userId); return true; }

  const text = ctx.message.text;
  setState(userId, 'admin_broadcast_confirm', { kind: 'text', text });

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: `📢 <b>Preview:</b>\n\n${text}\n\n━━━━━━━━━━\nSend this to all users?`,
    keyboard: confirmKeyboard(),
  });
  return true;
}

// ---- Media broadcast (photo / video / animation / document) ----
async function handleBroadcastMedia(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'admin_broadcast') return false;
  if (!(await getAdminRole(userId))) { clearState(userId); return true; }

  let kind;
  let fileId;

  if (ctx.message.photo) {
    kind = 'photo';
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  } else if (ctx.message.video) {
    kind = 'video';
    fileId = ctx.message.video.file_id;
  } else if (ctx.message.animation) {
    kind = 'animation';
    fileId = ctx.message.animation.file_id;
  } else if (ctx.message.document) {
    kind = 'document';
    fileId = ctx.message.document.file_id;
  } else {
    return false;
  }

  const caption = ctx.message.caption || '';
  setState(userId, 'admin_broadcast_confirm', { kind, fileId, caption });

  if (kind === 'photo') {
    // Photos fit our normal persistent-photo pattern directly — no extra preview needed
    await sendOrEditUI(ctx, {
      photo: fileId,
      caption: `${caption ? caption + '\n\n' : ''}━━━━━━━━━━\n📢 Send this to all users?`,
      keyboard: confirmKeyboard(),
    });
    return true;
  }

  // Video / GIF / Document -> send a real preview so the admin can check it,
  // tracked for cleanup once they confirm or cancel.
  try {
    let previewMsg;
    const opts = caption ? { caption, parse_mode: 'HTML' } : {};
    if (kind === 'video') previewMsg = await ctx.replyWithVideo(fileId, opts);
    else if (kind === 'animation') previewMsg = await ctx.replyWithAnimation(fileId, opts);
    else previewMsg = await ctx.replyWithDocument(fileId, opts);

    const s = getState(userId);
    if (s) {
      s.data.previewMessageId = previewMsg.message_id;
      setState(userId, s.step, s.data);
    }
  } catch (err) {
    console.warn('Broadcast preview send failed:', err.message);
  }

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: `📢 <b>Preview sent above ☝️</b>\n\nSend this ${kind} to all users?`,
    keyboard: confirmKeyboard(),
  });
  return true;
}

async function confirmBroadcast(ctx) {
  const state = getState(ctx.from.id);
  if (!state || state.step !== 'admin_broadcast_confirm') {
    return ctx.answerCbQuery('⚠️ Nothing to send.', { show_alert: true });
  }

  const { kind, text, fileId, caption } = state.data;
  await cleanupPreview(ctx, state);
  clearState(ctx.from.id);

  const { data: users, error } = await supabase.from('users').select('telegram_id');
  if (error || !users) {
    console.error('Broadcast fetch users error:', error?.message);
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ Could not fetch users list.`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Panel', 'admin:panel')]]),
    });
    return;
  }

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: `📤 Sending to ${users.length} users... this may take a moment.`,
  });

  let sent = 0;
  let failed = 0;

  for (const u of users) {
    try {
      const chatId = u.telegram_id;
      if (kind === 'text') {
        await ctx.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      } else if (kind === 'photo') {
        await ctx.telegram.sendPhoto(chatId, fileId, { caption, parse_mode: 'HTML' });
      } else if (kind === 'video') {
        await ctx.telegram.sendVideo(chatId, fileId, { caption, parse_mode: 'HTML' });
      } else if (kind === 'animation') {
        await ctx.telegram.sendAnimation(chatId, fileId, { caption, parse_mode: 'HTML' });
      } else if (kind === 'document') {
        await ctx.telegram.sendDocument(chatId, fileId, { caption, parse_mode: 'HTML' });
      }
      sent++;
    } catch (err) {
      failed++;
    }
    // Small delay to avoid Telegram rate limits
    await new Promise((res) => setTimeout(res, 40));
  }

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: `✅ <b>Broadcast complete.</b>\n\nDelivered: ${sent}\nFailed: ${failed}`,
    keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Panel', 'admin:panel')]]),
  });
}

async function cancelBroadcast(ctx) {
  await ctx.answerCbQuery('Cancelled');
  const state = getState(ctx.from.id);
  await cleanupPreview(ctx, state);
  clearState(ctx.from.id);
  return showPanel(ctx, ctx.state.adminRole);
}

module.exports = {
  startBroadcast,
  handleBroadcastText,
  handleBroadcastMedia,
  confirmBroadcast,
  cancelBroadcast,
};
