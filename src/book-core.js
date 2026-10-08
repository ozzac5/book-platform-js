/*!
 * Book Platform - book-core.js
 * Shared utilities + card enhancements for the Plus UI book platform.
 * Loaded lazily by the inline BOOK_SYSTEM_CONFIG bootstrap after page load.
 * Must stay dependency-free and small : if this file fails to load the
 * website keeps working (covers, cards, info box, direct links all work).
 */
"use strict";
(function (w, d) {
  var BK = w.BK, cfg = BK.cfg, T = cfg.i18n;
  w.BK_MOD = w.BK_MOD || {};
  if (w.BK_MOD.core) return; /* load once */

  /* ------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, cls, html) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function store(key, val) {
    try {
      if (arguments.length === 2) { w.localStorage.setItem(key, JSON.stringify(val)); return val; }
      var raw = w.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  /* Non-blocking toast (own implementation, does not rely on Plus UI internals) */
  var toastBox = null;
  function toast(msg) {
    if (!toastBox) {
      toastBox = el("div", "tNtf alt");
      (d.querySelector(".mainW") || d.body).appendChild(toastBox);
    }
    var t = el("div");
    t.textContent = msg;
    toastBox.appendChild(t);
    setTimeout(function () { t.remove(); }, 4600);
  }

  /* ------------------------------------------------------------------
   * 1. Card author lines : strip the "author:" prefix and reveal
   * ------------------------------------------------------------------ */
  function revealAuthors() {
    var prefix = cfg.authorPrefix;
    var nodes = d.querySelectorAll(".bkBy[hidden] .bkByN[data-raw]");
    Array.prototype.forEach.call(nodes, function (n) {
      var raw = n.getAttribute("data-raw") || n.textContent || "";
      if (raw.indexOf(prefix) === 0) raw = raw.slice(prefix.length);
      n.textContent = raw.trim();
      var box = n.parentElement;
      if (box) box.removeAttribute("hidden");
    });
  }

  /* ------------------------------------------------------------------
   * 2. Book data on listing cards (used by the favorites hearts)
   * ------------------------------------------------------------------ */
  function cardBook(card) {
    if (!card) return null;
    var id = card.getAttribute("data-id") || "";
    var a = card.querySelector(".pTtl a");
    var img = card.querySelector(".pThmb img");
    var by = card.querySelector(".bkByN");
    var prefix = cfg.authorPrefix;
    var author = by ? (by.getAttribute("data-raw") || by.textContent || "") : "";
    if (author.indexOf(prefix) === 0) author = author.slice(prefix.length);
    if (!id || !a) return null;
    return {
      id: id,
      title: (a.textContent || "").trim(),
      url: a.href,
      cover: img ? (img.currentSrc || img.src || "") : "",
      author: author.trim()
    };
  }

  /* ------------------------------------------------------------------
   * 3. Read button -> internal reader (capture phase, honest fallback)
   * ------------------------------------------------------------------ */
  function wireReader() {
    var read = d.getElementById("bkRead");
    if (!read) return;
    read.addEventListener("click", function (ev) {
      var book = w.BK_BOOK;
      if (!cfg.features.reader || !cfg.reader.enabled || !book || !book.read) return; /* default navigation */
      /* Let the reader decide : if the module fails, the browser follows the link */
      ev.preventDefault();
      BK.load("reader").then(function () {
        if (w.BK_MOD.reader && w.BK_MOD.reader.open) w.BK_MOD.reader.open(book);
        else location.href = book.read;
      }).catch(function () { location.href = book.read; });
    }, true);
  }

  /* ------------------------------------------------------------------
   * 4. Details favorites button -> favorites module
   * ------------------------------------------------------------------ */
  function wireDetailsFav() {
    var btn = d.getElementById("bkFav");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var book = w.BK_BOOK;
      if (!book || !book.id) return;
      BK.load("favorites").then(function () {
        if (w.BK_MOD.favorites) w.BK_MOD.favorites.toggle(book);
      }).catch(function () { toast(T.favAdd); });
    });
  }

  /* ------------------------------------------------------------------
   * 5. Header account button -> auth module
   * ------------------------------------------------------------------ */
  function wireAccount() {
    var ids = ["bkAcctBtn", "bkAcctBtnM"];
    ids.forEach(function (id) {
      var b = d.getElementById(id);
      if (!b || b.getAttribute("data-wired")) return;
      b.setAttribute("data-wired", "1");
      b.addEventListener("click", function () {
        BK.load("auth").then(function () {
          if (w.BK_MOD.auth) w.BK_MOD.auth.open();
        }).catch(function () { /* auth unavailable : stay silent */ });
      });
    });
  }

  /* ------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------ */
  revealAuthors();
  wireReader();
  wireDetailsFav();
  wireAccount();
  w.BK.on("bk:cards-updated", function () { revealAuthors(); });

  /* Optional enhancements, still lazy and non-blocking */
  if (cfg.features.favorites) {
    setTimeout(function () {
      BK.load("favorites").catch(function () { /* hearts stay hidden */ });
    }, 400);
  }
  if (cfg.features.auth && cfg.firebase && cfg.firebase.apiKey) {
    setTimeout(function () {
      BK.load("auth").catch(function () { /* account buttons stay hidden */ });
    }, 2600);
  }

  w.BK_MOD.core = {
    esc: esc, el: el, store: store, toast: toast, cardBook: cardBook
  };
})(window, document);
