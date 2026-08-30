# The Reading Room

A private PDF/EPUB library and writing space. React + Vite frontend; Express backend with local SQLite/files or Turso + Cloudflare R2. Node 24 LTS recommended (minimum 22.13).

## What changed in version 2

- **Covers:** new PDF uploads use a page from the actual PDF. Fill missing PDF covers in an existing library, select a different page, upload an image, or choose a published cover using title/author/ISBN. Optional title-inspired Gemini art is explicitly labeled as generated. No automatic random image requests remain.
- **Library:** responsive grid/list, title/author/ISBN search, collections, favorites, reading status, batch upload, duplicate detection, continue-reading, recoverable trash, and expiring/revocable metadata-only share links.
- **Reader:** virtual PDF pages, fit width, mixed page sizing, literal text search, outline, thumbnails, bookmarks, positioned highlights, cloud notes, Markdown export, notes-to-Writer, speech controls, basic EPUB reflow, and offline downloads.
- **Study:** page-cited AI chat history, page-range/book summaries, explicit indexing/OCR, editable flashcards, scheduled reviews, measured reading time, and daily/annual goals.
- **Writer:** debounced saves including empty documents, local recovery, revision conflict protection, save-as-copy, version history, safe find/replace, reviewed AI suggestions, DOCX import/export and print.
- **Backend:** ownership checks before writes, revocable sessions, strong secret requirement, invite-based registration option, file validation, disk-spooled uploads, upload limits, quotas, ranged PDF responses, private storage and safe error responses.
- **Operations:** automated checks, dependency updates, a local backup tool, and a migration checklist.

See [implementation and verification details](docs/VERIFICATION.md) and [migration instructions](docs/MIGRATION.md) before replacing a running installation.

## Local setup

Use separate local test data first. **Do not copy a production `.env` into a test environment.**

1. Install dependencies: `npm ci --prefix backend` and `npm ci --prefix frontend`.
2. Copy `backend/.env.example` to `backend/.env`.
3. Generate a random JWT secret using the command in the example file and enter it into `JWT_SECRET`. Keep it private. The API intentionally refuses to start without it.
4. From `backend`, run `npm run dev`. The example config creates `backend/data/library.db` and stores objects in `backend/data/objects`.
5. From `frontend`, run `npm run dev`. Open `http://localhost:5173` and register a local test account with a password of at least 12 characters.
6. Gemini is optional. Add `GEMINI_API_KEY` only when you want to test AI calls. Check model availability and billing in your provider account.

`VITE_API_URL` can remain blank for local development; Vite proxies `/api` to port 3001. For separate frontend/API hosting, build with the real HTTPS API origin and add the frontend origin to the backend allowlist. This app is configured for hosting at `/`, not a subdirectory.

## Choosing authentic covers

1. New PDFs automatically extract the first page. In **Details & cover**, select a different page when the cover is elsewhere.
2. Use **Fill missing PDF covers** to update older books. It skips existing covers, processes sequentially, and can stop after the current book.
3. For the publisher's artwork, fill the correct **title, author and preferably ISBN**, then choose **Find published covers**. Review the edition before selecting a result. A title alone can match several different editions.
4. Upload an image when the book is unavailable in public catalogs.
5. Optional **Create original AI artwork** generates a new design inspired by the title and supplied subject. It cannot guarantee the authentic publisher cover. Exact title/author text is added by the app after artwork generation.

Extracted/uploaded/generated images are saved privately in the configured object store. Published cover URLs are stored as provider references and displayed directly. The lookup sends bibliographic details to Open Library and optionally Google Books; it does not send the PDF. Cover sources: [Open Library API](https://openlibrary.org/dev/docs/api/covers), [Google Books API](https://developers.google.com/books/docs/v1/using). Generated-art configuration: [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation).

## AI and privacy

AI runs only after a user action. Indexing stores extracted text in your account. Questions send selected text and relevant indexed pages to Gemini; summaries send the requested indexed pages. OCR sends the selected page image. Writing tools send selected text or the document text displayed in the review workflow. Generated art sends bibliographic information and the supplied description.

Text inside books is treated as source material, not instructions to the assistant. Page citations are model output and must be checked. Retrieval currently uses keyword matching, not a vector database. Summaries cover indexed text only (up to 400,000 characters per request); use page ranges for longer books. No API keys are embedded in frontend code. Do not index or send sensitive documents to a provider unless you accept that provider's terms.

## Offline and recovery

Explicitly download books using **Offline** or reader settings. The production service worker caches the application shell and lazy chunks; private API responses are never put in its cache. Offline books use account-scoped IndexedDB. Notes, pending positions and writing recovery drafts remain in account-scoped device storage.

Offline reading requires an already signed-in tab/session. A new session needs the server to sign in; it is not a separate offline authentication system. Browser storage can be cleared or evicted and is not an encrypted vault. Writer supports recovery of an open draft, but does not support fully offline creation of new cloud documents. Preferences can remove book downloads without discarding writing/notes recovery drafts. On a shared device, sign out and clear site data after exporting any unsynced work.

## Check and build

- `npm test --prefix backend`
- `npm test --prefix frontend`
- `npm run build --prefix frontend`
- `npm audit --prefix backend` and `npm audit --prefix frontend`

Production frontend files are emitted in `frontend/dist`. Cloud deployment, provider billing and actual cloud-book migration are separate from the local implementation checks. Nothing is deployed by these commands.

## Backups

For local storage, stop the API, then from `backend` run `npm run backup:local -- /absolute/new-backup-folder`. The folder must not already exist. It contains a database snapshot and object files; protect it as private data. Restore into a separate environment first and verify books, notes and document versions.

For Turso/R2, back up both services as described in [MIGRATION.md](docs/MIGRATION.md). The in-app notes/metadata export is useful for portability, but is not a complete backup of PDFs, DOCX originals or versioned files.
