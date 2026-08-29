"use strict";
// bv-shim.js — document_start preload for the embedded Wan2GP BrowserView.
// Fixes JedsDeadBaby: root(...).getElementById is not a function
// Root cause: Wan2GP's root() sometimes returns <gradio-app> Element,
// and stale Blocks-* JS does root(id).getElementById. Element/ShadowRoot
// in older Chromium lacked getElementById. Shim it via querySelector.
// Runs at document_start (before Blocks-BMC4HgbM.js eval), isolated world
// but with same DOM prototypes.
try {
  if (typeof Element !== 'undefined' && !Element.prototype.getElementById) {
    Element.prototype.getElementById = function(id) {
      try { return this.querySelector('#' + CSS.escape(String(id))); } catch { return null; }
    };
  }
  if (typeof ShadowRoot !== 'undefined' && ShadowRoot.prototype && !ShadowRoot.prototype.getElementById) {
    ShadowRoot.prototype.getElementById = function(id) {
      try { return this.querySelector('#' + CSS.escape(String(id))); } catch { return null; }
    };
  }
} catch {}
