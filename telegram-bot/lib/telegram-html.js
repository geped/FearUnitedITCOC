'use strict';

/**
 * Converte testo + entities Telegram in HTML (parse_mode HTML del Bot API).
 * Offset/length sono in unità UTF-16 come da specifica Telegram.
 * Entità sovrapposte: le interne vengono ignorate (caso raro).
 */

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapEntity(innerEscaped, ent) {
  switch (ent.type) {
    case 'bold':
      return `<b>${innerEscaped}</b>`;
    case 'italic':
      return `<i>${innerEscaped}</i>`;
    case 'underline':
      return `<u>${innerEscaped}</u>`;
    case 'strikethrough':
      return `<s>${innerEscaped}</s>`;
    case 'code':
      return `<code>${innerEscaped}</code>`;
    case 'pre':
      return `<pre>${innerEscaped}</pre>`;
    case 'text_link':
      return `<a href="${escapeHtml(ent.url || '')}">${innerEscaped}</a>`;
    case 'spoiler':
      return `<tg-spoiler>${innerEscaped}</tg-spoiler>`;
    case 'blockquote':
    case 'expandable_blockquote':
      return `<blockquote>${innerEscaped}</blockquote>`;
    default:
      return innerEscaped;
  }
}

function messageEntitiesToHtml(text, entities) {
  if (!text) return '';
  if (!entities || !entities.length) return escapeHtml(text);
  const sorted = [...entities].sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset;
    return b.length - a.length;
  });
  let html = '';
  let cursor = 0;
  for (const ent of sorted) {
    const s = ent.offset;
    const e = s + ent.length;
    if (s < cursor) continue;
    if (s > cursor) {
      html += escapeHtml(text.substring(cursor, s));
    }
    const raw = text.substring(s, e);
    html += wrapEntity(escapeHtml(raw), ent);
    cursor = e;
  }
  if (cursor < text.length) {
    html += escapeHtml(text.substring(cursor));
  }
  return html;
}

function messageToHtml(msg) {
  if (!msg) return '';
  if (msg.caption != null && String(msg.caption).length) {
    return messageEntitiesToHtml(msg.caption, msg.caption_entities || []);
  }
  if (msg.text != null) {
    return messageEntitiesToHtml(msg.text, msg.entities || []);
  }
  return '';
}

module.exports = {
  messageEntitiesToHtml,
  messageToHtml,
  escapeHtml,
};
