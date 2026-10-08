/*!
 * Book Platform - auth.js
 * Firebase Authentication (Email/Password + Google) with a split-panel
 * modal matching the platform design, header state management and
 * favorites synchronization hooks.
 *
 * Security notes :
 * - Only the PUBLIC Firebase Web config is used (apiKey is public by design).
 * - No service accounts, no admin SDK, no secrets in the client.
 * - All user-controlled text is inserted with textContent (XSS-safe).
 */
"use strict";
(function (w, d) {
  var BK = w.BK, cfg = BK.cfg, T = cfg.i18n;
  var core = (w.BK_MOD && w.BK_MOD.core) || {};
  var el = core.el || function (t, c, h) { var n = d.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  var esc = core.esc || function (s) { return String(s == null ? "" : s); };
  var toast = core.toast || function () {};
  w.BK_MOD = w.BK_MOD || {};
  if (w.BK_MOD.auth) return;

  var fbCfg = cfg.firebase || {};
  if (!fbCfg.apiKey || !fbCfg.projectId) return; /* auth not configured : UI stays hidden */

  var FBV = "10.14.1";
  var app = null, auth = null, db = null, fsApi = null, authApi = null, User = null;
  var user = null, modal = null, mode = "login", busy = false;

  /* --------------------------------------------------- error messages */
  function errText(code) {
    var M = {
      "auth/invalid-email": "البريد الإلكتروني غير صالح",
      "auth/user-disabled": "هذا الحساب معطّل",
      "auth/user-not-found": "لا يوجد حساب بهذا البريد",
      "auth/wrong-password": "كلمة المرور غير صحيحة",
      "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة",
      "auth/email-already-in-use": "هذا البريد مستخدم بالفعل، سجّل الدخول",
      "auth/weak-password": "كلمة المرور ضعيفة (6 أحرف على الأقل)",
      "auth/too-many-requests": "محاولات كثيرة، حاول بعد قليل",
      "auth/popup-closed-by-user": "تم إلغاء النافذة",
      "auth/popup-blocked": "المتصفح منع النافذة المنبثقة، اسمح بها وحاول مجدداً",
      "auth/network-request-failed": "تعذّر الاتصال بالشبكة",
      "auth/operation-not-allowed": "طريقة الدخول غير مفعّلة في إعدادات Firebase"
    };
    return M[code] || "حدث خطأ غير متوقع، حاول مجدداً";
  }

  /* --------------------------------------------------- SDK loading */
  function loadSDK() {
    if (app) return Promise.resolve();
    return Promise.all([
      import("https://www.gstatic.com/firebasejs/" + FBV + "/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/" + FBV + "/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/" + FBV + "/firebase-firestore.js")
    ]).then(function (mods) {
      var appM = mods[0], authM = mods[1], fsM = mods[2];
      app = appM.initializeApp(fbCfg);
      authApi = authM;
      fsApi = fsM;
      auth = authM.getAuth(app);
      db = fsM.getFirestore(app);
      w.BK_MOD.fb = {
        app: app, auth: auth, db: db,
        authApi: authM, firestore: fsM,
        serverTimestamp: fsM.serverTimestamp
      };
      authM.setPersistence(auth, authM.browserLocalPersistence).catch(function () {});
      authM.onAuthStateChanged(auth, function (u) {
        user = u || null;
        renderAccount();
        BK.emit("bk:auth-changed", user);
      });
    });
  }

  /* --------------------------------------------------- modal skeleton */
  var MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M22 7l-10 6L2 7"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  var USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var GLOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 5.04c1.7 0 3.22.59 4.42 1.73l3.29-3.29C17.73 1.63 15.09.5 12 .5 7.4.5 3.44 3.14 1.5 7.02l3.84 2.98C6.25 7.31 8.88 5.04 12 5.04z"/><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62l3.72 2.89c2.17-2 3.72-4.96 3.72-8.7z"/><path fill="#FBBC05" d="M5.35 14.13a7.06 7.06 0 0 1 0-4.13L1.5 7.02a11.5 11.5 0 0 0 0 9.96l3.85-2.85z"/><path fill="#34A853" d="M12 23.5c3.09 0 5.69-1.02 7.58-2.76l-3.72-2.89c-1.03.69-2.35 1.1-3.86 1.1-3.12 0-5.75-2.27-6.66-4.96l-3.84 2.85C3.44 20.86 7.4 23.5 12 23.5z"/></svg>';

  function ipt(icon, type, name, placeholder, autocomplete) {
    var wrap = el("div", "bkIpt");
    wrap.innerHTML = icon;
    var input = el("input");
    input.type = type;
    input.name = name;
    input.placeholder = placeholder;
    input.required = true;
    if (autocomplete) input.setAttribute("autocomplete", autocomplete);
    if (input.type === "password") {
      var eye = el("button", "eye");
      eye.type = "button";
      eye.setAttribute("aria-label", "Show password");
      eye.innerHTML = EYE;
      eye.addEventListener("click", function () {
        input.type = input.type === "password" ? "text" : "password";
      });
      wrap.appendChild(eye);
    }
    wrap.appendChild(input);
    return wrap;
  }

  function buildModal() {
    if (modal) return;
    modal = el("div", "bkLoginW");
    modal.innerHTML =
      '<div class="bkLoginO"></div>' +
      '<div class="bkLoginC" role="dialog" aria-modal="true">' +
        '<div class="bkLoginB">' +
          '<h3 class="bt"></h3><p class="bp"></p>' +
          '<button type="button" class="sw"></button>' +
        "</div>" +
        '<div class="bkLoginF">' +
          '<h3 class="ft"></h3>' +
          '<div class="bkLoginE" role="alert"></div>' +
          '<div class="rows"></div>' +
          '<button type="button" class="sub"></button>' +
          '<button type="button" class="lnk fg"></button>' +
          '<div class="bkLoginS">' + esc(T.or) + "</div>" +
          '<div class="bkSocial"><button type="button" class="g" aria-label="Google">' + GLOGO + "</button></div>" +
          '<button type="button" class="lnk sww"></button>' +
        "</div>" +
      "</div>";
    d.body.appendChild(modal);

    modal.querySelector(".bkLoginO").addEventListener("click", close);
    d.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    modal.querySelector(".sw").addEventListener("click", function () { setMode(mode === "login" ? "register" : "login"); });
    modal.querySelector(".sww").addEventListener("click", function () { setMode(mode === "login" ? "register" : "login"); });
    modal.querySelector(".g").addEventListener("click", signInGoogle);
    modal.querySelector(".fg").addEventListener("click", forgot);
    modal.querySelector(".sub").addEventListener("click", submit);
    modal.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") { e.preventDefault(); submit(); }
    });
  }

  function setMode(m) {
    mode = m;
    if (!modal) buildModal();
    var rows = modal.querySelector(".rows");
    var isLogin = m === "login";
    modal.querySelector(".ft").textContent = isLogin ? T.loginTitle : T.registerTitle;
    modal.querySelector(".bt").textContent = isLogin ? T.loginTitle : T.registerTitle;
    modal.querySelector(".bp").textContent = isLogin ? T.noAccount : T.haveAccount;
    modal.querySelector(".sw").textContent = isLogin ? T.registerBtn : T.loginBtn;
    modal.querySelector(".sww").textContent = isLogin ? T.noAccount + " ← " + T.registerBtn : T.haveAccount + " ← " + T.loginBtn;
    modal.querySelector(".sub").textContent = isLogin ? T.loginBtn : T.registerBtn;
    modal.querySelector(".fg").style.display = isLogin ? "" : "none";
    rows.innerHTML = "";
    if (!isLogin) rows.appendChild(ipt(USER, "text", "name", T.name, "name"));
    rows.appendChild(ipt(MAIL, "email", "email", T.email, "email"));
    rows.appendChild(ipt(LOCK, "password", "pass", T.password, isLogin ? "current-password" : "new-password"));
    error(null);
  }

  function error(msg) {
    if (!modal) return;
    var box = modal.querySelector(".bkLoginE");
    if (msg) { box.textContent = msg; box.classList.add("v"); }
    else box.classList.remove("v");
  }
  function busyState(on) {
    busy = on;
    var b = modal.querySelector(".sub");
    b.disabled = on;
  }

  function open() {
    loadSDK().then(function () {
      if (user) { openUserMenu(); return; }
      buildModal();
      setMode(mode);
      modal.classList.add("v");
      var first = modal.querySelector("input");
      if (first) setTimeout(function () { first.focus(); }, 60);
    }).catch(function () {
      toast("تعذّر تحميل نظام الحسابات");
    });
  }
  function close() {
    if (modal) modal.classList.remove("v");
  }

  /* --------------------------------------------------- actions */
  function submit() {
    if (busy || !auth) return;
    var email = modal.querySelector('input[name="email"]').value.trim();
    var pass = modal.querySelector('input[name="pass"]').value;
    var nameEl = modal.querySelector('input[name="name"]');
    var name = nameEl ? nameEl.value.trim() : "";
    if (!email || !pass || (!name && mode === "register")) { error("يرجى تعبئة جميع الحقول"); return; }
    error(null);
    busyState(true);
    var p = mode === "login"
      ? authApi.signInWithEmailAndPassword(auth, email, pass)
      : authApi.createUserWithEmailAndPassword(auth, email, pass).then(function (cred) {
          if (name && authApi.updateProfile) return authApi.updateProfile(cred.user, { displayName: name }).then(function () { return cred; });
          return cred;
        });
    p.then(function () { busyState(false); close(); })
     .catch(function (e) { busyState(false); error(errText(e && e.code)); });
  }

  function forgot() {
    if (busy || !auth) return;
    var email = modal.querySelector('input[name="email"]').value.trim();
    if (!email) { error("أدخل بريدك الإلكتروني أولاً"); return; }
    error(null);
    busyState(true);
    authApi.sendPasswordResetEmail(auth, email)
      .then(function () { busyState(false); error(null); toast(T.resetSent); })
      .catch(function (e) { busyState(false); error(errText(e && e.code)); });
  }

  function signInGoogle() {
    if (busy || !auth) return;
    error(null);
    busyState(true);
    var prov = new authApi.GoogleAuthProvider();
    authApi.signInWithPopup(auth, prov)
      .then(function () { busyState(false); close(); })
      .catch(function (e) { busyState(false); error(errText(e && e.code)); });
  }

  function logout() {
    if (!auth) return;
    authApi.signOut(auth).catch(function () {});
    closeUserMenus();
  }

  /* --------------------------------------------------- header states */
  var ICON_USER = '<svg class="line" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  var ICON_OUT = '<svg viewBox="0 0 24 24"><path d="M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/></svg>';
  var ICON_HEART = '<svg viewBox="0 0 24 24"><path d="M19.5 12.572L12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.566"/></svg>';
  var ICON_FAVS = '<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';

  function initialOf(u) {
    var n = u.displayName || u.email || "?";
    return n.charAt(0).toUpperCase();
  }

  function renderAccount() {
    var btns = [d.getElementById("bkAcctBtn"), d.getElementById("bkAcctBtnM")];
    btns.forEach(function (btn) {
      if (!btn) return;
      if (!user) {
        /* guest : plain icon button */
        btn.innerHTML = ICON_USER;
        btn.classList.remove("bkAva");
        btn.removeAttribute("hidden");
        btn.onclick = null;
        btn.addEventListener("click", onGuestClick);
        return;
      }
      /* member : avatar + menu */
      btn.innerHTML = "";
      var ava = el("span", "bkAva");
      ava.textContent = initialOf(user);
      btn.appendChild(ava);
      btn.classList.add("bkAvaBtn");
      btn.removeAttribute("hidden");
      btn.onclick = function (ev) { ev.preventDefault(); toggleMenu(btn); };
    });
  }
  function onGuestClick(ev) {
    ev.preventDefault();
    open();
  }

  function toggleMenu(btn) {
    var wrap = btn.parentElement;
    var existing = wrap.querySelector(".bkMenu");
    if (existing) { existing.remove(); return; }
    closeUserMenus();
    var menu = el("div", "bkMenu");
    var head = el("div", "uH");
    var n = el("span", "uN");
    n.textContent = user.displayName || (user.email || "").split("@")[0];
    var e = el("span", "uE");
    e.textContent = user.email || "";
    head.appendChild(n); head.appendChild(e);
    menu.appendChild(head);

    var favs = el("button");
    favs.type = "button";
    favs.innerHTML = ICON_HEART + "<span>" + esc(T.myFavorites) + "</span>";
    favs.addEventListener("click", function () {
      closeUserMenus();
      BK.load("favorites").then(function () {
        if (w.BK_MOD.favorites) w.BK_MOD.favorites.open();
      }).catch(function () {});
    });
    menu.appendChild(favs);

    var out = el("button");
    out.type = "button";
    out.innerHTML = ICON_OUT + "<span>" + esc(T.logout) + "</span>";
    out.addEventListener("click", function () { closeUserMenus(); logout(); });
    menu.appendChild(out);

    wrap.classList.add("bkWrap");
    wrap.appendChild(menu);
    setTimeout(function () {
      d.addEventListener("click", function h(ev) {
        if (!menu.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) {
          menu.remove();
          d.removeEventListener("click", h);
        }
      });
    }, 10);
  }
  function closeUserMenus() {
    Array.prototype.forEach.call(d.querySelectorAll(".bkMenu"), function (m) { m.remove(); });
  }
  function openUserMenu() {
    /* member clicked account : toggle the first desktop menu */
    var btn = d.getElementById("bkAcctBtn") || d.getElementById("bkAcctBtnM");
    if (btn) toggleMenu(btn);
  }

  /* --------------------------------------------------- boot */
  renderAccount();
  w.BK_MOD.auth = { open: open, close: close, logout: logout, user: function () { return user; } };
})(window, document);
