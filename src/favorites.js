/*!
 * Book Platform - favorites.js
 * Favorites / bookmark system.
 * - Guests  : localStorage (key bk:favs)
 * - Members : Firestore users/{uid}/favorites/books, merged with local on login
 * - Instant heart toggling, no page reload, no heavy framework.
 */
"use strict";
(function (w, d) {
  var BK = w.BK, cfg = BK.cfg, T = cfg.i18n;
  var core = (w.BK_MOD && w.BK_MOD.core) || {};
  var el = core.el || function (t, c, h) { var n = d.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  var toast = core.toast || function () {};
  w.BK_MOD = w.BK_MOD || {};
  if (w.BK_MOD.favorites) return;

  var KEY = "bk:favs";
  var list = core.store ? (core.store(KEY) || []) : [];
  var user = null, db = null, syncing = false;

  /* --------------------------------------------------- storage layer */
  function saveLocal() {
    try { w.localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }
  function has(id) {
    return list.some(function (b) { return b.id === id; });
  }
  function indexOf(id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }
  function add(book) {
    if (has(book.id)) return false;
    list.unshift({ id: book.id, title: book.title, url: book.url, cover: book.cover || "", author: book.author || "" });
    saveLocal();
    return true;
  }
  function remove(id) {
    var i = indexOf(id);
    if (i < 0) return false;
    list.splice(i, 1);
    saveLocal();
    return true;
  }

  /* --------------------------------------------------- cloud (Firestore) */
  function cloudRef() {
    if (!db || !user) return null;
    try {
      var f = w.BK_MOD.fb;
      if (!f || !f.firestore) return null;
      return f.firestore.doc(f.db, "users", user.uid, "favorites", "books");
    } catch (e) { return null; }
  }
  function pushCloud() {
    var ref = cloudRef();
    if (!ref) return;
    try {
      var f = w.BK_MOD.fb;
      f.firestore.setDoc(ref, { items: JSON.parse(JSON.stringify(list)), updatedAt: f.serverTimestamp() }).catch(function () {});
    } catch (e) {}
  }
  function pullMerge() {
    var ref = cloudRef();
    if (!ref || syncing) return;
    syncing = true;
    try {
      var f = w.BK_MOD.fb;
      f.firestore.getDoc(ref).then(function (snap) {
        var remote = (snap.exists() && snap.data() && snap.data().items) || [];
        /* union by id : local first (newest), then unseen remote items */
        remote.forEach(function (b) {
          if (b && b.id && !has(b.id)) list.push({ id: b.id, title: b.title || "", url: b.url || "", cover: b.cover || "", author: b.author || "" });
        });
        saveLocal();
        renderAll();
        syncing = false;
      }).catch(function () { syncing = false; });
    } catch (e) { syncing = false; }
  }

  /* --------------------------------------------------- hearts on cards */
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12.572L12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.566"/></svg>';

  function injectHearts() {
    var cards = d.querySelectorAll(".blogP article[data-id], .itemRp article[data-id], .itemRp >*[data-id], article.itm[data-id]");
    Array.prototype.forEach.call(cards, function (card) {
      var thumb = card.querySelector(".pThmb");
      if (!thumb || thumb.querySelector(".bkHeart")) return;
      var book = (core.cardBook || cardBookLocal)(card);
      if (!book) return;
      var btn = el("button", "bkHeart");
      btn.type = "button";
      btn.setAttribute("aria-label", T.favAdd);
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = HEART;
      if (has(book.id)) { btn.classList.add("on"); btn.setAttribute("aria-pressed", "true"); }
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        toggle(book, btn);
      });
      thumb.appendChild(btn);
    });
  }
  /* PopularPosts items use .itm articles without data-id in some builds */
  function cardBookLocal(card) {
    var id = card.getAttribute("data-id") || "";
    var a = card.querySelector(".pTtl a, .ttl a");
    if (!a) return null;
    var img = card.querySelector(".pThmb img");
    return {
      id: id || a.href,
      title: (a.textContent || "").trim(),
      url: a.href,
      cover: img ? (img.currentSrc || img.src || "") : "",
      author: ""
    };
  }

  function markHeart(btn, on) {
    btn.classList.toggle("on", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /* --------------------------------------------------- details button */
  function syncDetailsButton() {
    var btn = d.getElementById("bkFav");
    if (!btn || !w.BK_BOOK || !w.BK_BOOK.id) return;
    btn.removeAttribute("hidden");
    var on = has(w.BK_BOOK.id);
    btn.classList.toggle("on", on);
    var label = btn.querySelector(".bkFavT");
    var txt = on ? (btn.getAttribute("data-txt-faved") || T.favsTitle) : (btn.getAttribute("data-txt-fav") || T.favAdd);
    if (label) label.textContent = txt;
  }

  /* --------------------------------------------------- drawer */
  var drawer = null, listBox = null;
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';

  function buildDrawer() {
    if (drawer) return;
    drawer = el("div", "bkFavsW");
    drawer.innerHTML =
      '<div class="bkFavsO"></div>' +
      '<aside class="bkFavs" role="dialog" aria-label="' + (core.esc ? core.esc(T.favsTitle) : T.favsTitle) + '">' +
        '<div class="bkFavsH"><span>' + (core.esc ? core.esc(T.favsTitle) : T.favsTitle) + '</span>' +
        '<button type="button" class="x" aria-label="' + (core.esc ? core.esc(T.readerClose) : "Close") + '">' + CLOSE_SVG + "</button></div>" +
        '<div class="bkFavsL"></div>' +
      "</aside>";
    d.body.appendChild(drawer);
    listBox = drawer.querySelector(".bkFavsL");
    drawer.querySelector(".bkFavsO").addEventListener("click", closeDrawer);
    drawer.querySelector(".x").addEventListener("click", closeDrawer);
    d.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    listBox.addEventListener("click", function (e) {
      var rm = e.target.closest ? e.target.closest(".rm") : null;
      if (!rm) return;
      e.preventDefault();
      var id = rm.getAttribute("data-id");
      remove(id);
      renderAll();
    });
  }
  function openDrawer() {
    buildDrawer();
    renderList();
    drawer.classList.add("v");
  }
  function closeDrawer() {
    if (drawer) drawer.classList.remove("v");
  }
  function renderList() {
    if (!listBox) return;
    listBox.innerHTML = "";
    if (!list.length) {
      listBox.innerHTML = '<div class="bkFavE">' + (core.esc ? core.esc(T.favsEmpty) : T.favsEmpty) + "</div>";
      return;
    }
    list.forEach(function (b) {
      var item = el("div", "bkFavI");
      var cv = el("a", "cv");
      cv.href = b.url || "#";
      if (b.cover) {
        var im = el("img");
        im.src = b.cover;
        im.alt = "";
        im.loading = "lazy";
        cv.appendChild(im);
      }
      var tx = el("div", "tx");
      var ti = el("div", "ti");
      var a = el("a");
      a.href = b.url || "#";
      a.textContent = b.title || "";
      ti.appendChild(a);
      tx.appendChild(ti);
      if (b.author) {
        var au = el("div", "au");
        au.textContent = b.author;
        tx.appendChild(au);
      }
      var rm = el("button", "rm");
      rm.type = "button";
      rm.setAttribute("data-id", b.id);
      rm.setAttribute("aria-label", T.favsRemove);
      rm.innerHTML = TRASH_SVG;
      item.appendChild(cv);
      item.appendChild(tx);
      item.appendChild(rm);
      listBox.appendChild(item);
    });
  }

  /* Menu entry inside the account menu (wired by auth.js through the bus) */
  BK.on("bk:open-favs", openDrawer);

  /* --------------------------------------------------- public API */
  function toggle(book, btn) {
    var added;
    if (has(book.id)) { remove(book.id); added = false; toast(T.favRemoved); }
    else { add(book); added = true; toast(T.favAdded); }
    if (btn) markHeart(btn, added);
    /* keep every matching heart in sync */
    if (btn) {
      var all = d.querySelectorAll('.bkHeart');
      Array.prototype.forEach.call(all, function (b) {
        var card = b.closest ? b.closest("article[data-id]") : null;
        if (card && card.getAttribute("data-id") === book.id) markHeart(b, added);
      });
    }
    syncDetailsButton();
    if (drawer && drawer.classList.contains("v")) renderList();
    if (added && user) pushCloud();
    BK.emit("bk:favs-changed", list);
  }

  function renderAll() {
    injectHearts();
    /* refresh existing hearts state */
    Array.prototype.forEach.call(d.querySelectorAll(".bkHeart"), function (b) {
      var card = b.closest ? b.closest("article[data-id]") : null;
      if (!card) return;
      markHeart(b, has(card.getAttribute("data-id")));
    });
    syncDetailsButton();
    if (drawer && drawer.classList.contains("v")) renderList();
  }

  /* --------------------------------------------------- auth sync */
  BK.on("bk:auth-changed", function (u) {
    user = u || null;
    var f = w.BK_MOD && w.BK_MOD.fb;
    db = f && f.db ? f.db : null;
    if (user) pullMerge(); else renderAll();
  });

  /* --------------------------------------------------- boot */
  renderAll();
  w.BK_MOD.favorites = {
    toggle: toggle, has: has, list: function () { return list.slice(); },
    open: openDrawer, close: closeDrawer, refresh: renderAll, pushCloud: pushCloud
  };
  BK.emit("bk:favs-ready", true);
})(window, document);
