# D1 rehearsal harness for migration 0003 (13.10.2026)

Evidence only; **not** used by the app or CI. It was run once against a throwaway D1
(`amit-migration-0003-rehearsal-20261013`, id hard-coded in `d1lib.mjs`) that has since
been deleted. `d1lib.mjs` refuses the production and Sandbox database ids and checks the
database name before running. It borrows the local `wrangler auth token` in memory only.

Order: `pre0002.sql` -> real `migrations/0002_*.sql` -> `seed.sql` (synthetic) ->
`wrangler d1 execute --remote --yes --file` for failure/clean/re-run/rollback ->
`REPO=<checkout> node behaviour.mjs` (the real handlers against real D1; PayPal stubbed with fake ids).
Results: `docs/paypal-d1-migration-0003-plan-2026-10-13.md` section 6.
