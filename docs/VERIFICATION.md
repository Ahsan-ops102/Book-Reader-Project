# Implementation and verification

Checked on 2026-08-30 with Node 24.19.0 in an isolated local database/object store. No production database or bucket was used.

## Automated checks

- **15 backend integration tests passed:** registration validation; account isolation; ownership before document writes; empty saves; retained versions; stale and concurrent save rejection; reversible trash; PDF signatures and deduplication; byte ranges; invalid reading progress; private/versioned notes; invalid cover sources; retained DOCX originals; idempotent activity sessions; metadata-only shares; malformed note/goal rejection; page-range AI context with a mocked provider; completion timestamps; session revocation.
- **6 frontend tests passed:** removal of active HTML/dangerous URLs/remote images; supported rich-text preservation; safe PDF/plain-text escaping; embedded raster allowlist; DOCX round trip with heading, emphasis, hyperlinks, list, table and embedded PNG; safe XML output and link handling.
- **Production build passed** using Vite 6.4.3. Library, PDF reader and Writer are separate chunks. The PDF worker and document conversion modules are loaded separately from the entry point.
- Dependency audits reported **zero known vulnerabilities** in frontend and backend lockfiles at verification time. This is not a guarantee of security; rerun audits periodically.
- The local backup utility was exercised against synthetic SQLite/object data and the restored values/files were checked.
- The generated service worker was checked to include every production asset, including lazy reader/editor chunks.

## Browser checks

Using synthetic three-page PDF content and a local test account:

- Signed in and displayed the library.
- Extracted and displayed a page from the PDF as its cover.
- Opened the PDF, restored page position, searched for a literal `[` successfully, added a bookmark and saved a reading note.
- Created, edited, renamed, saved and reopened a writing document.
- Used find/replace, cleared the document with the keyboard, saved the empty result and checked the version list.
- Inspected the mobile library and reader at 390 × 844; neither produced page-level horizontal overflow. Toolbars scroll horizontally on small screens.
- Reloaded the production app with both local servers stopped: the cached library opened with its offline status, and the downloaded PDF remained readable at its saved page. Fixed static-asset cache matching for host-added `Vary: Origin` headers.
- No reader runtime errors appeared in the inspected browser error log before offline testing.

## Known limits / additional production work

- Turso/R2 and live Gemini/image-generation calls were not exercised with production credentials. Test your staging resources and model availability before deployment. AI quality, hallucinations and costs need representative evaluation beyond contract tests.
- Published cover lookup cannot guarantee the correct edition from title alone. It offers candidates for user confirmation; extracted first pages are not guaranteed to be the printed cover page.
- EPUB support is basic reflow with spine-derived sections and embedded raster images. DRM, complex fixed layouts, interactive EPUBs and complete internal-link/navigation semantics are not supported. EPUB cover extraction is not automatic; use a manual or published cover.
- OCR processes one requested page through Gemini. It saves recognized text for search/speech/AI; it does not rewrite the PDF or produce a fully selectable OCR text layer over scanned pages.
- Offline reading works in an already signed-in tab with downloaded content. It is not offline account creation or a full offline Writer database. Browser storage is not encrypted application storage and can be evicted.
- Document import/export preserves common editing structure, not every Word feature. Tracked changes, comments, headers/footers, footnotes, exact pagination, merged tables and complex embedded objects need a full document engine. PNG/JPEG images are embedded in exports; unsupported image formats may become placeholders. Original DOCX files remain in storage/version history.
- Notes use explicit conflict resolution; Writer offers copy/recovery and version restoration. There is no real-time collaborative editing or automatic semantic merging.
- Retrieval uses keywords over indexed pages, not embeddings. AI output is plain text; citations are clickable but still require verification.
- Time measurements require visible pages and recent interaction. They are activity estimates, not proof of attention. Annual completion counts use saved finish dates, not inferred history.
- No cloud deployment, scheduled backup service, monitoring alerts, email/password recovery provider, resumable direct uploads or shared multi-instance rate-limit service was provisioned. These require infrastructure decisions and production configuration.
- Legacy hash/size backfill and explicit orphan ownership assignment are administrator operations; see the migration guide. No cloud-wide migration job was run.

## Applied installation

The source and dependency lockfiles were applied to the Desktop project, dependencies were installed, and all 21 tests plus the production build passed there again. Existing provider credentials were retained. The local backend configuration was backed up and its weak/missing JWT secret was replaced with a generated secret. The backend was not started against the existing cloud database. No deployment or live-book cover backfill was performed.
