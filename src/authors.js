/*!
 * Book Platform - authors.js
 * Author directory + author profile experience, built on Blogger's own
 * data (no fake database) :
 *
 * - Data source  : the blog labels JSON rendered by the template
 *                  (script#json:bloglabels -> { "author:Name": count })
 * - Directory    : /p/authors.html page containing <div id="bk-authors-app">
 *                  (author cards + client-side pagination)
 * - Author page  : the native label page /search/label/author:Name gets an
 *                  author profile header injected above the books grid.
 * - Biographies  : optional BK_CONFIG.authorBios map (never invented data).
 */
"use strict";
(function (w, d) {
  var BK = w.BK, cfg = BK.cfg, T = cfg.i18n;
  var core = (w.BK_MOD && w.BK_MOD.core) || {};
  var el = core.el || function (t, c, h) { var n = d.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  var esc = core.esc || function (s) { return String(s == null ? "" : s); };
  w.BK_MOD = w.BK_MOD || {};
  if (w.BK_MOD.authors) return;

  var PREFIX = cfg.authorPrefix;
  var PER_PAGE = 12;

  /* --------------------------------------------------- data */
  function readLabels() {
    var node = d.querySelector('script[id="json:bloglabels"]');
    if (!node) return {};
    try { return JSON.parse(node.textContent || "{}"); } catch (e) { return {}; }
  }
  function authors() {
    var raw = readLabels(), out = [];
    Object.keys(raw).forEach(function (k) {
      if (k.indexOf(PREFIX) === 0) {
        var v = parseInt(raw[k], 10);
        out.push({ raw: k, name: k.slice(PREFIX.length).trim(), count: isNaN(v) ? 0 : v });
      }
    });
    out.sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, "ar"); });
    return out;
  }
  function labelUrl(author) {
    return "/search/label/" + encodeURIComponent(author.raw);
  }
  function initial(name) { return (name || "?").trim().charAt(0) || "?"; }
  var HUES = [260, 205, 160, 25, 345, 285, 100, 15, 220, 320];
  function hue(name) {
    var h = 0, i;
    for (i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return HUES[h % HUES.length];
  }
  function avatar(name, cls) {
    var a = el("span", cls || "bkAtA");
    a.style.background = "hsl(" + hue(name) + " 62% 46%)";
    a.setAttribute("aria-hidden", "true");
    a.textContent = initial(name);
    return a;
  }

  /* --------------------------------------------------- directory page */
  function renderDirectory() {
    var app = d.getElementById("bk-authors-app");
    if (!app) return;
    var list = authors();
    var wrap = el("div", "bkAtsApp");
    var title = el("h2");
    title.textContent = T.authorsTitle;
    title.style.cssText = "margin:6px 0 2px";
    wrap.appendChild(title);

    if (!list.length) {
      var empty = el("div", "bkFavE");
      empty.textContent = T.authorsNone;
      wrap.appendChild(empty);
      app.appendChild(wrap);
      return;
    }

    var grid = el("div", "bkAts");
    var pager = el("nav", "bkAtPg");
    wrap.appendChild(grid);
    wrap.appendChild(pager);
    app.appendChild(wrap);

    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    var cur = 1;
    var q = parseInt(new URLSearchParams(location.search).get("bkpage"), 10);
    if (!isNaN(q) && q >= 1 && q <= pages) cur = q;

    function renderPage(p) {
      cur = Math.min(Math.max(1, p), pages);
      grid.innerHTML = "";
      var slice = list.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);
      slice.forEach(function (a) {
        var card = el("div", "bkAt");
        card.appendChild(avatar(a.name));
        var n = el("div", "bkAtN");
        n.textContent = a.name;
        var c = el("div", "bkAtC");
        c.textContent = a.count + " " + T.authorsCount;
        var v = el("a", "bkAtV");
        v.href = labelUrl(a);
        v.textContent = T.authorsView;
        card.appendChild(n); card.appendChild(c); card.appendChild(v);
        grid.appendChild(card);
      });
      pager.innerHTML = "";
      var mk = function (label, page, dis, on) {
        var b = el("button");
        b.type = "button";
        b.textContent = label;
        if (on) b.classList.add("on");
        if (dis) b.disabled = true;
        else b.addEventListener("click", function () {
          renderPage(page);
          try { history.replaceState(null, "", "?bkpage=" + page); } catch (e) {}
          app.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        return b;
      };
      pager.appendChild(mk("‹", cur - 1, cur === 1));
      for (var i = 1; i <= pages; i++) pager.appendChild(mk(String(i), i, false, i === cur));
      pager.appendChild(mk("›", cur + 1, cur === pages));
    }
    renderPage(cur);
  }

  /* --------------------------------------------------- author profile (label page) */
  function renderProfile() {
    if (!BK.ctx || !BK.ctx.isAuthorLabel) return;
    var raw = BK.ctx.label;
    var name = raw.slice(PREFIX.length).trim();
    var list = authors(), count = 0;
    list.forEach(function (a) { if (a.raw === raw) count = a.count; });
    var bio = (cfg.authorBios || {})[raw] || "";

    var head = el("section", "bkAtH");
    head.appendChild(avatar(name));
    var info = el("div");
    info.style.flex = "1 1";
    info.style.minWidth = "0";
    var n = el("div", "n");
    n.textContent = name;
    var c = el("div", "c");
    c.textContent = count + " " + T.authorsCount;
    info.appendChild(n); info.appendChild(c);
    if (bio) {
      var b = el("div", "bio");
      b.textContent = bio;
      info.appendChild(b);
    }
    head.appendChild(info);
    var back = el("a", "bkAtV");
    back.href = cfg.authorsPage || "/p/authors.html";
    back.textContent = T.authorsTitle;
    head.appendChild(back);

    /* insert above the posts area (Plus UI main container) */
    var anchor =
      d.getElementById("Blog01") ||
      d.querySelector(".blogPt") ||
      d.querySelector("#sec_Main_Widgets") ||
      d.querySelector(".mainC");
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(head, anchor);
    else if (d.querySelector(".blogP")) {
      var gp = d.querySelector(".blogP").parentElement;
      if (gp) gp.insertBefore(head, d.querySelector(".blogP"));
    }
  }

  /* --------------------------------------------------- boot */
  if (BK.ctx && BK.ctx.isAuthorsPage) renderDirectory();
  else if (BK.ctx && BK.ctx.isAuthorLabel) renderProfile();

  w.BK_MOD.authors = { authors: authors, renderDirectory: renderDirectory, renderProfile: renderProfile };
})(window, document);
