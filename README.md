# Book Platform JS

External JavaScript modules for the **Plus UI v3.7 — Book Platform edition** Blogger template.
The template only ships a tiny inline bootstrap (`BOOK_SYSTEM_CONFIG`); every heavy feature
lives here and is lazy-loaded from jsDelivr only when needed.

```
your-book-platform-js/
├── dist/
│   ├── book-core.min.js     ← shared helpers + card enhancements      (every page, idle)
│   ├── auth.min.js          ← Firebase authentication                 (idle, if configured)
│   ├── favorites.min.js     ← favorites hearts + drawer + Firestore   (idle)
│   ├── authors.min.js       ← author directory + profile pages        (authors pages only)
│   └── reader.min.js        ← internal PDF reader                     (ONLY on "Read Book" click)
├── src/
│   ├── book-core.js
│   ├── auth.js
│   ├── favorites.js
│   ├── authors.js
│   └── reader.js
└── README.md
```

## Build

```bash
npm i -g terser          # once
cd src
for f in book-core auth favorites authors reader; do
  terser $f.js -c -m -o ../dist/$f.min.js
done
```

## Install on jsDelivr

1. Create a GitHub repository (e.g. `book-platform-js`), push the `dist/` folder to the `main` branch.
2. jsDelivr serves it automatically:

```
https://cdn.jsdelivr.net/gh/USERNAME/book-platform-js@main/dist/book-core.min.js
```

3. Put that base URL inside the Blogger template, in the `BOOK_SYSTEM_CONFIG` block:

```js
cdnBase: "https://cdn.jsdelivr.net/gh/USERNAME/book-platform-js@main/dist/",
```

4. Bump `version` in `BOOK_SYSTEM_CONFIG` after each deploy (`?v=` cache-buster).
   You can also pin an exact release instead of `@main` (`@1.0.0`).

## Loading behaviour

| Module        | When it loads                                   | If it fails                       |
|---------------|--------------------------------------------------|-----------------------------------|
| book-core     | after page load (idle) on every non-AMP view     | cards still work, author lines stay hidden |
| favorites     | ~0.4 s after core                                | hearts stay hidden, core intact   |
| auth          | ~2.6 s after core (only if Firebase configured)  | account button stays hidden       |
| authors       | only on `/p/authors.html` or `author:` label pages | plain label page remains usable |
| reader        | **only when the visitor clicks “Read Book”**     | browser opens the PDF URL directly |
| PDF.js (CDN)  | inside the reader, on first open                 | falls back to Google Docs viewer → external link |

## Firebase setup

1. console.firebase.google.com → **Add project**.
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
3. **Authentication → Settings → Authorized domains**: add `yourblog.blogspot.com` (and the custom domain).
4. **Firestore Database → Create** (production mode) and paste these rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

5. **Project settings → General → Your apps → Web app** → copy the config object
   into `BOOK_SYSTEM_CONFIG.firebase` in the template (Web keys are public by design —
   never place server/service-account credentials in Blogger).

## Notes

- All modules are framework-free IIFEs; they talk through `window.BK` (config, loader, event bus)
  and `window.BK_MOD` (public APIs).
- Every module registers itself once and exits silently if its dependencies are missing.
