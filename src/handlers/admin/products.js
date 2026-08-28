const { Markup } = require('telegraf');
const supabase = require('../../supabase');
const { sendOrEditUI } = require('../../utils/messageManager');
const { setState, getState, clearState } = require('../../utils/stateManager');
const { showPanel } = require('./panel');
const { fetchCatalogPage, formatPriceLine } = require('../catalog');
const { getAdminRole } = require('../../utils/isAdmin');
const { BOT_USERNAME } = require('../../config');

const ADMIN_PHOTO = './src/assets/adminpanel.png';

// Ordered list of TEXT fields we collect when adding a new product
// (code is auto-generated, emoji removed, original_price skipped)
const FIELDS = [
  { key: 'name', prompt: '📝 Send the <b>Name</b> (e.g. Typing Bot):', parse: (v) => (v.trim() ? v.trim() : null) },
  { key: 'price', prompt: '💰 Send the <b>Price</b> in RP💎 (e.g. <code>1</code>, or <code>0</code> for Free):', parse: (v) => { const n = parseFloat(v); return Number.isNaN(n) ? null : n; } },
  { key: 'description', prompt: '📄 Send a short <b>Description</b>:', parse: (v) => (v.trim() ? v.trim() : null) },
];

function cancelKeyboard(target = 'admin:products:add:cancel') {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', target)]]);
}

function productsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Add Bot', 'admin:products:add:bot'),
      Markup.button.callback('➕ Add API', 'admin:products:add:api'),
    ],
    [
      Markup.button.callback('📋 List Bots', 'admin:products:list:bot:1'),
      Markup.button.callback('📋 List APIs', 'admin:products:list:api:1'),
    ],
    [Markup.button.callback('🔙 Back to Panel', 'admin:panel')],
  ]);
}

async function productsMenuHandler(ctx) {
  await ctx.answerCbQuery();
  const caption = `📦 <b>Manage Products</b>\n\nAdd new items or view/edit/delete existing ones.`;
  await sendOrEditUI(ctx, { photo: ADMIN_PHOTO, caption, keyboard: productsMenuKeyboard() });
}

// Auto-generates the next display code for a type (1, 2, 3, ...)
async function getNextCode(type) {
  const { data, error } = await supabase
    .from('products')
    .select('code')
    .eq('type', type)
    .order('code', { ascending: false })
    .limit(1);

  if (error) {
    console.error('getNextCode error:', error.message);
    return 1;
  }
  if (!data || data.length === 0) return 1;
  return data[0].code + 1;
}

/**
 * Security: re-verify the sender is STILL an admin before acting on any
 * multi-step text/file input. Callback buttons are already re-checked live
 * on every click (see requireAdmin in panel.js) — this covers the case where
 * someone's admin access is revoked while they're mid-flow.
 */
async function assertAdminOrAbort(ctx) {
  const role = await getAdminRole(ctx.from.id);
  if (!role) {
    clearState(ctx.from.id);
    return null;
  }
  return role;
}

// ---- Step-by-step Add Product flow ----
async function startAddProduct(type, ctx) {
  await ctx.answerCbQuery();

  const nextCode = await getNextCode(type);
  const values = { code: nextCode };

  setState(ctx.from.id, 'admin_add_product', { type, fieldIndex: 0, values });

  const caption =
    `➕ <b>Add New ${type === 'bot' ? 'Bot' : 'API'}</b> (Code #${nextCode})\n\n` +
    `${FIELDS[0].prompt}`;

  await sendOrEditUI(ctx, { photo: ADMIN_PHOTO, caption, keyboard: cancelKeyboard() });
}

async function handleAddProductText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state) return false;

  const relevantSteps = ['admin_add_product', 'admin_add_product_file'];
  if (!relevantSteps.includes(state.step)) return false;

  if (!(await assertAdminOrAbort(ctx))) return true; // access revoked mid-flow — silently stop

  // Waiting for a FILE, but admin sent text instead -> gently remind them
  if (state.step === 'admin_add_product_file') {
    const { type } = state.data;
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `📎 Please send the <b>${type === 'bot' ? 'Bot' : 'API'} file</b> as a Telegram document (not text):`,
      keyboard: cancelKeyboard(),
    });
    return true;
  }

  const { type, fieldIndex, values } = state.data;
  const field = FIELDS[fieldIndex];
  const parsed = field.parse(ctx.message.text);

  if (parsed === null) {
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ Invalid value. Please try again.\n\n${field.prompt}`,
      keyboard: cancelKeyboard(),
    });
    return true;
  }

  values[field.key] = parsed;
  const nextIndex = fieldIndex + 1;

  if (nextIndex < FIELDS.length) {
    setState(userId, 'admin_add_product', { type, fieldIndex: nextIndex, values });
    await sendOrEditUI(ctx, { photo: ADMIN_PHOTO, caption: FIELDS[nextIndex].prompt, keyboard: cancelKeyboard() });
    return true;
  }

  // All text fields collected -> now ask for the deliverable file
  setState(userId, 'admin_add_product_file', { type, values });

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption:
      `📎 <b>Send the ${type === 'bot' ? 'Bot' : 'API'} File</b>\n\n` +
      `Upload the file that should be automatically delivered to the buyer when this ${type} is purchased.`,
    keyboard: cancelKeyboard(),
  });
  return true;
}

// ---- File upload step (Add flow) ----
async function handleAddProductFile(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'admin_add_product_file') return false;
  if (!(await assertAdminOrAbort(ctx))) return true;

  const doc = ctx.message.document;
  if (!doc) return false;

  const { type, values } = state.data;
  values.file_id = doc.file_id;
  values.file_name = doc.file_name || 'file';

  setState(userId, 'admin_add_product_confirm', { type, values });
  await showAddConfirmation(ctx, type, values);
  return true;
}

async function showAddConfirmation(ctx, type, values) {
  const previewItem = { ...values, type };
  const preview =
    `✅ <b>Confirm New ${type === 'bot' ? 'Bot' : 'API'}</b>\n\n` +
    `<b>${values.name}</b>\n` +
    `Code: <code>${values.code}</code>\n` +
    `Price: ${formatPriceLine(previewItem)}\n` +
    `Description: <i>${values.description}</i>\n` +
    `📎 File: <code>${values.file_name}</code> ✅`;

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: preview,
    keyboard: Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Confirm', 'admin:products:add:confirm'),
        Markup.button.callback('❌ Cancel', 'admin:products:add:cancel'),
      ],
    ]),
  });

  // Send the actual file as a visual preview so the admin can double-check
  // it's correct — tracked so it gets cleaned up on confirm/cancel.
  try {
    const previewMsg = await ctx.replyWithDocument(values.file_id, {
      caption: '📎 Preview — this exact file will be sent to buyers.',
    });
    const s = getState(ctx.from.id);
    if (s) {
      s.data.previewMessageId = previewMsg.message_id;
      setState(ctx.from.id, s.step, s.data);
    }
  } catch (err) {
    console.warn('Could not send file preview:', err.message);
  }
}

async function cleanupFilePreview(ctx, state) {
  const previewMessageId = state?.data?.previewMessageId;
  if (previewMessageId) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, previewMessageId);
    } catch (err) {
      // already gone — ignore
    }
  }
}

async function confirmAddProduct(ctx) {
  await ctx.answerCbQuery();
  const state = getState(ctx.from.id);
  if (!state || state.step !== 'admin_add_product_confirm') {
    return ctx.answerCbQuery('⚠️ Nothing to confirm.', { show_alert: true });
  }

  const { type, values } = state.data;
  await cleanupFilePreview(ctx, state);
  clearState(ctx.from.id);

  const { error } = await supabase.from('products').insert([{ type, ...values }]);

  if (error) {
    console.error('Add product error:', error.message);
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `⚠️ Could not save product: ${error.message}`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Panel', 'admin:panel')]]),
    });
    return;
  }

  await ctx.answerCbQuery(`✅ ${values.name} added!`);

  // Announce in the public channel
  const channelId = process.env.PUBLIC_CHANNEL_ID;
  if (channelId) {
    const typeLabel = type === 'bot' ? 'Bot' : 'API';
    const infoLabel = type === 'bot' ? 'Bot Info' : 'API Info';
    const announcementPhoto =
      type === 'bot'
        ? 'https://i.ibb.co/99LZXbzC/Chat-GPT-Image-Aug-27-2026-02-28-04-PM.png'
        : 'https://i.ibb.co/4nhSL7Ph/Chat-GPT-Image-Aug-27-2026-02-28-47-PM.png';
    const announcement =
      `🎉 <b>New ${typeLabel} Added in Our Store</b>\n\n` +
      `🎯 <b>Name:</b> ${values.name}\n\n` +
      `💰 <b>Price:</b> ${formatPriceLine({ ...values, type })}\n\n` +
      `📜 <b>${infoLabel}:</b> ${values.description}`;

    await ctx.telegram
      .sendPhoto(channelId, announcementPhoto, {
        caption: announcement,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.url('🛒 Get It Now', `https://t.me/${BOT_USERNAME}`)]]),
      })
      .catch((err) => console.error('Channel announce error:', err.message));
  }

  return showPanel(ctx, ctx.state.adminRole);
}

async function cancelAddProduct(ctx) {
  await ctx.answerCbQuery('Cancelled');
  const state = getState(ctx.from.id);
  await cleanupFilePreview(ctx, state);
  clearState(ctx.from.id);
  return productsMenuHandler(ctx);
}

// ---- List products (admin view) ----
async function listProductsHandler(type, page, ctx) {
  await ctx.answerCbQuery();
  const { items, totalPages } = await fetchCatalogPage(type, page);

  let caption = `📋 <b>${type === 'bot' ? 'Bots' : 'APIs'} — Page ${page} of ${totalPages}</b>\n\n`;
  if (items.length === 0) caption += `<i>No items yet.</i>`;

  const rows = items.map((item) => [
    Markup.button.callback(
      `${item.name} (${formatPriceLine(item).replace(/<\/?[^>]+>/g, '')})`,
      `admin:products:view:${type}:${item.code}`
    ),
  ]);

  const navRow = [];
  if (page > 1) navRow.push(Markup.button.callback('◀️ Previous', `admin:products:list:${type}:${page - 1}`));
  if (page < totalPages) navRow.push(Markup.button.callback('Next ▶️', `admin:products:list:${type}:${page + 1}`));
  if (navRow.length) rows.push(navRow);

  rows.push([Markup.button.callback('🔙 Back', 'admin:products:menu')]);

  await sendOrEditUI(ctx, { photo: ADMIN_PHOTO, caption, keyboard: Markup.inlineKeyboard(rows) });
}

async function viewProductHandler(type, code, ctx) {
  await ctx.answerCbQuery();
  const { data: item, error } = await supabase
    .from('products')
    .select('*')
    .eq('type', type)
    .eq('code', code)
    .single();

  if (error || !item) {
    return ctx.answerCbQuery('⚠️ Item not found.', { show_alert: true });
  }

  const caption =
    `<b>${item.name}</b>\n\n` +
    `Code: <code>${item.code}</code>\n` +
    `Price: ${formatPriceLine(item)}\n` +
    `Description: <i>${item.description || '—'}</i>\n` +
    `File: <code>${item.file_name || 'none attached'}</code>`;

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption,
    keyboard: Markup.inlineKeyboard([
      [
        Markup.button.callback('✏️ Edit Price', `admin:products:editprice:${type}:${code}`),
        Markup.button.callback('📝 Edit Description', `admin:products:editdesc:${type}:${code}`),
      ],
      [Markup.button.callback('📎 Edit File', `admin:products:editfile:${type}:${code}`)],
      [Markup.button.callback('🗑️ Delete', `admin:products:confirmdelete:${type}:${code}`)],
      [Markup.button.callback('🔙 Back', `admin:products:list:${type}:1`)],
    ]),
  });
}

// ---- Edit Price / Description / File ----
async function startEditField(field, type, code, ctx) {
  await ctx.answerCbQuery();
  setState(ctx.from.id, `admin_edit_product_${field}`, { type, code });

  const prompts = {
    price: '💰 Send the <b>new Price</b> in RP💎:',
    description: '📄 Send the <b>new Description</b>:',
    file: '📎 Upload the <b>new File</b> (document) for this item:',
  };

  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: prompts[field],
    keyboard: cancelKeyboard(`admin:products:view:${type}:${code}`),
  });
}

async function handleEditProductText(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state) return false;

  if (state.step === 'admin_edit_product_price') {
    if (!(await assertAdminOrAbort(ctx))) return true;
    const { type, code } = state.data;
    const newPrice = parseFloat(ctx.message.text.trim());

    if (Number.isNaN(newPrice)) {
      await sendOrEditUI(ctx, {
        photo: ADMIN_PHOTO,
        caption: `⚠️ Invalid number. Send the <b>new Price</b> in RP💎:`,
        keyboard: cancelKeyboard(`admin:products:view:${type}:${code}`),
      });
      return true;
    }

    clearState(userId);
    const { error } = await supabase.from('products').update({ price: newPrice }).eq('type', type).eq('code', code);
    if (error) console.error('Edit price error:', error.message);

    await viewProductHandler(type, code, ctx);
    return true;
  }

  if (state.step === 'admin_edit_product_description') {
    if (!(await assertAdminOrAbort(ctx))) return true;
    const { type, code } = state.data;
    const newDescription = ctx.message.text.trim();

    clearState(userId);
    const { error } = await supabase
      .from('products')
      .update({ description: newDescription })
      .eq('type', type)
      .eq('code', code);
    if (error) console.error('Edit description error:', error.message);

    await viewProductHandler(type, code, ctx);
    return true;
  }

  if (state.step === 'admin_edit_product_file') {
    if (!(await assertAdminOrAbort(ctx))) return true;
    const { type, code } = state.data;
    await sendOrEditUI(ctx, {
      photo: ADMIN_PHOTO,
      caption: `📎 Please send the new file as a Telegram <b>document</b> (not text):`,
      keyboard: cancelKeyboard(`admin:products:view:${type}:${code}`),
    });
    return true;
  }

  return false;
}

async function handleEditProductFile(ctx) {
  const userId = ctx.from.id;
  const state = getState(userId);
  if (!state || state.step !== 'admin_edit_product_file') return false;
  if (!(await assertAdminOrAbort(ctx))) return true;

  const doc = ctx.message.document;
  if (!doc) return false;

  const { type, code } = state.data;
  clearState(userId);

  const { error } = await supabase
    .from('products')
    .update({ file_id: doc.file_id, file_name: doc.file_name || 'file' })
    .eq('type', type)
    .eq('code', code);
  if (error) console.error('Edit file error:', error.message);

  await viewProductHandler(type, code, ctx);
  return true;
}

// ---- Delete (with confirmation) ----
async function confirmDeleteHandler(type, code, ctx) {
  await ctx.answerCbQuery();
  await sendOrEditUI(ctx, {
    photo: ADMIN_PHOTO,
    caption: `⚠️ <b>Are you sure?</b>\n\nThis will permanently delete this ${type === 'bot' ? 'Bot' : 'API'} (Code #${code}). This cannot be undone.`,
    keyboard: Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes, Delete', `admin:products:delete:${type}:${code}`),
        Markup.button.callback('❌ No, Cancel', `admin:products:view:${type}:${code}`),
      ],
    ]),
  });
}

async function deleteProductHandler(type, code, ctx) {
  await ctx.answerCbQuery();
  const { error } = await supabase.from('products').delete().eq('type', type).eq('code', code);

  if (error) {
    console.error('Delete product error:', error.message);
    return ctx.answerCbQuery('⚠️ Failed to delete.', { show_alert: true });
  }

  await ctx.answerCbQuery('🗑️ Deleted');
  return listProductsHandler(type, 1, ctx);
}

module.exports = {
  productsMenuHandler,
  startAddProduct,
  handleAddProductText,
  handleAddProductFile,
  confirmAddProduct,
  cancelAddProduct,
  listProductsHandler,
  viewProductHandler,
  startEditField,
  handleEditProductText,
  handleEditProductFile,
  confirmDeleteHandler,
  deleteProductHandler,
};
