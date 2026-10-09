/*!
 * Book Platform - book-core.js (v3)
 * Small, dependency-free core loaded on every page :
 *
 *  1. Navigation  : categories dropdown (desktop) + mobile three-dot panel,
 *                   both filled from the REAL blog labels (script#json:bloglabels).
 *  2. Authors     : strips the technical "مؤلف:" / "author:" prefix from the
 *                   server-rendered author links (cards + book details).
 *  3. Triggers    : read button -> internal reader module, favorite button ->
 *                   favorites module, account links -> account page with a
 *                   ?redirect= parameter so visitors come back after login.
 *  4. Shared SDK  : BK.fb() lazily imports the Firebase modular SDK ONCE and
 *                   reuses it for auth / ratings / favorites.
 *
 * If this file fails to load the website still works : server-rendered
 * author links, categories links, search, reader link and download links.
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
  function stripPrefix(s) {
    s = String(s || "");
    var m = /^(?:\u0645\u0624\u0644\u0641|author):\s*/.exec(s); /* "مؤلف:" or "author:" */
    return m ? s.slice(m[0].length).trim() : s.trim();
  }

  /* ------------------------------------------------------------------
   * 1. Author names on cards + book details (server-rendered links)
   * ------------------------------------------------------------------ */
  function revealAuthors() {
    var nodes = d.querySelectorAll(".bkByN[data-raw], .bkAuthN[data-raw]");
    Array.prototype.forEach.call(nodes, function (n) {
      n.textContent = stripPrefix(n.getAttribute("data-raw") || n.textContent);
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
    var author = by ? stripPrefix(by.getAttribute("data-raw") || by.textContent) : "";
    if (!id || !a) return null;
    return {
      id: id,
      title: (a.textContent || "").trim(),
      url: a.href,
      cover: img ? (img.currentSrc || img.src || "") : "",
      author: author
    };
  }

  /* ------------------------------------------------------------------
   * 3. Real categories : dropdown (desktop) + mobile panel chips
   *    Data source : script#json:bloglabels rendered by the template
   *    ({ "LabelName": count }). Author labels are excluded.
   * ------------------------------------------------------------------ */
  function readLabels() {
    var node = d.querySelector('script[id="json:bloglabels"]');
    if (!node) return {};
    try { return JSON.parse(node.textContent || "{}"); } catch (e) { return {}; }
  }
  function categories() {
    var raw = readLabels(), out = [];
    Object.keys(raw).forEach(function (k) {
      if (BK.isAuthorPrefix && BK.isAuthorPrefix(k)) return;
      var v = parseInt(raw[k], 10);
      out.push({ name: k, count: isNaN(v) ? 0 : v });
    });
    out.sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, "ar"); });
    return out.slice(0, 12);
  }
  function labelHref(name) {
    return "/search/label/" + encodeURIComponent(name);
  }
  function buildCats() {
    var cats = categories(), i, li, a, drop, grid, box;
    /* Desktop dropdown grid */
    grid = d.getElementById("bkCatsDrop");
    if (grid) {
      box = grid.querySelector(".bkDdG");
      if (box) {
        box.innerHTML = "";
        if (!cats.length) {
          var empty = el("span", "bkDdE", "");
          empty.textContent = T.catsEmpty || "لا توجد تصنيفات بعد";
          box.appendChild(empty);
        }
        for (i = 0; i < cats.length; i++) {
          a = el("a");
          a.href = labelHref(cats[i].name);
          a.appendChild(d.createTextNode(cats[i].name));
          a.appendChild(el("b", null, String(cats[i].count)));
          box.appendChild(a);
        }
      }
    }
    /* Mobile panel chips */
    box = d.getElementById("bkMNcats");
    if (box) {
      box.innerHTML = "";
      for (i = 0; i < cats.length; i++) {
        li = el("li");
        a = el("a");
        a.href = labelHref(cats[i].name);
        a.textContent = cats[i].name;
        li.appendChild(a);
        box.appendChild(li);
      }
    }
  }
  function closeDrop(dd, btn) {
    dd.classList.remove("v");
    btn.setAttribute("aria-expanded", "false");
  }
  function wireCats() {
    var btn = d.getElementById("bkCatsBtn"), dd = btn ? btn.closest(".bkDd") : null;
    if (!btn || !dd || btn.getAttribute("data-wired")) return;
    btn.setAttribute("data-wired", "1");
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var open = dd.classList.toggle("v");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    btn.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); btn.click(); }
      if (ev.key === "Escape") closeDrop(dd, btn);
    });
    d.addEventListener("click", function (ev) {
      if (dd.classList.contains("v") && !dd.contains(ev.target)) closeDrop(dd, btn);
    });
    d.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeDrop(dd, btn);
    });
  }

  /* ------------------------------------------------------------------
   * 4. Mobile three-dot panel : open/close, ARIA, RTL-safe
   * ------------------------------------------------------------------ */
  function wireMobNav() {
    var btn = d.getElementById("bkDotsBtn"), panel = d.getElementById("bkMobNav");
    if (!btn || !panel || btn.getAttribute("data-wired")) return;
    btn.setAttribute("data-wired", "1");
    function open() {
      panel.removeAttribute("hidden");
      panel.classList.add("v");
      btn.setAttribute("aria-expanded", "true");
      btn.setAttribute("aria-label", T.menuClose || "إغلاق القائمة");
      var first = panel.querySelector("input, a");
      if (first) first.focus();
    }
    function close(refocus) {
      panel.classList.remove("v");
      panel.setAttribute("hidden", "hidden");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "فتح قائمة التصفح");
      if (refocus) btn.focus();
    }
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (panel.classList.contains("v")) close(true); else open();
    });
    /* close when a navigation link inside is chosen */
    panel.addEventListener("click", function (ev) {
      var a = ev.target.closest ? ev.target.closest("a") : null;
      if (a) close(false);
    });
    /* Escape + outside click */
    d.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && panel.classList.contains("v")) close(true);
    });
    d.addEventListener("click", function (ev) {
      if (panel.classList.contains("v") && !panel.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) close(false);
    });
  }

  /* ------------------------------------------------------------------
   * 5. Read button -> internal reader (capture phase, honest fallback)
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
   * 6. Details favorites button -> favorites module
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
   * 7. Account links : carry ?redirect= so visitors land back on the
   *    page they came from after a successful login.
   * ------------------------------------------------------------------ */
  function wireAccountLinks() {
    if (BK.ctx.isAccountPage) return;
    var back = location.pathname + location.search;
    var ids = ["bkAcctBtn", "bkAcctBtnM", "bkMNAcct"];
    ids.forEach(function (id) {
      var a = d.getElementById(id);
      if (!a || a.getAttribute("data-rdr")) return;
      a.setAttribute("data-rdr", "1");
      try {
        a.href = cfg.accountPage + "?redirect=" + encodeURIComponent(back);
      } catch (e) {}
    });
  }

  /* ------------------------------------------------------------------
   * 8. Shared Firebase loader : ONE dynamic import for all modules.
   *    Only the PUBLIC web config is used - never server credentials.
   * ------------------------------------------------------------------ */
  var fbPromise = null;
  function fb() {
    if (fbPromise) return fbPromise;
    var c = cfg.firebase || {};
    if (!c.apiKey || !c.projectId) return Promise.reject(new Error("BK: firebase not configured"));
    var V = "10.14.1";
    fbPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/" + V + "/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/" + V + "/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/" + V + "/firebase-firestore.js")
    ]).then(function (mods) {
      var appM = mods[0], authM = mods[1], fsM = mods[2];
      var app = appM.initializeApp(c);
      var auth = authM.getAuth(app);
      var db = fsM.getFirestore(app);
      try { authM.setPersistence(auth, authM.browserLocalPersistence).catch(function () {}); } catch (e) {}
      var shared = {
        app: app, auth: auth, db: db,
        authApi: authM, firestore: fsM,
        serverTimestamp: fsM.serverTimestamp
      };
      w.BK_MOD.fb = shared; /* consumed by favorites.js and others */
      return shared;
    });
    return fbPromise;
  }

  /* ------------------------------------------------------------------
   * Boot
   * ------------------------------------------------------------------ */
  revealAuthors();
  buildCats();
  wireCats();
  wireMobNav();
  wireReader();
  wireDetailsFav();
  wireAccountLinks();
  w.BK.on("bk:cards-updated", function () { revealAuthors(); });

  w.BK_MOD.core = {
    esc: esc, el: el, store: store, toast: toast, cardBook: cardBook,
    stripPrefix: stripPrefix, buildCats: buildCats, fb: fb
  };
  w.BK.fb = fb;
})(window, document);
