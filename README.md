# Book Platform JS — Plus UI v3.7 (Book Website Edition v3)

External JavaScript modules for the Plus UI v3.7 Blogger book platform.
The Blogger template loads these files lazily from a CDN (jsDelivr over
GitHub). If the CDN is unreachable the website still works — covers,
cards, author links, search, download links and the direct read link are
all server-rendered by the template.

---

## 1. Repository structure

```
book-platform-js/
├── src/                  ← readable source (edit here)
│   ├── book-core.js        navigation, author names, triggers, shared Firebase loader
│   ├── favorites.js        hearts + drawer + localStorage/Firestore sync
│   ├── auth.js             account page UI + header states (Firebase Auth)
│   ├── ratings.js          real user ratings (Firestore, aggregation)
│   ├── authors.js          authors directory + author label profile
│   └── reader.js           internal PDF reader (PDF.js → gdocs → fallback)
├── dist/                 ← minified production files (upload these)
│   ├── book-core.min.js  (5.7 KB)
│   ├── favorites.min.js  (5.3 KB)
│   ├── auth.min.js       (11 KB)
│   ├── ratings.min.js    (3 KB)
│   ├── authors.min.js    (3.6 KB)
│   └── reader.min.js     (6.8 KB)
├── docs/
│   └── account-page.html   content for the /p/account.html Blogger page
├── firestore.rules       ← paste in Firebase Console → Firestore → Rules
└── README.md
```

**Which files go where** : edit files in `src/`, deploy files from `dist/`.
The template loads ONLY the `dist/*.min.js` files — never the `src/` files.

## 2. Build (only needed after editing src/)

```bash
npx terser src/book-core.js -c -m -o dist/book-core.min.js
npx terser src/favorites.js -c -m -o dist/favorites.min.js
npx terser src/auth.js      -c -m -o dist/auth.min.js
npx terser src/ratings.js   -c -m -o dist/ratings.min.js
npx terser src/authors.js   -c -m -o dist/authors.min.js
npx terser src/reader.js    -c -m -o dist/reader.min.js
```

## 3. Publishing + CDN URLs

1. Create a **public** GitHub repository named `book-platform-js`.
2. Upload the contents of this folder (`src/` optional, `dist/` required).
3. jsDelivr URL format :

```
https://cdn.jsdelivr.net/gh/USERNAME/book-platform-js@main/dist/book-core.min.js
```

4. Paste your base URL into the template (`BOOK_SYSTEM_CONFIG`) :

```js
cdnBase: "https://cdn.jsdelivr.net/gh/USERNAME/book-platform-js@main/dist/",
```

**Versioned releases (recommended for production).** Create a GitHub
release `v3.0.0`, then use `@v3.0.0` instead of `@main` so your live site
never changes until you decide to update it :

```js
cdnBase: "https://cdn.jsdelivr.net/gh/USERNAME/book-platform-js@v3.0.0/dist/",
version: "3.0.0",
```

## 4. Loading matrix (what loads where — always lazy)

| Module         | When it loads                                                  |
|----------------|----------------------------------------------------------------|
| `book-core`    | every page, after idle (tiny, required for navigation)          |
| `favorites`    | every page, after idle (cover hearts)                           |
| `auth`         | every page **only if Firebase is configured**; always on `/p/account.html` |
| `ratings`      | book pages only, **never on the homepage**                      |
| `authors`      | authors directory + author label pages only                     |
| `reader`       | only when the visitor clicks «اقرأ الكتاب»                      |

The Firebase modular SDK is imported **once** (dynamic `import()` from
gstatic) through `book-core`'s shared `BK.fb()` — auth, ratings and
favorites all reuse the same instance. No duplicate initialization.

Feature switches live in the template config :
`features: { core, favorites, auth, reader, authors, ratings, account }`.

## 5. Firebase setup (summary — full Arabic walkthrough in the guide)

1. console.firebase.google.com → Add project.
2. Build → **Authentication** → Get started → enable **Email/Password**
   and (optionally) **Google**.
3. Build → **Firestore Database** → Create database (production mode).
4. Project settings → Your apps → Web app → copy the **web config**
   (`apiKey`, `authDomain`, `projectId`, `appId`) into the template's
   `firebase: { ... }` block. **Web config keys are public by design.**
   Never place service-account / server credentials in the template or
   in this repository.
5. Authentication → Settings → Authorized domains → add your blog domain.
6. Firestore → Rules → paste `firestore.rules` → Publish.

### Firestore data model

```
users/{uid}/favorites/books          { items: [ {id,title,url,cover,author} ] }
books/{postId}/ratings/{uid}         { r: 1..5, t: serverTimestamp }
```

- The book key is the **Blogger post id** (`window.BK_BOOK.id`), never the title.
- One rating document per user per book → changing your rating overwrites
  your own document; nobody can rate twice.
- Averages = `sum(r)/count` computed with Firestore **aggregation queries**
  from the real records. There is no aggregate field, so visitors cannot
  corrupt statistics and no fake default rating is ever displayed.
- If aggregation is unavailable in an environment, the module falls back
  to reading up to 200 real rating documents and computing locally.
- At very large scale you *may* move aggregation to a scheduled Cloud
  Function, but it is **not required** for the current design.

## 6. Author convention

The author of a book is the label `مؤلف: Author Name` (the older
`author:` prefix is still recognised). Everything else is automatic :

- Cards + book pages render the author as a **server-rendered link**
  to `/search/label/مؤلف:...` (works without JavaScript).
- The directory page (`/p/authors.html`, container `<div id="bk-authors-app">`)
  lists all authors with real book counts from the blog labels.
- Optional biography per author inside the template config :

```js
authorBios: { "مؤلف: نجيب محفوظ": "أديب مصري حاصل على نوبل للآداب." }
```
