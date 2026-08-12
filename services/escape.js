/**
 * HTML-escaping helper shared between the renderer (preload contextBridge) and
 * the node --test suite (require). UMD wrapper keeps both happy.
 *
 * Renderer: preload.js exposes this as window.escHtml (via contextBridge).
 * Tests:    const escHtml = require('../services/escape.js')
 *
 * Use it EVERYWHERE dynamic strings (commit messages, env folder names, package
 * names) are interpolated into innerHTML — those come from the network or disk
 * and must never be parsed as markup.
 *
 * @module escape
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.escHtml = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Escape a value for safe interpolation into HTML text/attribute context.
   * Non-strings are coerced to string FIRST, then escaped — there is no
   * unescaped raw-string path for any input type.
   * @param {*} s
   * @returns {string}
   */
  function escHtml(s) {
    if (s == null) return ''
    const str = typeof s === 'string' ? s : String(s)
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  return escHtml
})
