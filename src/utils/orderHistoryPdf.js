/**
 * Order History PDF Generator
 * ----------------------------
 * Generates a branded, dark-themed PDF containing a user's COMPLETE order
 * history (unlike the in-bot "My Orders" screen, which only shows the
 * latest 5 for speed). Every page carries a diagonal bot watermark so the
 * file can't be easily passed off as coming from anywhere else.
 */

const PDFDocument = require('pdfkit');
const { BOT_NAME, BOT_USERNAME } = require('../config');

// ---- Theme (matches the bot's in-app dark/purple look) ----
const THEME = {
  bg: '#0b0e1a',
  panel: '#131728',
  purple: '#7c5cff',
  purpleDark: '#4c3aa8',
  gold: '#f2c94c',
  text: '#e8e9f3',
  textDim: '#8b90ab',
  rowAlt: '#161b30',
  border: '#262c48',
};

const PAGE_MARGIN = 40;

function drawPageBackground(doc) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(THEME.bg);
  doc.restore();
}

function drawWatermark(doc) {
  doc.save();
  doc.fillColor(THEME.purple).opacity(0.06);
  doc.font('Helvetica-Bold').fontSize(60);
  const label = `${BOT_NAME.toUpperCase()}`;
  const centerX = doc.page.width / 2;
  const centerY = doc.page.height / 2;
  doc.translate(centerX, centerY).rotate(-35, { origin: [0, 0] });
  for (let y = -400; y <= 400; y += 130) {
    doc.text(label, -400, y, { width: 800, align: 'center' });
  }
  doc.restore();
  doc.opacity(1);
}

// Small vector "logo mark" instead of an emoji — standard PDF fonts (Helvetica)
// only support Latin-1/WinAnsi characters, so real emoji glyphs (📦 💎 etc.)
// render as garbled boxes/symbols. A drawn shape always renders correctly on
// every system, with no font-availability risk in production.
function drawLogoMark(doc, x, y, size) {
  doc.save();
  doc.roundedRect(x, y, size, size, size * 0.28).fill(THEME.gold);
  const initials = BOT_NAME
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  doc.fillColor(THEME.purpleDark).font('Helvetica-Bold').fontSize(size * 0.42)
    .text(initials, x, y + size * 0.28, { width: size, align: 'center' });
  doc.restore();
}

function drawHeader(doc, user) {
  // Purple header bar
  doc.save();
  doc.rect(0, 0, doc.page.width, 90).fill(THEME.purpleDark);
  doc.restore();

  drawLogoMark(doc, PAGE_MARGIN, 24, 40);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text(BOT_NAME, PAGE_MARGIN + 52, 28);
  doc.fillColor('#d9d4ff').font('Helvetica').fontSize(11)
    .text(`@${BOT_USERNAME}  -  Order History Report`, PAGE_MARGIN + 52, 54);

  const genDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  doc.fillColor('#d9d4ff').fontSize(9)
    .text(`Generated: ${genDate}`, PAGE_MARGIN, 90 - 24, {
      width: doc.page.width - PAGE_MARGIN * 2,
      align: 'right',
    });
}

function drawUserCard(doc, user, summary) {
  const top = 110;
  const height = 62;
  doc.save();
  doc.roundedRect(PAGE_MARGIN, top, doc.page.width - PAGE_MARGIN * 2, height, 8)
    .fill(THEME.panel);
  doc.restore();

  const name = user.first_name || user.username || `User ${user.telegram_id}`;
  doc.fillColor(THEME.text).font('Helvetica-Bold').fontSize(13)
    .text(name, PAGE_MARGIN + 16, top + 12);
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9)
    .text(`Telegram ID: ${user.telegram_id}${user.username ? '   -   @' + user.username : ''}`, PAGE_MARGIN + 16, top + 32);

  const statX = doc.page.width - PAGE_MARGIN - 220;
  doc.fillColor(THEME.textDim).fontSize(9).text('TOTAL ORDERS', statX, top + 12, { width: 100, align: 'center' });
  doc.fillColor(THEME.gold).font('Helvetica-Bold').fontSize(16)
    .text(String(summary.count), statX, top + 26, { width: 100, align: 'center' });

  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9)
    .text('TOTAL SPENT', statX + 120, top + 12, { width: 100, align: 'center' });
  doc.fillColor(THEME.gold).font('Helvetica-Bold').fontSize(16)
    .text(`${summary.total} RP`, statX + 120, top + 26, { width: 100, align: 'center' });
}

const COL = {
  no: { x: PAGE_MARGIN, w: 28 },
  product: { x: PAGE_MARGIN + 28, w: 235 },
  type: { x: PAGE_MARGIN + 28 + 235, w: 55 },
  price: { x: PAGE_MARGIN + 28 + 235 + 55, w: 85 },
  date: { x: PAGE_MARGIN + 28 + 235 + 55 + 85, w: 92 },
};

function drawTableHeader(doc, y) {
  doc.save();
  doc.rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, 26).fill(THEME.purple);
  doc.restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('#', COL.no.x + 6, y + 8, { width: COL.no.w });
  doc.text('PRODUCT', COL.product.x, y + 8, { width: COL.product.w });
  doc.text('TYPE', COL.type.x, y + 8, { width: COL.type.w });
  doc.text('PRICE', COL.price.x, y + 8, { width: COL.price.w });
  doc.text('DATE', COL.date.x, y + 8, { width: COL.date.w });
  return y + 26;
}

function drawRow(doc, y, rowHeight, index, order) {
  if (index % 2 === 1) {
    doc.save();
    doc.rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, rowHeight).fill(THEME.rowAlt);
    doc.restore();
  }
  const date = new Date(order.created_at).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9);
  doc.text(String(index + 1), COL.no.x + 6, y + 9, { width: COL.no.w });
  doc.fillColor(THEME.text).font('Helvetica-Bold').fontSize(9.5);
  doc.text(order.product_name, COL.product.x, y + 9, { width: COL.product.w - 6, ellipsis: true });
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9);
  doc.text(order.type === 'bot' ? 'Bot' : 'API', COL.type.x, y + 9, { width: COL.type.w });
  doc.fillColor(THEME.gold).font('Helvetica-Bold').fontSize(9.5);
  doc.text(`${order.price} RP`, COL.price.x, y + 9, { width: COL.price.w });
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9);
  doc.text(date, COL.date.x, y + 9, { width: COL.date.w });

  // row divider
  doc.save();
  doc.moveTo(PAGE_MARGIN, y + rowHeight).lineTo(doc.page.width - PAGE_MARGIN, y + rowHeight)
    .lineWidth(0.5).strokeColor(THEME.border).stroke();
  doc.restore();
}

function drawFooter(doc, pageNum, pageCount) {
  const y = doc.page.height - 32;
  doc.save();
  doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(0.5).strokeColor(THEME.border).stroke();
  doc.restore();
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(8)
    .text(`${BOT_NAME}  -  @${BOT_USERNAME}  -  This is an auto-generated statement`, PAGE_MARGIN, y + 8, {
      width: doc.page.width - PAGE_MARGIN * 2 - 60,
    });
  doc.text(`Page ${pageNum} of ${pageCount}`, doc.page.width - PAGE_MARGIN - 100, y + 8, {
    width: 100, align: 'right',
  });
}

/**
 * @param {object} user - { telegram_id, first_name, username }
 * @param {Array}  orders - full order list, newest first
 * @returns {Promise<Buffer>}
 */
function generateOrderHistoryPdf(user, orders) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const summary = {
      count: orders.length,
      total: orders.reduce((sum, o) => sum + Number(o.price || 0), 0),
    };

    const ROW_H = 24;
    const TABLE_TOP_FIRST = 190;
    const TABLE_TOP_NEXT = 60;
    const BOTTOM_LIMIT = doc.page.height - 55;

    drawPageBackground(doc);
    drawWatermark(doc);
    drawHeader(doc, user);
    drawUserCard(doc, user, summary);

    let y = drawTableHeader(doc, TABLE_TOP_FIRST);

    if (orders.length === 0) {
      doc.fillColor(THEME.textDim).font('Helvetica').fontSize(11)
        .text('No orders yet — your purchases will show up here.', PAGE_MARGIN, y + 20, {
          width: doc.page.width - PAGE_MARGIN * 2,
          align: 'center',
        });
    } else {
      orders.forEach((order, i) => {
        if (y + ROW_H > BOTTOM_LIMIT) {
          doc.addPage();
          drawPageBackground(doc);
          drawWatermark(doc);
          y = drawTableHeader(doc, TABLE_TOP_NEXT);
        }
        drawRow(doc, y, ROW_H, i, order);
        y += ROW_H;
      });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      drawFooter(doc, i + 1, pageCount);
    }

    doc.end();
  });
}

module.exports = { generateOrderHistoryPdf };
