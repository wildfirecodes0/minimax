const { Markup } = require('telegraf');
const supabase = require('../../supabase');
const { sendOrEditUI } = require('../../utils/messageManager');
const { getAdminRole } = require('../../utils/isAdmin');

// TODO: Replace with your actual admin panel photo once ready
const ADMIN_PHOTO = './src/assets/adminpanel.png';

function adminMenuKeyboard(role) {
  const rows = [
    [Markup.button.callback('👥 Manage Users', 'admin:users:search')],
    [Markup.button.callback('📦 Manage Products', 'admin:products:menu')],
    [Markup.button.callback('📢 Broadcast', 'admin:broadcast:start')],
    [Markup.button.callback('📊 Stats', 'admin:stats')],
  ];
  if (role === 'owner') {
    rows.push([Markup.button.callback('👑 Manage Admins', 'admin:admins:menu')]);
  }
  rows.push([Markup.button.callback('❌ Close Panel', 'admin:close')]);
  return Markup.inlineKeyboard(rows);
}

async function showPanel(ctx, role) {
  const caption =
    `🛠️ <b>Admin Control Panel</b>\n\n` +
    `Welcome, <b>${role === 'owner' ? 'Owner 👑' : 'Admin'}</b>!\n` +
    `Manage users, products, and broadcasts right from here.`;

  await sendOrEditUI(ctx, { photo: ADMIN_PHOTO, caption, keyboard: adminMenuKeyboard(role) });
}

// ---- /ra_ro_by_panel command ----
async function adminPanelCommand(ctx) {
  const userId = ctx.from.id;

  try {
    const { count, error: countError } = await supabase
      .from('admins')
      .select('*', { count: 'exact', head: true });

    if (countError) console.error('Admin count error:', countError.message);

    // No admin exists yet -> whoever runs this command first becomes Owner
    if (!count || count === 0) {
      const { error: insertError } = await supabase
        .from('admins')
        .insert([{ telegram_id: userId, role: 'owner' }]);

      if (insertError) {
        console.error('Owner claim error:', insertError.message);
        return ctx.reply('⚠️ Could not set up the admin panel. Please try again.');
      }

      await ctx.reply(
        `👑 <b>Congratulations!</b>\n\nYou are now the <b>Owner</b> of this bot.`,
        { parse_mode: 'HTML' }
      );
      return showPanel(ctx, 'owner');
    }

    // Admin(s) already exist -> verify this user is one of them
    const role = await getAdminRole(userId);
    if (!role) {
      return ctx.reply(
        `🚫 <b>Access Denied</b>\n\nYou are not authorized to use the admin panel.`,
        { parse_mode: 'HTML' }
      );
    }

    return showPanel(ctx, role);
  } catch (err) {
    console.error('Admin panel command error:', err.message);
  }
}

// ---- Guard used before every admin:* callback ----
async function requireAdmin(ctx, next) {
  const role = await getAdminRole(ctx.from.id);
  if (!role) {
    return ctx.answerCbQuery('🚫 Access Denied', { show_alert: true });
  }
  ctx.state.adminRole = role;
  return next();
}

async function closePanelHandler(ctx) {
  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch (err) {
    // message might already be gone — safe to ignore
  }
}

module.exports = { adminPanelCommand, showPanel, adminMenuKeyboard, requireAdmin, closePanelHandler };
