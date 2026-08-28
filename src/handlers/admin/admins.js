const { Markup } = require('telegraf');
const supabase = require('../../supabase');
const { sendOrEditUI } = require('../../utils/messageManager');
const { setState, getState, clearState } = require('../../utils/stateManager');
const { getAdminRole, isOwner } = require('../../utils/isAdmin');

const ADMIN_PHOTO = './src/assets/adminpanel.png';

async function adminsMenuHandler(ctx) {
  // Owner-only screen — re-verify live every time, don't trust cached state
  if (!(await isOwner(ctx.from.id))) {
    if (ctx.callbackQuery) return ctx.answerCbQuery('🚫 Owner only.', { show_alert: true });
    return;
  }

  const { data: admins, error } = await supabase.from('admins').select('*').order('created_at', { ascending: true });
  if (error) console.error('Admins list error:', error.message);

  let caption = `👑 <b>Manage Admins</b>\n\n`;
  if (!admins || admins.length === 0) {
    caption += `<i>No admins found.</i>`;
  } else {
    for (const a of admins) {
      caption += `• <code>${a.telegram_id}</code> — ${a.role === 'owner' ? '👑 Owner' : 'Admin'}\n`;
    }
  }

  const rows = [[Markup.button.callback('➕ Add Admin', 'admin:admins:add')]];

  for (const a of admins || []) {
    if (a.role !== 'owner') {
      rows.push([Markup.button.callback(`🗑️ Remove ${a.telegram_id}`, `admin:admins:confirmremove:${a.telegram_id}`)]);
    }
  }

  rows.push([Markup.button.callback('🔙 Back to Panel', 'admin:panel')]);

  await sendOrEditUI(ctx, { photo: ADMIN_PHOTO, caption, keyboard: Markup.inlineKeyboard(rows) });
}

async function startAddAdmin(ctx) {
  // Extra layer: only the Owner can add new admins, even though this button
  // is only shown to owners in the UI — re-verified here in case the raw
  // callback is ever triggered directly.
  if (!(await isOwner(ctx.from.id))) {
    return ctx.answerCbQuery('🚫 Owner only.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  setState(ctx.from.id, 'admin_add_admin');

  const caption = `➕ <b>Add Admin</b>\n\nSend the <b>Telegram ID</b> of the user to make admin:`;
  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption,
    keyboard: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin:admins:menu')]]),
  });
}

async function handleAddAdminText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'admin_add_admin') return false;

  // Re-verify owner status live (defense against access being revoked mid-flow)
  if (!(await isOwner(userId))) {
    clearState(userId);
    return true;
  }

  const newAdminId = ctx.message.text.trim();

  if (!/^\d+$/.test(newAdminId)) {
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ Please send a valid numeric Telegram ID:`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin:admins:menu')]]),
    });
    return true;
  }

  clearState(userId);

  const { error } = await supabase
    .from('admins')
    .insert([{ telegram_id: newAdminId, role: 'admin', added_by: userId }]);

  if (error) {
    console.error('Add admin error:', error.message);
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ Could not add admin: ${error.message}`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin:admins:menu')]]),
    });
    return true;
  }

  await ctx.telegram
    .sendMessage(newAdminId, `👑 You have been made an <b>Admin</b> of this bot. Use /ra_ro_by_panel to access the panel.`, {
      parse_mode: 'HTML',
    })
    .catch(() => {});

  // Re-fetch role since this text-flow doesn't go through the requireAdmin
  // callback guard (which is what normally sets ctx.state.adminRole)
  ctx.state.adminRole = await getAdminRole(userId);
  return adminsMenuHandler(ctx);
}

// ---- Remove Admin (with confirmation) ----
async function confirmRemoveAdminHandler(telegramId, ctx) {
  if (!(await isOwner(ctx.from.id))) {
    return ctx.answerCbQuery('🚫 Owner only.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: `⚠️ <b>Are you sure?</b>\n\nRemove admin <code>${telegramId}</code>? They will lose access to the panel immediately.`,
    keyboard: Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes, Remove', `admin:admins:remove:${telegramId}`),
        Markup.button.callback('❌ No, Cancel', 'admin:admins:menu'),
      ],
    ]),
  });
}

async function removeAdminHandler(telegramId, ctx) {
  if (!(await isOwner(ctx.from.id))) {
    return ctx.answerCbQuery('🚫 Owner only.', { show_alert: true });
  }

  const { error } = await supabase.from('admins').delete().eq('telegram_id', telegramId).neq('role', 'owner');

  if (error) {
    console.error('Remove admin error:', error.message);
    return ctx.answerCbQuery('⚠️ Failed to remove.', { show_alert: true });
  }

  await ctx.answerCbQuery('🗑️ Admin removed');
  return adminsMenuHandler(ctx);
}

module.exports = {
  adminsMenuHandler,
  startAddAdmin,
  handleAddAdminText,
  confirmRemoveAdminHandler,
  removeAdminHandler,
};
