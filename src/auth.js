/*!
 * Book Platform - auth.js (v3.1)
 * Firebase Authentication with a DEDICATED ACCOUNT PAGE (/p/account.html)
 * instead of a popup modal :
 *
 *   - The page hosts a tabbed interface : تسجيل الدخول / حساب جديد,
 *     plus نسيت كلمة المرور؟ and تسجيل الخروج when authenticated.
 *   - Header : guests keep a link to the account page (with ?redirect=
 *     so they come back), members get an avatar + a small menu.
 *   - Mobile : the bottom-bar account icon links to the same page.
 *
 * Security notes :
 *   - Only the PUBLIC Firebase Web config is used (apiKey is public by design).
 *   - No service accounts, no admin SDK, no secrets in the client.
 *   - All user-controlled text is inserted with textContent (XSS-safe).
 *   - The Firebase SDK is imported lazily ONCE through book-core's BK.fb().
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
  var fb = null, user = null, busy = false;
  var pageRoot = d.getElementById("bk-account-app");
  var onAccountPage = BK.ctx.isAccountPage || !!pageRoot;

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
      "auth/operation-not-allowed": "طريقة الدخول غير مفعّلة في إعدادات Firebase",
      "auth/unauthorized-domain": "نطاق الموقع غير مسجل في إعدادات Firebase"
    };
    return M[code] || "حدث خطأ غير متوقع، حاول مجدداً";
  }

  /* --------------------------------------------------- helpers */
  function redirectBack() {
    var p = new URLSearchParams(location.search).get("redirect") || "";
    if (p && p.charAt(0) === "/" && p.indexOf("//") !== 0) location.replace(p);
    else location.replace("/");
  }
  function avatarLetter(u) {
    return ((u && (u.displayName || u.email)) || "؟").trim().charAt(0).toUpperCase();
  }
  var MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M22 7l-10 6L2 7"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  var USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  var GGL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.25 1.4-1.66 4.1-5.5 4.1A6.2 6.2 0 0 1 12 5.8c1.77 0 2.96.75 3.64 1.4l2.67-2.57C16.65 3.1 14.55 2.2 12 2.2A9.8 9.8 0 1 0 12 21.8c5.66 0 9.4-3.98 9.4-9.58 0-.65-.07-1.15-.16-1.64z"/></svg>';
  var ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12.572L12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.566"/></svg>';
  var ICON_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>';

  /* ============================================================
   * 1. ACCOUNT PAGE (/p/account.html)
   * ============================================================ */
  function field(label, type, id, icon, autocomplete) {
    var lab = el("label", null, esc(label));
    lab.setAttribute("for", id);
    var ipt = el("span", "bkIpt");
    if (icon) ipt.innerHTML = icon;
    var input = el("input");
    input.type = type; input.id = id; input.required = true;
    if (autocomplete) input.autocomplete = autocomplete;
    if (type === "email") input.dir = "ltr";
    ipt.appendChild(input);
    return { lab: lab, ipt: ipt, input: input };
  }
  function notice() {
    var n = el("p", "bkAcctN");
    n.setAttribute("role", "alert");
    return n;
  }
  function show(n, msg, ok) {
    n.textContent = msg || "";
    n.classList.add("v");
    n.classList.toggle("ok", !!ok);
  }

  function renderAccountPage() {
    if (!pageRoot) return;
    pageRoot.innerHTML = "";
    var card = el("div", "bkAcctP");

    var hd = el("div", "hd");
    hd.innerHTML = '<span class="lg">' + USER + '</span>';
    var h2 = el("h2"); h2.textContent = user ? T.acctPage || "حسابي" : "تسجيل الدخول";
    var sub = el("p");
    hd.appendChild(h2); hd.appendChild(sub);
    card.appendChild(hd);

    var tabs = el("div", "bkAcctT");
    var tabLogin = el("button"); tabLogin.type = "button"; tabLogin.textContent = "تسجيل الدخول";
    var tabReg = el("button"); tabReg.type = "button"; tabReg.textContent = "إنشاء حساب جديد";
    tabs.appendChild(tabLogin); tabs.appendChild(tabReg);

    var form = el("form", "bkAcctF");
    var n = notice();
    card.appendChild(tabs);
    card.appendChild(n);
    card.appendChild(form);

    var mode = "login";
    var name = field("الاسم الكامل (للحساب الجديد)", "text", "bkName", USER, "name");
    var email = field("البريد الإلكتروني", "email", "bkEmail", MAIL, "email");
    var pass = field("كلمة المرور", "password", "bkPass", LOCK, "current-password");
    var pass2 = field("تأكيد كلمة المرور", "password", "bkPass2", LOCK, "new-password");

    var submit = el("button", "sub"); submit.type = "submit";
    var forgot = el("button", "lnk"); forgot.type = "button"; forgot.textContent = "نسيت كلمة المرور؟";
    var or = el("div", "bkAcctO"); or.textContent = "أو";
    var ggl = el("button", "bkAcctG"); ggl.type = "button"; ggl.innerHTML = GGL + "<span>المتابعة باستخدام Google</span>";

    function buildLogin() {
      mode = "login";
      tabs.classList.remove("v");
      tabLogin.classList.add("on"); tabReg.classList.remove("on");
      form.innerHTML = "";
      n.className = "bkAcctN";
      h2.textContent = "تسجيل الدخول"; sub.textContent = "أدخل بريدك وكلمة المرور للمتابعة";
      form.appendChild(email.lab); form.appendChild(email.ipt);
      form.appendChild(pass.lab); form.appendChild(pass.ipt);
      form.appendChild(forgot);
      submit.textContent = "تسجيل الدخول";
      form.appendChild(submit);
      form.appendChild(or); form.appendChild(ggl);
      pass.input.autocomplete = "current-password";
    }
    function buildRegister() {
      mode = "register";
      tabReg.classList.add("on"); tabLogin.classList.remove("on");
      form.innerHTML = "";
      n.className = "bkAcctN";
      h2.textContent = "إنشاء حساب جديد"; sub.textContent = "حساب واحد يزامن مفضلتك وتقييماتك";
      form.appendChild(name.lab); form.appendChild(name.ipt);
      form.appendChild(email.lab); form.appendChild(email.ipt);
      form.appendChild(pass.lab); form.appendChild(pass.ipt);
      form.appendChild(pass2.lab); form.appendChild(pass2.ipt);
      submit.textContent = "إنشاء الحساب";
      form.appendChild(submit);
      form.appendChild(or); form.appendChild(ggl);
      pass.input.autocomplete = "new-password";
    }
    function buildForgot() {
      mode = "forgot";
      tabLogin.classList.remove("on"); tabReg.classList.remove("on");
      form.innerHTML = "";
      n.className = "bkAcctN";
      h2.textContent = "استعادة كلمة المرور"; sub.textContent = "سنرسل لك رابط إعادة التعيين";
      form.appendChild(email.lab); form.appendChild(email.ipt);
      submit.textContent = "إرسال رابط إعادة التعيين";
      form.appendChild(submit);
      var back = el("button", "lnk"); back.type = "button"; back.textContent = "العودة لتسجيل الدخول";
      back.addEventListener("click", buildLogin);
      form.appendChild(back);
    }
    tabLogin.addEventListener("click", buildLogin);
    tabReg.addEventListener("click", buildRegister);
    forgot.addEventListener("click", buildForgot);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy || !fb) { if (!fb) show(n, "نظام الحسابات غير مُعدّ بعد — راجع دليل إعداد Firebase"); return; }
      n.className = "bkAcctN";
      var em = email.input.value.trim(), pw = pass.input.value;
      if (mode === "forgot") {
        if (!em) return show(n, "أدخل بريدك الإلكتروني أولاً");
        busy = true; submit.disabled = true;
        fb.authApi.sendPasswordResetEmail(fb.auth, em).then(function () {
          busy = false; submit.disabled = false;
          show(n, "تم إرسال رابط إعادة التعيين إلى بريدك", true);
        }).catch(function (e) { busy = false; submit.disabled = false; show(n, errText(e && e.code)); });
        return;
      }
      if (!em || !pw) return show(n, "أكمل جميع الحقول المطلوبة");
      if (mode === "register") {
        if (pw !== pass2.input.value) return show(n, "كلمتا المرور غير متطابقتين");
        busy = true; submit.disabled = true;
        fb.authApi.createUserWithEmailAndPassword(fb.auth, em, pw).then(function (cred) {
          if (name.input.value.trim() && cred.user) {
            return fb.authApi.updateProfile(cred.user, { displayName: name.input.value.trim() }).then(function () { redirectBack(); });
          }
          redirectBack();
        }).catch(function (e) { busy = false; submit.disabled = false; show(n, errText(e && e.code)); });
      } else {
        busy = true; submit.disabled = true;
        fb.authApi.signInWithEmailAndPassword(fb.auth, em, pw).then(function () {
          redirectBack();
        }).catch(function (e) { busy = false; submit.disabled = false; show(n, errText(e && e.code)); });
      }
    });
    ggl.addEventListener("click", function () {
      if (busy || !fb) { if (!fb) show(n, "نظام الحسابات غير مُعدّ بعد — راجع دليل إعداد Firebase"); return; }
      busy = true;
      var prov = new fb.authApi.GoogleAuthProvider();
      fb.authApi.signInWithPopup(fb.auth, prov).then(function () { redirectBack(); })
        .catch(function (e) { busy = false; show(n, errText(e && e.code)); });
    });

    pageRoot.appendChild(card);

    /* member view replaces the tabs entirely */
    function renderMember() {
      tabs.style.display = "none";
      form.style.display = "none";
      or.style.display = "none"; ggl.style.display = "none";
      n.className = "bkAcctN";
      h2.textContent = "مرحباً بك";
      sub.textContent = "أنت مسجّل الدخول";
      var u = el("div", "bkAcctU");
      var av = el("span", "bkAva"); av.textContent = avatarLetter(user);
      var nm = el("span", "nm"); nm.textContent = user.displayName || (user.email || "").split("@")[0];
      var em = el("span", "em"); em.textContent = user.email || "";
      var acts = el("div", "acts");
      var favs = el("a", "pf"); favs.href = "#"; favs.innerHTML = ICON_HEART + "<span>" + esc(T.acctFavs || "المفضلة") + "</span>";
      favs.addEventListener("click", function (ev) {
        ev.preventDefault();
        BK.load("favorites").then(function () {
          if (w.BK_MOD.favorites) w.BK_MOD.favorites.open();
        }).catch(function () {});
      });
      var out = el("button", "ou"); out.type = "button"; out.innerHTML = ICON_OUT + "<span>تسجيل الخروج</span>";
      out.addEventListener("click", logout);
      acts.appendChild(favs); acts.appendChild(out);
      u.appendChild(av); u.appendChild(nm); u.appendChild(em);
      u.appendChild(acts);
      card.appendChild(u);
    }

    /* state */
    if (!fbCfg.apiKey || !fbCfg.projectId) {
      tabs.style.display = "none";
      form.style.display = "none";
      show(n, "نظام الحسابات غير مُفعّل على هذا الموقع بعد. يحتاج صاحب الموقع إلى إدخال إعدادات Firebase في BOOK_SYSTEM_CONFIG داخل القالب.");
      return;
    }
    if (user) renderMember(); else buildLogin();
  }

  /* ============================================================
   * 2. HEADER STATE
   *    The member menu is appended to <body> and positioned with
   *    getBoundingClientRect, so no header overflow/z-index rule can
   *    ever clip it (v3.1 fix : the logout window now ALWAYS shows).
   * ============================================================ */
  var MENU_W = 240;
  function closeUserMenus() {
    var m = d.getElementById("bkUserMenu");
    if (m) m.remove();
    Array.prototype.forEach.call(d.querySelectorAll(".bkMenu"), function (m2) { if (m2.id !== "bkUserMenu") m2.remove(); });
    var b = d.getElementById("bkAcctBtn");
    if (b) b.setAttribute("aria-expanded", "false");
  }
  function positionMenu(menu, btn) {
    var r = btn.getBoundingClientRect();
    var dir = (getComputedStyle(d.documentElement).direction || "ltr").toLowerCase();
    var x = dir === "rtl" ? r.left : r.right - MENU_W;
    x = Math.max(8, Math.min(x, (w.innerWidth || 960) - MENU_W - 8));
    menu.style.left = Math.round(x) + "px";
    menu.style.top = Math.round(r.bottom + 10 + (w.scrollY || 0)) + "px";
  }
  function toggleMenu(btn, userOverride) {
    var u = userOverride || user;
    if (!btn || !u) return;
    var existing = d.getElementById("bkUserMenu");
    if (existing) { closeUserMenus(); return; }
    closeUserMenus();
    var menu = el("div", "bkMenu v");
    menu.id = "bkUserMenu";
    menu.setAttribute("role", "menu");
    var head = el("div", "uH");
    var nm = el("span", "uN"); nm.textContent = u.displayName || (u.email || "").split("@")[0];
    var em = el("span", "uE"); em.textContent = u.email || "";
    head.appendChild(nm); head.appendChild(em);
    menu.appendChild(head);

    var favs = el("button");
    favs.type = "button"; favs.setAttribute("role", "menuitem");
    favs.innerHTML = ICON_HEART + "<span>" + esc(T.acctFavs || T.myFavorites || "المفضلة") + "</span>";
    favs.addEventListener("click", function () {
      closeUserMenus();
      BK.load("favorites").then(function () {
        if (w.BK_MOD.favorites) w.BK_MOD.favorites.open();
      }).catch(function () {});
    });
    menu.appendChild(favs);

    var acct = el("a");
    acct.href = cfg.accountPage; acct.setAttribute("role", "menuitem");
    acct.innerHTML = USER + "<span>" + esc(T.acctPage || "الحساب") + "</span>";
    menu.appendChild(acct);

    var out = el("button");
    out.type = "button"; out.setAttribute("role", "menuitem");
    out.innerHTML = ICON_OUT + "<span>" + esc(T.logout) + "</span>";
    out.addEventListener("click", function () { closeUserMenus(); logout(); });
    menu.appendChild(out);

    d.body.appendChild(menu);
    positionMenu(menu, btn);
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-haspopup", "true");

    /* close : outside click / Escape / scroll / resize.
       Attached immediately (no setTimeout) — the button guard below makes
       the still-propagating opening click harmless. */
    function outside(ev) {
      if (!menu.contains(ev.target) && !btn.contains(ev.target)) closeUserMenus();
    }
    function onKey(ev) { if (ev.key === "Escape") closeUserMenus(); }
    function onMove() { closeUserMenus(); }
    d.addEventListener("click", outside);
    d.addEventListener("keydown", onKey);
    w.addEventListener("scroll", onMove, { passive: true });
    w.addEventListener("resize", onMove);
    menu._cleanup = function () {
      d.removeEventListener("click", outside);
      d.removeEventListener("keydown", onKey);
      w.removeEventListener("scroll", onMove);
      w.removeEventListener("resize", onMove);
    };
    /* hook cleanup into removal */
    (function (origRemove) {
      menu.remove = function () { if (menu._cleanup) menu._cleanup(); origRemove.call(menu); };
    })(menu.remove);
  }
  function renderAccount() {
    var btn = d.getElementById("bkAcctBtn");
    if (btn && !onAccountPage) {
      if (user) {
        btn.innerHTML = '<span class="bkAva">' + esc(avatarLetter(user)) + "</span>";
        btn.setAttribute("aria-label", "حسابي");
        btn.setAttribute("aria-haspopup", "true");
        btn.setAttribute("aria-expanded", "false");
        if (!btn.getAttribute("data-m")) {
          btn.setAttribute("data-m", "1");
          btn.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleMenu(btn);
          });
        }
      } else {
        btn.removeAttribute("data-m");
        closeUserMenus();
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
      }
    }
    var m = d.getElementById("bkAcctBtnM");
    if (m && user) m.setAttribute("aria-label", "حسابي — " + (user.displayName || user.email || ""));
  }

  /* --------------------------------------------------- logout */
  function logout() {
    if (!fb) return;
    fb.authApi.signOut(fb.auth).then(function () {
      toast("تم تسجيل الخروج");
      if (onAccountPage) location.reload();
    }).catch(function () {});
  }

  /* --------------------------------------------------- init */
  var fbLoader = (core && core.fb) || (w.BK && w.BK.fb);
  if (!fbLoader) {
    if (onAccountPage) renderAccountPage(); /* explains the missing setup */
    return;
  }
  fbLoader().then(function (shared) {
    fb = shared;
    fb.authApi.onAuthStateChanged(fb.auth, function (u) {
      user = u || null;
      renderAccount();
      if (onAccountPage) { pageRoot.innerHTML = ""; renderAccountPage(); }
      BK.emit("bk:auth-changed", user);
    });
    if (onAccountPage) renderAccountPage();
  }).catch(function (e) {
    /* Firebase not configured or failed : the account page explains it */
    if (onAccountPage) renderAccountPage();
    else if (w.console) console.info("BK auth:", e && e.message);
  });

  w.BK_MOD.auth = { logout: logout, user: function () { return user; }, renderPage: renderAccountPage, menu: toggleMenu };
})(window, document);
