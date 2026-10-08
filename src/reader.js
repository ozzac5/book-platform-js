/*!
 * Book Platform - reader.js
 * Internal full-screen book reader (lazy loaded ONLY when "Read Book" is clicked).
 *
 * Honest rendering chain (no fake reader) :
 *   1. pdfjs  : PDF.js renders the file on canvas (needs a CORS-enabled host)
 *   2. gdocs  : Google Docs viewer iframe (works for public PDFs)
 *   3. error  : clear message + "open in a new tab" / download buttons
 *
 * EPUB/other formats : explicitly reported as not internally renderable,
 * with a direct open/download fallback. Provider blocking (X-Frame-Options,
 * CORS) is handled as a real failure, never hidden.
 */
"use strict";
(function (w, d) {
  var BK = w.BK, cfg = BK.cfg, T = cfg.i18n;
  var core = (w.BK_MOD && w.BK_MOD.core) || {};
  var el = core.el || function (t, c, h) { var n = d.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  var esc = core.esc || function (s) { return String(s == null ? "" : s); };
  w.BK_MOD = w.BK_MOD || {};
  if (w.BK_MOD.reader) return;

  var R = cfg.reader || {};
  var box = null, body = null, pgLabel = null, doc = null, observer = null;
  var zoom = 1, pages = [], current = 1, renderToken = 0;

  var I = {
    close: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
    zin: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>',
    zout: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>'
  };

  function validUrl(u) {
    try {
      var p = new URL(u, location.href);
      return p.protocol === "https:" || p.protocol === "http:";
    } catch (e) { return false; }
  }

  /* --------------------------------------------------- shell */
  function buildShell(book) {
    if (box) destroy();
    box = el("div", "bkRdW");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", esc(book.title || ""));
    var head = el("div", "bkRdH");
    var t = el("span", "t");
    t.textContent = book.title || "";
    pgLabel = el("span", "pg");
    var bClose = mkBtn(I.close, T.readerClose, close);
    var bFull = mkBtn(I.full, "Fullscreen", toggleFull);
    var bIn = mkBtn(I.zin, "Zoom +", function () { setZoom(zoom + 0.25); });
    var bOut = mkBtn(I.zout, "Zoom -", function () { setZoom(zoom - 0.25); });
    var bExt = mkBtn(I.ext, T.readerOpen, null);
    if (validUrl(book.read)) bExt.addEventListener("click", function () { w.open(book.read, "_blank", "noopener"); });
    else bExt.classList.add("bO");
    var bDl = mkBtn(I.dl, T.readerDownload, null);
    if (validUrl(book.download)) {
      bDl.addEventListener("click", function () { w.open(book.download, "_blank", "noopener"); });
    } else bDl.classList.add("bO");
    head.appendChild(t); head.appendChild(pgLabel);
    head.appendChild(bOut); head.appendChild(bIn);
    head.appendChild(bFull); head.appendChild(bExt); head.appendChild(bDl); head.appendChild(bClose);
    body = el("div", "bkRdB");
    box.appendChild(head);
    box.appendChild(body);
    d.body.appendChild(box);
    box.classList.add("v");
    d.addEventListener("keydown", onKey);
  }
  function mkBtn(icon, label, fn) {
    var b = el("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = icon;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  function toggleFull() {
    if (!box) return;
    if (d.fullscreenElement === box) { d.exitFullscreen && d.exitFullscreen(); }
    else if (box.requestFullscreen) box.requestFullscreen();
    else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
  }
  function setZoom(z) {
    zoom = Math.min(Math.max(z, R.minZoom || 0.6), R.maxZoom || 3);
    if (doc) renderVisible(true);
  }
  function message(title, sub, actions) {
    var m = el("div", "bkRdMsg");
    m.setAttribute("role", "alert");
    var mt = el("div", "mT");
    mt.textContent = title;
    m.appendChild(mt);
    if (sub) { var ms = el("div", "mS"); ms.textContent = sub; m.appendChild(ms); }
    if (actions && actions.length) {
      var a = el("div", "a");
      actions.forEach(function (act) {
        var b = el("a", "bkBtn bkDl");
        b.href = act.href || "#";
        b.target = "_blank";
        b.rel = "noopener noreferrer";
        b.innerHTML = (act.icon || "") + "<span>" + esc(act.label) + "</span>";
        a.appendChild(b);
      });
      m.appendChild(a);
    }
    body.appendChild(m);
  }
  function loading() {
    body.innerHTML = '<div class="bkRdMsg"><div class="bkSpin"></div><div class="mS">' + esc(T.readerLoading) + "</div></div>";
  }
  function externalActions(book) {
    var acts = [];
    if (validUrl(book.read)) acts.push({ href: book.read, label: T.readerOpen, icon: I.ext });
    if (validUrl(book.download)) acts.push({ href: book.download, label: T.readerDownload, icon: I.dl });
    return acts;
  }

  /* --------------------------------------------------- strategy 1 : PDF.js */
  function loadPdfJs() {
    if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
    return new Promise(function (resolve, reject) {
      var s = d.createElement("script");
      s.src = (R.pdfJsCdn || "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/") + "pdf.min.js";
      s.onload = function () { w.pdfjsLib ? resolve(w.pdfjsLib) : reject(new Error("pdfjs missing")); };
      s.onerror = function () { reject(new Error("pdfjs failed")); };
      d.head.appendChild(s);
    });
  }
  function fetchPdf(url) {
    var ctrl = ("AbortController" in w) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
    return fetch(url, { mode: "cors", credentials: "omit", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  function tryPdfJs(book) {
    return loadPdfJs().then(function (lib) {
      if (!box) throw new Error("closed");
      lib.GlobalWorkerOptions.workerSrc = (R.pdfJsCdn || "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/") + "pdf.worker.min.js";
      return fetchPdf(book.read).then(function (buf) {
        if (!box) throw new Error("closed");
        var task = lib.getDocument({ data: buf });
        return task.promise;
      }).then(function (pdf) {
        if (!box) { try { pdf.destroy(); } catch (e) {} throw new Error("closed"); }
        doc = pdf;
        body.innerHTML = "";
        pages = [];
        var token = ++renderToken;
        var i;
        for (i = 1; i <= pdf.numPages; i++) {
          var holder = el("div");
          holder.setAttribute("data-page", String(i));
          holder.style.minHeight = "120px";
          body.appendChild(holder);
          pages.push(holder);
        }
        observePages(token);
        updateProgress();
      });
    });
  }
  function observePages(token) {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var n = parseInt(en.target.getAttribute("data-page"), 10);
        if (!isNaN(n)) renderPage(n, token);
      });
    }, { root: body, rootMargin: "900px 0px" });
    pages.forEach(function (p) { observer.observe(p); });
    body.addEventListener("scroll", updateProgress, { passive: true });
  }
  function renderPage(n, token) {
    if (!doc || token !== renderToken) return;
    var holder = pages[n - 1];
    if (!holder || holder.getAttribute("data-done")) return;
    holder.setAttribute("data-done", "1");
    doc.getPage(n).then(function (pg) {
      if (!box || token !== renderToken) return;
      var base = pg.getViewport({ scale: 1 });
      var avail = Math.max(280, body.clientWidth - 24);
      var scale = (avail / base.width) * zoom;
      var vp = pg.getViewport({ scale: scale * (w.devicePixelRatio > 1 ? 2 : 1.5) });
      var canvas = el("canvas", "bkRdPg");
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.aspectRatio = base.width + "/" + base.height;
      holder.innerHTML = "";
      holder.appendChild(canvas);
      pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
    }).catch(function () {
      holder.setAttribute("data-done", "");
      holder.textContent = "…";
    });
  }
  function renderVisible(clear) {
    if (clear) { renderToken++; pages.forEach(function (p) { p.removeAttribute("data-done"); if (clear) p.innerHTML = ""; }); }
    var rect = body.getBoundingClientRect();
    pages.forEach(function (p) {
      var r = p.getBoundingClientRect();
      if (r.bottom > rect.top - 900 && r.top < rect.bottom + 900) {
        renderPage(parseInt(p.getAttribute("data-page"), 10), renderToken);
      }
    });
  }
  function updateProgress() {
    if (!pgLabel || !pages.length) return;
    var mid = body.scrollTop + body.clientHeight / 3, best = 1;
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].offsetTop <= mid) best = i + 1; else break;
    }
    current = best;
    pgLabel.textContent = T.readerPage + " " + current + " / " + pages.length;
  }

  /* --------------------------------------------------- strategy 2 : Google Docs viewer */
  function tryGdocs(book) {
    return new Promise(function (resolve, reject) {
      if (!box) { reject(new Error("closed")); return; }
      body.innerHTML = "";
      var ifr = el("iframe", "bkRdIfr");
      ifr.src = "https://docs.google.com/viewer?url=" + encodeURIComponent(book.read) + "&embedded=true";
      ifr.setAttribute("allow", "fullscreen");
      body.appendChild(ifr);
      var hint = el("div", "bkRdHint");
      hint.innerHTML = "<span>" + esc(T.readerHint) + ' · <a href="' + esc(book.read) + '" target="_blank" rel="noopener noreferrer">' + esc(T.readerOpen) + "</a></span>";
      body.appendChild(hint);
      pgLabel.textContent = "";
      resolve();
    });
  }

  /* --------------------------------------------------- close / destroy */
  function destroy() {
    renderToken++;
    if (observer) { observer.disconnect(); observer = null; }
    if (doc) { try { doc.destroy(); } catch (e) {} doc = null; }
    if (box) { box.remove(); box = null; body = null; pgLabel = null; }
    d.removeEventListener("keydown", onKey);
  }
  function close() { destroy(); }

  /* --------------------------------------------------- public API */
  function open(book) {
    if (!book || !validUrl(book.read)) {
      /* nothing honest to show : keep the direct link behaviour */
      if (book && validUrl(book.download)) w.open(book.download, "_blank", "noopener");
      return;
    }
    buildShell(book);
    loading();
    var isEpub = /\.epub(\?|$)/i.test(book.read);
    var strategy = R.strategy || "auto";
    if (isEpub || strategy === "external") {
      message(T.readerUnsupported, "", externalActions(book));
      return;
    }
    var chain;
    if (strategy === "pdfjs") {
      chain = tryPdfJs(book);
    } else if (strategy === "gdocs") {
      chain = tryGdocs(book);
    } else { /* auto */
      chain = tryPdfJs(book).catch(function () {
        if (!box) throw new Error("closed");
        return tryGdocs(book);
      });
    }
    chain.catch(function (e) {
      if (!box || e && e.message === "closed") return;
      body.innerHTML = "";
      message(T.readerError, book.title || "", externalActions(book));
      if (w.console) console.info("BK reader fallback:", e && e.message);
    });
  }

  w.BK_MOD.reader = { open: open, close: close };
})(window, document);
