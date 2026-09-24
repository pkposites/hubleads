<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lead Hub project notes

- Product spec: the Lead Hub blueprint (v1.0). Build in the order of its §16 plan.
- Commands: `npm run lint`, `npm run typecheck`, `npm test` (unit),
  `npm run test:db` (needs `TEST_DATABASE_URL`, see README), `npm run build`.
- Every business table has `workspace_id` and RLS. Add a cross-workspace test in
  `tests/db/` for any new table. Schema changes go in a new file under
  `supabase/migrations/`; never edit an applied migration.
- Stage changes, history and outbox rows are written only by SQL functions
  (`move_lead_stage`, `ingest_lead_conversion`), never by direct table writes.
- The service-role client (`src/lib/supabase/admin.ts`) bypasses RLS: scope every
  query to a workspace/project the caller was already authorised for.
- Never log phone, e-mail, tokens or raw payloads (§15.2).
- UI copy is in Brazilian Portuguese.
