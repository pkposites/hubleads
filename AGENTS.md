<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lead Hub project notes

- Product: a landing page script (`public/tracker.js`) sends visits and WhatsApp
  clicks to `/api/collect`; each click becomes a row in a spreadsheet-style panel
  where the attendant fills in the phone. There is no phone capture on the page.
- Commands: `npm run lint`, `npm run typecheck`, `npm test` (unit, incl. the
  tracker under jsdom), `npm run test:db` (needs `TEST_DATABASE_URL`, see README),
  `npm run build`.
- Database objects live in `public` with an `lh_` prefix (the Supabase project is
  shared with other apps). Tables have RLS on and no policies; API roles only call
  the `lh_*` functions, which check a page key or a session token. Helpers go in
  `lh_private`. Schema changes go in a new file under `supabase/migrations/`; never
  edit an applied migration.
- The app uses only the publishable key, through `call()` in `src/lib/db.ts`.
  Server-only functions (`lh_server_*`: push targets, Meta token) also need
  `LH_SERVER_SECRET` (`src/lib/server.ts`); never call them from client code.
- Never log names, phones, codes or raw payloads.
- Secrets saved in the database (the Meta token) are encrypted by the app with
  `encryptSecret` (`src/lib/crypto.ts`, key `LH_ENCRYPTION_KEY`); the database
  rejects plain values. Security/LGPD status and plan: `docs/SEGURANCA-LGPD.md`.
- UI copy is in Brazilian Portuguese.
