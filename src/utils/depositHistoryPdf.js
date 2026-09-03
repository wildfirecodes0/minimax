/**
 * Deposit History PDF Generator
 * -------------------------------
 * Same branded dark/purple theme + watermark as the order history PDF, but
 * for deposits — combines UPI/Razorpay deposits (`transactions` table) and
 * Telegram Stars deposits (`star_transactions` table) into one statement.
 */

const PDFDocument = require('pdfkit');
const {
  PAGE_MARGIN, THEME, sanitizeText,
  drawPageBackground, drawWatermark, drawHeader, drawUserCard, drawFooter,
} = require('./pdfTheme');

const COL = {
  no: { x: PAGE_MARGIN, w: 28 },
  method: { x: PAGE_MARGIN + 28, w: 110 },
  ref: { x: PAGE_MARGIN + 28 + 110, w: 150 },
  credited: { x: PAGE_MARGIN + 28 + 110 + 150, w: 90 },
  date: { x: PAGE_MARGIN + 28 + 110 + 150 + 90, w: 90 },
};

function drawTableHeader(doc, y) {
  doc.save();
  doc.rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, 26).fill(THEME.purple);
  doc.restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('#', COL.no.x + 6, y + 8, { width: COL.no.w });
  doc.text('METHOD', COL.method.x, y + 8, { width: COL.method.w });
  doc.text('REFERENCE / AMOUNT', COL.ref.x, y + 8, { width: COL.ref.w });
  doc.text('RP CREDITED', COL.credited.x, y + 8, { width: COL.credited.w });
  doc.text('DATE', COL.date.x, y + 8, { width: COL.date.w });
  return y + 26;
}

function drawRow(doc, y, rowHeight, index, deposit) {
  if (index % 2 === 1) {
    doc.save();
    doc.rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, rowHeight).fill(THEME.rowAlt);
    doc.restore();
  }
  const date = new Date(deposit.created_at).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const reference = deposit.method === 'Stars'
    ? `${deposit.stars_amount} Stars`
    : `Rs ${deposit.amount_inr} - ${sanitizeText(deposit.reference)}`;

  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9);
  doc.text(String(index + 1), COL.no.x + 6, y + 9, { width: COL.no.w });
  doc.fillColor(THEME.text).font('Helvetica-Bold').fontSize(9.5);
  doc.text(deposit.method, COL.method.x, y + 9, { width: COL.method.w });
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(8.5);
  doc.text(reference, COL.ref.x, y + 9, { width: COL.ref.w - 6, ellipsis: true });
  doc.fillColor(THEME.gold).font('Helvetica-Bold').fontSize(9.5);
  doc.text(`+${deposit.rp_credited} RP`, COL.credited.x, y + 9, { width: COL.credited.w });
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9);
  doc.text(date, COL.date.x, y + 9, { width: COL.date.w });

  doc.save();
  doc.moveTo(PAGE_MARGIN, y + rowHeight).lineTo(doc.page.width - PAGE_MARGIN, y + rowHeight)
    .lineWidth(0.5).strokeColor(THEME.border).stroke();
  doc.restore();
}

/**
 * @param {object} user - { telegram_id, first_name, username }
 * @param {Array}  deposits - normalized deposit list, newest first:
 *   { method: 'UPI'|'Stars', amount_inr?, stars_amount?, reference?, rp_credited, created_at }
 * @returns {Promise<Buffer>}
 */
function generateDepositHistoryPdf(user, deposits) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const summary = [
      { label: 'TOTAL DEPOSITS', value: String(deposits.length) },
      { label: 'TOTAL RP CREDITED', value: `${deposits.reduce((s, d) => s + Number(d.rp_credited || 0), 0)} RP` },
    ];

    const ROW_H = 24;
    const TABLE_TOP_FIRST = 190;
    const TABLE_TOP_NEXT = 60;
    const BOTTOM_LIMIT = doc.page.height - 55;

    drawPageBackground(doc);
    drawWatermark(doc);
    drawHeader(doc, 'Deposit History Report');
    drawUserCard(doc, user, summary);

    let y = drawTableHeader(doc, TABLE_TOP_FIRST);

    if (deposits.length === 0) {
      doc.fillColor(THEME.textDim).font('Helvetica').fontSize(11)
        .text('No deposits yet — your deposits will show up here.', PAGE_MARGIN, y + 20, {
          width: doc.page.width - PAGE_MARGIN * 2,
          align: 'center',
        });
    } else {
      deposits.forEach((deposit, i) => {
        if (y + ROW_H > BOTTOM_LIMIT) {
          doc.addPage();
          drawPageBackground(doc);
          drawWatermark(doc);
          y = drawTableHeader(doc, TABLE_TOP_NEXT);
        }
        drawRow(doc, y, ROW_H, i, deposit);
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

module.exports = { generateDepositHistoryPdf };
