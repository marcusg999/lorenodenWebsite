'use strict';
/* Tiny, deliberate inline formatting. The owner writes plain text; these are
   the only two marks that do anything, so nothing in the admin can inject HTML. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** **bold**, *italic*, and newlines → <br>. Everything else is escaped first. */
function rich(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\r?\n/g, '<br>');
}

/** Only allow links we are willing to put in an href. */
function safeHref(s) {
  const v = String(s ?? '').trim();
  if (!v) return '#';
  if (/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(v)) return esc(v);
  return '#';
}
const isExternal = s => /^https?:\/\//i.test(String(s ?? '').trim());

/** "*Linear Labs|The Midnight Hour" → [{text, hi}] */
function stripItems(s) {
  return String(s ?? '').split('|').map(p => p.trim()).filter(Boolean)
    .map(p => p.startsWith('*') ? { text: p.slice(1), hi: true } : { text: p, hi: false });
}

const truthy = v => v === '1' || v === 1 || v === true || v === 'true';

module.exports = { esc, rich, safeHref, isExternal, stripItems, truthy };
