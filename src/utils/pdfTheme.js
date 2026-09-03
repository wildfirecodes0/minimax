/**
 * Shared PDF Report Theme
 * ------------------------
 * Common dark/purple theme, watermark, logo, header/footer drawing helpers
 * used by every report PDF (order history, deposit history, future ones).
 * Keeping this in one place means every report always looks consistent and
 * a design tweak only has to be made once.
 */

const fs = require('fs');
const path = require('path');
const { BOT_NAME, BOT_USERNAME } = require('../config');

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

// Real bot logo (falls back to a drawn "initials" mark if the file is ever
// missing, so a missing asset can never break PDF generation).
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'bot-logo.jpg');
const LOGO_AVAILABLE = fs.existsSync(LOGO_PATH);

// Standard PDF core fonts (Helvetica) only cover Latin-1/WinAnsi characters.
// Emoji (💻 🦊 💎 etc.) fall outside that range and render as garbled boxes.
// Product/description text often has emoji typed directly into it via the
// admin panel, so every piece of DB-sourced text must be run through this
// before being drawn.
function sanitizeText(str) {
  if (!str) return '';
  return String(str)
    // Emoji & pictograph blocks, dingbats, symbols, flags, variation
    // selectors, zero-width joiners, misc technical/arrows/etc.
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{2600}-\u{26FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function drawPageBackground(doc) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(THEME.bg);
  doc.restore();
}

function drawWatermark(doc) {
  doc.save();
  doc.fillColor(THEME.purple).opacity(0.06);
  doc.font('Helvetica-Bold').fontSize(60);
  const label = BOT_NAME.toUpperCase();
  const centerX = doc.page.width / 2;
  const centerY = doc.page.height / 2;
  doc.translate(centerX, centerY).rotate(-35, { origin: [0, 0] });
  for (let y = -400; y <= 400; y += 130) {
    doc.text(label, -400, y, { width: 800, align: 'center' });
  }
  doc.restore();
  doc.opacity(1);
}

// Circular bot logo. Uses the real uploaded logo image when available;
// otherwise falls back to a drawn "initials" badge so this never crashes.
function drawLogoMark(doc, x, y, size) {
  doc.save();
  if (LOGO_AVAILABLE) {
    doc.save();
    doc.circle(x + size / 2, y + size / 2, size / 2).clip();
    doc.image(LOGO_PATH, x, y, { width: size, height: size });
    doc.restore();
  } else {
    doc.roundedRect(x, y, size, size, size * 0.28).fill(THEME.gold);
    const initials = BOT_NAME.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    doc.fillColor(THEME.purpleDark).font('Helvetica-Bold').fontSize(size * 0.42)
      .text(initials, x, y + size * 0.28, { width: size, align: 'center' });
  }
  doc.restore();
}

function drawHeader(doc, subtitle) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 90).fill(THEME.purpleDark);
  doc.restore();

  drawLogoMark(doc, PAGE_MARGIN, 24, 40);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text(BOT_NAME, PAGE_MARGIN + 52, 28);
  doc.fillColor('#d9d4ff').font('Helvetica').fontSize(11)
    .text(`@${BOT_USERNAME}  -  ${subtitle}`, PAGE_MARGIN + 52, 54);

  const genDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  doc.fillColor('#d9d4ff').fontSize(9)
    .text(`Generated: ${genDate}`, PAGE_MARGIN, 90 - 24, {
      width: doc.page.width - PAGE_MARGIN * 2,
      align: 'right',
    });
}

function drawUserCard(doc, user, stats) {
  const top = 110;
  const height = 62;
  doc.save();
  doc.roundedRect(PAGE_MARGIN, top, doc.page.width - PAGE_MARGIN * 2, height, 8).fill(THEME.panel);
  doc.restore();

  const name = sanitizeText(user.first_name || user.username) || `User ${user.telegram_id}`;
  doc.fillColor(THEME.text).font('Helvetica-Bold').fontSize(13)
    .text(name, PAGE_MARGIN + 16, top + 12);
  doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9)
    .text(`Telegram ID: ${user.telegram_id}${user.username ? '   -   @' + user.username : ''}`, PAGE_MARGIN + 16, top + 32);

  const statX = doc.page.width - PAGE_MARGIN - 220;
  stats.forEach((s, i) => {
    const x = statX + i * 120;
    doc.fillColor(THEME.textDim).font('Helvetica').fontSize(9).text(s.label, x, top + 12, { width: 100, align: 'center' });
    doc.fillColor(THEME.gold).font('Helvetica-Bold').fontSize(16).text(s.value, x, top + 26, { width: 100, align: 'center' });
  });
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

module.exports = {
  THEME,
  PAGE_MARGIN,
  sanitizeText,
  drawPageBackground,
  drawWatermark,
  drawLogoMark,
  drawHeader,
  drawUserCard,
  drawFooter,
};
