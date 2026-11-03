'use strict';
const i18n = require('../media/i18n');
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function renderLocalizedHtml(template, language) {
  const translate = i18n.createTranslator(language);
  return template.replaceAll('{{LANG}}', i18n.resolveLanguage(language))
    .replace(/\{\{t:([^}]+)\}\}/g, (_match,key) => escapeHtml(translate(key)));
}
module.exports = { ...i18n, renderLocalizedHtml };
