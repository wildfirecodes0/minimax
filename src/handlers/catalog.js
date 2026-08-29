const { Markup } = require('telegraf');
const supabase = require('../supabase');
const { sendOrEditUI } = require('../utils/messageManager');
const { BOT_USERNAME, REFERRAL_PURCHASE_PERCENT } = require('../config');

const PAGE_SIZE = 10;

// Catalog photos (separate for Bot and API)
const CATALOG_PHOTOS = {
  bot: 'https://i.ibb.co/gbjr4d8H/Chat-GPT-Image-Aug-25-2026-03-21-15-PM.png',
  api: 'https://i.ibb.co/DDSBrRVV/Chat-GPT-Image-Aug-25-2026-03-22-39-PM.png',
};

const TYPE_LABEL = { bot: 'Bot', api: 'API' };

// ---------- Data helpers ----------

async function fetchCatalogPage(type, page, sort = 'default') {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase.from('products').select('*', { count: 'exact' }).eq('type', type);

  if (sort === 'price_desc') {
    query = query.order('price', { ascending: false });
  } else if (sort === 'price_asc') {
    query = query.order('price', { ascending: true });
  } else {
    query = query.order('code', { ascending: true }); // "default" — original catalog order
  }

  const { data: items, error, count } = await query.range(from, to);

  if (error) console.error('Catalog fetch error:', error.message);

  const totalCount = count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return { items: items || [], totalPages, totalCount };
}

async function fetchProduct(type, code) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('type', type)
    .eq('code', code)
    .single();

  if (error) console.error('Product fetch error:', error.message);
  return data || null;
}

// ---------- UI builders ----------

function formatPriceLine(item) {
  if (Number(item.price) === 0) return '<b>Free</b>';

  const hasDiscount = item.original_price && Number(item.original_price) > Number(item.price);
  if (hasDiscount) {
    return `<s>${item.original_price}</s> <b>${item.price}</b> RP💎`;
  }
  return `<b>${item.price}</b> RP💎`;
}

const SORT_LABELS = {
  default: '📋 Default',
  price_desc: '⬇️ High To Low',
  price_asc: '⬆️ Low To High',
};

function buildListCaption(type, items, page, totalPages, sort = 'default') {
  const label = TYPE_LABEL[type];
  let caption = `🛍️ <b>Select a ${label} From The List Below</b>\n`;
  caption += `━━━━━━━━━━━━━━━━━━\n\n`;

  if (items.length === 0) {
    caption += `<i>No ${label}s available right now. Please check back later.</i>`;
    return caption;
  }

  // Numbering is always sequential (1, 2, 3...) in on-screen order — NOT the
  // item's underlying database code. Otherwise, after sorting by price the
  // numbers would appear scrambled (e.g. 06, 05, 07, 02...) since each
  // item keeps its own fixed code. The actual code is still used internally
  // for the buttons/purchase, just not shown as the display number anymore.
  items.forEach((item, idx) => {
    const displayNum = String((page - 1) * PAGE_SIZE + idx + 1).padStart(2, '0');
    caption += `<b>${displayNum}.</b> ${item.emoji ? item.emoji + ' ' : ''}<i>${item.name}</i>  ${formatPriceLine(item)}\n\n`;
  });

  caption += `📌 <b>Choose a code below to view full details:</b>`;
  caption += `\n<i>Page ${page} of ${totalPages} · Sort: ${SORT_LABELS[sort] || SORT_LABELS.default}</i>`;
  return caption;
}

function buildListKeyboard(type, items, page, totalPages, sort = 'default') {
  const rows = [];

  // Number buttons, 5 per row — label shows the same sequential display
  // number as the caption; the callback still carries the item's real code
  // so selecting it fetches the correct product.
  for (let i = 0; i < items.length; i += 5) {
    const rowItems = items.slice(i, i + 5);
    rows.push(
      rowItems.map((item, j) => {
        const idx = i + j;
        const displayNum = String((page - 1) * PAGE_SIZE + idx + 1).padStart(2, '0');
        return Markup.button.callback(`«${displayNum}»`, `cat:${type}:item:${item.code}:${page}:${sort}`);
      })
    );
  }

  // Navigation row: Previous | Filter | Next (Previous/Next only show when
  // applicable; Filter always shows)
  const navRow = [];
  if (page > 1) navRow.push(Markup.button.callback('◀️ Previous', `cat:${type}:list:${page - 1}:${sort}`));
  navRow.push(Markup.button.callback('🎞 Filter', `cat:${type}:filter:${page}:${sort}`));
  if (page < totalPages) navRow.push(Markup.button.callback('Next ▶️', `cat:${type}:list:${page + 1}:${sort}`));
  rows.push(navRow);

  rows.push([Markup.button.callback('🔙 Return To Menu', 'menu_main')]);

  return Markup.inlineKeyboard(rows);
}

function buildFilterKeyboard(type, page, sort) {
  const mark = (key) => (sort === key ? '✅ ' : '');
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${mark('default')}📋 Default`, `cat:${type}:setsort:default`)],
    [Markup.button.callback(`${mark('price_desc')}⬇️ High To Low`, `cat:${type}:setsort:price_desc`)],
    [Markup.button.callback(`${mark('price_asc')}⬆️ Low To High`, `cat:${type}:setsort:price_asc`)],
    [Markup.button.callback('🔙 Back', `cat:${type}:list:${page}:${sort}`)],
  ]);
}

function buildDetailCaption(item) {
  let caption = `❗ <b>Confirm Purchase of Code:</b>\n\n`;
  caption += `<b>Name:</b> <i>${item.name}</i>\n\n`;
  caption += `💵 <b>Price:</b> ${formatPriceLine(item)}\n`;
  caption += `\n📝 <b>Description:</b> <i>${item.description || 'No description available.'}</i>\n\n`;
  caption += `📣 Click <b>Buy Now</b> to purchase instantly.`;

  return caption;
}

function buildDetailKeyboard(type, code, page, sort = 'default') {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Buy Now', `cat:${type}:buy:${code}`),
      Markup.button.callback('🔙 Return', `cat:${type}:list:${page}:${sort}`),
    ],
  ]);
}

// ---------- Handlers ----------

async function showListHandler(type, page, ctx, sort = 'default') {
  const { items, totalPages } = await fetchCatalogPage(type, page, sort);
  const caption = buildListCaption(type, items, page, totalPages, sort);
  const keyboard = buildListKeyboard(type, items, page, totalPages, sort);

  await sendOrEditUI(ctx, { photo: CATALOG_PHOTOS[type], caption, keyboard });
}

async function showFilterHandler(type, page, sort, ctx) {
  const caption =
    `🎞 <b>Filter ${TYPE_LABEL[type]}s</b>\n\n` +
    `Choose how you'd like to sort the list:`;
  const keyboard = buildFilterKeyboard(type, page, sort);

  await sendOrEditUI(ctx, { photo: CATALOG_PHOTOS[type], caption, keyboard });
}

async function showDetailHandler(type, code, page, ctx, sort = 'default') {
  const item = await fetchProduct(type, code);

  if (!item) {
    return ctx.answerCbQuery('⚠️ This item is no longer available.', { show_alert: true });
  }

  const caption = buildDetailCaption(item);
  const keyboard = buildDetailKeyboard(type, code, page, sort);

  await sendOrEditUI(ctx, { photo: CATALOG_PHOTOS[type], caption, keyboard });
}

// Single router that handles all `cat:<type>:<action>:<param...>` callbacks
async function catalogRouter(ctx) {
  try {
    const parts = ctx.match.input.split(':'); // cat:type:action:param[:extra][:extra2]
    const [, type, action, param, extra, extra2] = parts;

    // NOTE: answerCbQuery() can only be called ONCE per callback query — a
    // second call silently fails (Telegram rejects it). "list"/"item"/
    // "filter"/"setsort" just need a plain ack, but "buy" needs to answer
    // with its own alert popup (insufficient balance / success message), so
    // we must NOT pre-answer here for "buy" — that was swallowing the real
    // popup and made the button look broken.
    if (action === 'list') {
      return showListHandler(type, Number(param), ctx, extra || 'default');
    }

    if (action === 'item') {
      return showDetailHandler(type, Number(param), Number(extra), ctx, extra2 || 'default');
    }

    if (action === 'filter') {
      return showFilterHandler(type, Number(param), extra || 'default', ctx);
    }

    if (action === 'setsort') {
      return showListHandler(type, 1, ctx, param || 'default');
    }

    if (action === 'buy') {
      const code = Number(param);
      const item = await fetchProduct(type, code);
      if (!item) {
        return ctx.answerCbQuery('⚠️ This item is no longer available.', { show_alert: true });
      }

      const { data: user, error } = await supabase
        .from('users')
        .select('balance, spend_amount, referred_by')
        .eq('telegram_id', ctx.from.id)
        .single();

      if (error || !user) {
        return ctx.answerCbQuery('⚠️ Could not verify your balance. Please try again.', { show_alert: true });
      }

      const balance = Number(user.balance || 0);
      const price = Number(item.price || 0);

      if (balance < price) {
        const shortfall = (price - balance).toFixed(2);
        // Note: Telegram popup alerts are plain text only (no bold/HTML) and
        // capped at 200 characters — kept short and clean on purpose.
        return ctx.answerCbQuery(
          `❌ Insufficient Balance\n\n` +
          `Price: ${price} RP💎\n` +
          `Your Balance: ${balance} RP💎\n` +
          `Short by: ${shortfall} RP💎\n\n` +
          `Please deposit more RP💎 to buy this item.`,
          { show_alert: true }
        );
      }

      // ---- Balance is sufficient -> complete the purchase ----
      const newBalance = balance - price;
      const newSpend = Number(user.spend_amount || 0) + price;

      // Atomic guard: the update only succeeds if the balance is STILL >=
      // price at the moment of writing. This prevents a double-click (or two
      // near-simultaneous purchases) from spending the same balance twice.
      const { data: deductedRows, error: deductError } = await supabase
        .from('users')
        .update({ balance: newBalance, spend_amount: newSpend })
        .eq('telegram_id', ctx.from.id)
        .gte('balance', price)
        .select();

      if (deductError) {
        console.error('Balance deduction error:', deductError.message);
        return ctx.answerCbQuery('⚠️ Purchase failed. Please try again.', { show_alert: true });
      }

      if (!deductedRows || deductedRows.length === 0) {
        // Balance changed between the check and now (e.g. a duplicate click)
        return ctx.answerCbQuery('⚠️ Purchase already in progress or balance changed. Please check your balance and try again.', { show_alert: true });
      }

      // Record the sale (also powers the Stats screen's "Total Sold" counts)
      const { error: orderError } = await supabase.from('orders').insert([
        { telegram_id: ctx.from.id, type, product_code: item.code, product_name: item.name, price },
      ]);
      if (orderError) console.error('Order record error:', orderError.message);

      // Referral commission — the buyer's referrer (if any) gets a lifetime
      // cut of every purchase their referral makes.
      if (user.referred_by) {
        const referralBonus = price * (REFERRAL_PURCHASE_PERCENT / 100);

        const { data: referrer, error: referrerFetchError } = await supabase
          .from('users')
          .select('balance')
          .eq('telegram_id', user.referred_by)
          .single();

        if (!referrerFetchError && referrer) {
          const referrerNewBalance = Number(referrer.balance || 0) + referralBonus;

          const { error: referrerUpdateError } = await supabase
            .from('users')
            .update({ balance: referrerNewBalance })
            .eq('telegram_id', user.referred_by);

          if (!referrerUpdateError) {
            const buyerName = ctx.from.first_name || 'Your referral';
            await ctx.telegram
              .sendMessage(
                user.referred_by,
                `🎉 <b>Referral Bonus!</b>\n\n` +
                `${buyerName} just made a purchase, and you earned <b>${referralBonus} RP💎</b> (${REFERRAL_PURCHASE_PERCENT}%)!\n` +
                `💰 New Balance: <code>${referrerNewBalance}</code> RP💎`,
                { parse_mode: 'HTML' }
              )
              .catch((err) => console.error('Referral purchase notify error:', err.message));
          } else {
            console.error('Referral purchase bonus update error:', referrerUpdateError.message);
          }
        }
      }

      await ctx.answerCbQuery('✅ Purchase successful! Sending your file now...', { show_alert: true });

      // Deliver the file
      if (item.file_id) {
        await ctx.telegram
          .sendDocument(ctx.from.id, item.file_id, {
            caption: `✅ <b>Thank you for your purchase!</b>\n\n<b>${item.name}</b>\n\nEnjoy! 🎉`,
            parse_mode: 'HTML',
          })
          .catch((err) => console.error('File delivery error:', err.message));
      } else {
        await ctx.telegram
          .sendMessage(ctx.from.id, `✅ Purchase successful, but no file is attached to this item yet. Please contact support.`)
          .catch(() => {});
      }

      // Notify admin of the sale
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        await ctx.telegram
          .sendMessage(
            adminChatId,
            `🛒 <b>New Sale!</b>\n\n` +
            `<b>${item.name}</b> (${type === 'bot' ? 'Bot' : 'API'})\n` +
            `Buyer: <code>${ctx.from.id}</code>\n` +
            `Price: ${price} RP💎`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {});
      }

      // Announce the sale on the public channel (same env var used for
      // deposit announcements — set PUBLIC_CHANNEL_ID in your .env / Render
      // environment tab, e.g. @MiniMaxStoreShop or a numeric channel ID).
      const purchaseChannelId = process.env.PUBLIC_CHANNEL_ID;
      if (purchaseChannelId) {
        const buyerName = ctx.from.first_name || 'A user';
        const boughtLabel = item.file_name || item.name;

        await ctx.telegram
          .sendMessage(
            purchaseChannelId,
            `💻 <b>New Product Purchase by ${buyerName}</b>\n\n` +
            `🛍️ <b>Bought:</b> ${boughtLabel}\n\n` +
            `💸 <b>Cost:</b> ${price} RP💎\n\n` +
            `🤩 <i>Get Your Dream APIs & Bots From Here</i>\n` +
            `➡️ @${BOT_USERNAME}`,
            {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([[Markup.button.url('🤖 Get Bots & APIs Now', `https://t.me/${BOT_USERNAME}`)]]),
            }
          )
          .catch((err) => console.error('Purchase channel announcement error:', err.message));
      }

      return;
    }
  } catch (err) {
    console.error('Catalog router error:', err.message);
  }
}

module.exports = { showListHandler, showFilterHandler, catalogRouter, fetchCatalogPage, fetchProduct, formatPriceLine };
