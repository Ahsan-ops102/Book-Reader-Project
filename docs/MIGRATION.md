# Migration and deployment checklist

## Before starting the new backend

1. Stop writes on the existing installation. Back up the database and **all** R2 objects, including document originals. Verify the backup in isolation. Save the old release and dependency locks so application rollback is possible.
2. Save existing `.env` files privately. Never commit them. Keep existing Turso/R2/Gemini credentials; do not substitute the example local database configuration into production.
3. Review the new environment names. `JWT_SECRET` must contain at least 32 bytes and must be random. There is no fallback secret and `APP_PASSWORD` no longer controls access. Existing users keep their password hashes; they must sign in again because new tokens reference revocable server sessions.
4. Use `REGISTRATION_MODE=invite` and a strong `INVITE_CODE` for a private hosted deployment. `open` intentionally permits anyone to register. Changing the invite code does not remove existing users.
5. For cloud storage set `STORAGE_DRIVER=r2`, all four R2 settings, and the existing `libsql://` database URL/auth token. Keep the R2 bucket private. Use `HOST=0.0.0.0` when a container or hosting platform requires it. Configure `PORT` and exact `ALLOWED_ORIGINS`; wildcard origins are rejected. Set `TRUST_PROXY_HOPS` only for a trusted proxy topology.
6. Install from the new lockfiles, run the tests, and build the frontend with its production API origin. Deploy frontend and backend together: new saves require revision numbers, so old clients are incompatible.

## Database changes

The new backend applies additive table/column/index migrations on startup. It preserves existing rows and object keys; it does not regenerate PDFs or overwrite original DOCX files during migration. Test this against a **copy** of your current schema first. Run the first migration with one backend instance, then start other instances only after it succeeds.

New metadata includes cover provenance, reading status, finish dates, file hashes/sizes, trash timestamps, revision numbers, and tables for annotations, sessions, indexed pages, versions and shares.

- Books/documents without `user_id` remain unassigned. The app does **not** give orphaned private files to the next person who registers. An administrator must audit ownership and explicitly assign those rows before they become visible. Never guess an owner.
- Legacy file sizes/hashes begin at zero/null because migration does not download every cloud object. Quota reporting and deduplication are complete for new uploads. An optional audited administrator backfill is needed for historical sizes/hashes.
- Existing covers are not bulk regenerated automatically. The **Fill missing PDF covers** action extracts first pages on demand. Use published lookup per book when the publisher's cover is missing from the PDF.
- Existing device bookmarks/highlights/flashcards are imported only when that signed-in user successfully accesses the same book and its cloud annotations are empty. Open the new app at the same origin/browser to access old local storage. Legacy highlights have no saved coordinates; their quoted text remains available in notes, but their original PDF positioning cannot be recovered automatically.
- Old local reading timers do not become historical activity records. New statistics begin with measured sessions. Completion dates are recorded on explicit status updates; past completion dates are not fabricated.

## Cloud preflight

Before opening the upgraded app to real users, check against a staging database and bucket:

- Sign-in and logout; a revoked token is rejected.
- Upload a representative small/large PDF and EPUB; read several page ranges through the production proxy. Check 206 responses and `Content-Range`.
- Extract/upload a cover, then replace it with a published reference.
- Import a real DOCX, save, reopen, export and restore a prior version.
- Test two devices editing the same notes/document and verify the conflict/recovery workflow.
- Test representative Gemini questions, page-range summaries, OCR and optional art with your selected models. Set provider spending limits. Mocked tests do not establish live model quality or billing.
- Download a book, allow the production service worker to install, and test offline reload in the existing signed-in tab. Confirm sign-out and browser site-data handling on shared devices.
- Check mobile browsers and a keyboard/screen reader with representative documents.

## Operational safeguards

Use HTTPS, a private bucket, least-privilege provider credentials, database/object backups and disk/storage monitoring. The API has lightweight `/api/health` and authenticated `/api/health/services` checks. Add alerts at your hosting provider; none are provisioned by this repository.

Rate limits and AI concurrency are in-memory and apply per API instance. For multiple instances, replace them with shared Redis/database counters and durable jobs. Uploads spool to temporary disk and then use bounded buffers; they are **not** resumable/direct-to-R2 uploads. Keep default limits until capacity testing is complete. Concurrent requests can temporarily exceed the soft quota estimate; enforce hard infrastructure budgets separately.

Versions retain previous content and count toward document storage. Purging trash permanently removes originals and versions. A database transaction cannot be atomic with R2 object deletion, so partial infrastructure failures during permanent deletion may require an administrator retry/repair. Keep backups before purging valuable data.

Back up Turso using its provider snapshot/export facilities and independently retain all referenced R2 objects. Keep backups encrypted with restricted access and retention rules. To roll back after the new app has accepted writes, restore a matching database/object backup, or migrate those new writes deliberately; simply reverting source code is not a data rollback.

## Hosting headers

Serve the frontend with `X-Content-Type-Options: nosniff`, a no-referrer policy and `X-Frame-Options: DENY` (the supplied Vercel config includes these). Apply a deployment-specific Content Security Policy allowing only your API, selected cover providers, required blob workers and optional audio sources. Rich text requires inline styles. Do not use a generic policy without checking PDF workers and your actual API origin.

Service-worker updates activate after old tabs are closed. Save/export unsynced drafts before closing tabs during an upgrade. The worker validates the cached HTML against its asset manifest, so deployments should publish HTML, assets and the worker together; keep older assets available during rollout.
