/*!
 * Book Platform - ratings.js (v3.1)
 * REAL user ratings backed by Firestore. Replaces the old static #bookStars.
 *
 * v3.1 : failures now tell the site owner EXACTLY what is wrong :
 *   permission-denied     -> Firestore Rules not published yet
 *   failed-precondition   -> Firestore database not created yet
 *   unavailable/network   -> connectivity issue
 * Every other message stays honest : no fake defaults, ever.
 *
 * Data model (see firestore.rules) :
 *   books/{postId}/ratings/{uid}  = { r: <int 1..5>, t: <serverTimestamp> }
 *   - one document per user per book  -> a user cannot rate twice under
 *     different docs, they simply overwrite their own document.
 *   - the average and the count are ALWAYS computed from the actual rating
 *     documents with an aggregation query (count + sum). Visitors never
 *     write to any trusted aggregate field, so there is nothing to fake.
 *   - the book key is the stable Blogger post id (window.BK_BOOK.id),
 *     never the title.
 *
 * Behaviour :
 *   - member   : taps a star -> saved to Firestore, can change it later.
 *   - guest    : sees the real average + count; tapping a star shows an
 *                Arabic notice with a login link (back to this book after
 *                login via ?redirect=).
 *   - no data  : "لا تقييمات بعد" (never a fake default rating).
 *   - failure  : honest error message, no invented numbers.
 */
"use strict";
(function (w, d) {
  var BK = w.BK, cfg = BK.cfg, T = cfg.i18n;
  var core = (w.BK_MOD && w.BK_MOD.core) || {};
  var el = core.el || function (t, c, h) { var n = d.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  w.BK_MOD = w.BK_MOD || {};
  if (w.BK_MOD.ratings) return;

  var mount = d.getElementById("bookStars");
  var book = w.BK_BOOK || {};
  if (!mount || !book.id) return;             /* nothing to rate on this page */
  if (!cfg.firebase || !cfg.firebase.apiKey) return; /* feature not configured : stay hidden */

  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.26 6.6.57-5 4.36 1.5 6.46L12 16.9 5.99 19.65l1.5-6.46-5-4.36 6.6-.57z"/></svg>';
  var uid = null, fb = null, busy = false, stats = { count: 0, avg: 0 }, mine = 0;

  /* --------------------------------------------------- UI */
  var starsBox = el("span", "bkStW");
  var valueTxt = el("b", "bkStV");
  var countTxt = el("span", "bkStN");
  var note = el("span", "bkStL");
  var btns = [];
  for (var i = 1; i <= 5; i++) {
    (function (v) {
      var b = el("button", "bkStB");
      b.type = "button";
      b.setAttribute("aria-label", v + " / 5");
      b.innerHTML = STAR;
      b.addEventListener("click", function () { rate(v); });
      starsBox.appendChild(b);
      btns.push(b);
    })(i);
  }
  function paint() {
    var shown = mine || Math.round(stats.avg);
    for (var k = 0; k < 5; k++) {
      if (k < shown) btns[k].classList.add("f");
      else btns[k].classList.remove("f");
    }
    if (stats.count > 0) {
      valueTxt.textContent = (Math.round(stats.avg * 10) / 10).toString();
      countTxt.textContent = "(" + (stats.count === 1 ? T.ratingOne : T.ratingBased + " " + stats.count + " " + T.ratingCount) + ")";
    } else {
      valueTxt.textContent = "";
      countTxt.textContent = "";
    }
    if (mine) note.textContent = T.ratingYour + ": " + mine + " / 5";
  }
  function notice(htmlNode) {
    note.innerHTML = "";
    note.appendChild(htmlNode);
  }
  function guestNotice() {
    note.innerHTML = "";
    var a = el("a");
    a.href = cfg.accountPage + "?redirect=" + encodeURIComponent(location.pathname + location.search);
    a.textContent = T.ratingLogin;
    var txt = d.createTextNode("");
    note.appendChild(txt);
    note.appendChild(a);
    /* message before the link */
    note.insertBefore(d.createTextNode(T.ratingLoginBtn + " — "), a);
  }
  function failNotice(code) {
    var M = {
      "permission-denied": "تعذّر الحفظ: قواعد أمان Firestore غير منشورة — انشر القواعد من ملف firestore.rules (الدليل، خطوة نشر القواعد)",
      "failed-precondition": "قاعدة بيانات Firestore غير مُنشأة — أنشئها من وحدة تحكم Firebase ثم أعد المحاولة",
      "not-found": "قاعدة بيانات Firestore غير مُنشأة — أنشئها من وحدة تحكم Firebase",
      "unavailable": "تعذّر الاتصال بقاعدة البيانات — تحقق من الاتصال ثم أعد المحاولة",
      "network-request-failed": "تعذّر الاتصال بالشبكة — تحقق من الإنترنت ثم أعد المحاولة"
    };
    note.textContent = (code && M[code]) || T.ratingFail;
  }
  function emptyNotice() {
    note.textContent = T.ratingEmpty;
  }

  mount.innerHTML = "";
  mount.appendChild(starsBox);
  mount.appendChild(valueTxt);
  mount.appendChild(countTxt);
  mount.appendChild(note);
  mount.removeAttribute("hidden");

  /* --------------------------------------------------- Firestore */
  function ratingsCol() {
    return fb.firestore.collection(fb.db, "books", String(book.id), "ratings");
  }
  function loadStats() {
    var c = ratingsCol();
    /* Preferred : server-side aggregation (count + sum of r). */
    try {
      var q = fb.firestore.query(c);
      fb.firestore.getAggregateFromServer(q, { count: fb.firestore.count(), total: fb.firestore.sum("r") })
        .then(function (snap) {
          var n = snap.getData().count || 0;
          var sum = snap.getData().total || 0;
          stats.count = n;
          stats.avg = n ? sum / n : 0;
          paint();
          if (!stats.count && !mine) emptyNotice(); else if (!mine) note.textContent = "";
        })
        .catch(function (e) { fallbackStats(c, e && e.code); });
    } catch (e) { fallbackStats(c, e && e.code); }
  }
  /* Fallback for environments without aggregation support : read up to
     200 real rating docs and compute locally from the actual records. */
  function fallbackStats(c, errCode) {
    fb.firestore.getDocs(fb.firestore.query(c, fb.firestore.limit(200)))
      .then(function (snap) {
        var n = 0, sum = 0;
        snap.forEach(function (docu) {
          var r = docu.data() && docu.data().r;
          if (typeof r === "number" && r >= 1 && r <= 5) { n++; sum += r; }
        });
        stats.count = n; stats.avg = n ? sum / n : 0;
        paint();
        if (!stats.count && !mine) emptyNotice(); else if (!mine) note.textContent = "";
      })
      .catch(function (e) { failNotice((e && e.code) || errCode); });
  }
  function loadMine() {
    if (!uid) { mine = 0; paint(); return; }
    fb.firestore.getDoc(fb.firestore.doc(fb.db, "books", String(book.id), "ratings", uid))
      .then(function (s) {
        var r = s.exists() && s.data() && s.data().r;
        mine = (typeof r === "number" && r >= 1 && r <= 5) ? r : 0;
        paint();
      })
      .catch(function () {});
  }
  function rate(v) {
    if (busy) return;
    if (!uid) { guestNotice(); return; }        /* guest : ask to log in */
    if (!(v >= 1 && v <= 5 && v % 1 === 0)) return;   /* hard validation */
    busy = true;
    var prev = mine;
    mine = v; paint();                          /* optimistic */
    try {
      fb.firestore.setDoc(
        fb.firestore.doc(fb.db, "books", String(book.id), "ratings", uid),
        { r: v, t: fb.serverTimestamp() },
        { merge: true }
      ).then(function () {
        busy = false;
        note.textContent = T.ratingSaved;
        if (core.toast) core.toast(T.ratingSaved);
        loadStats();                            /* average always recomputed from records */
      }).catch(function (e) {
        busy = false; mine = prev; paint(); failNotice(e && e.code);
        if (core.toast) core.toast("لم يتم حفظ التقييم: " + (e && e.code ? e.code : "خطأ غير معروف"));
      });
    } catch (e) { busy = false; mine = prev; paint(); failNotice(e && e.code); }
  }

  /* --------------------------------------------------- init */
  var fbLoader = (core && core.fb) || (w.BK && w.BK.fb);
  if (!fbLoader) return;
  fbLoader().then(function (shared) {
    fb = shared;
    fb.authApi.onAuthStateChanged(fb.auth, function (u) {
      uid = u ? u.uid : null;
      loadMine();
      if (!uid) guestNotice();
    });
    loadStats();
  }).catch(function (e) { failNotice(e && e.code); });

  w.BK_MOD.ratings = { rate: rate, stats: function () { return stats; } };
})(window, document);
