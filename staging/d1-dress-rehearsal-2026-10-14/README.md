# Dress rehearsal of production migrations 0002 + 0003 (14.10.2026)

Evidence tool, **not** used by the app or by CI. `dress.mjs` drives one isolated temporary D1 through: create, baseline
(pre-0002 production DDL pinned in `../d1-rehearsal-0003/pre0002.sql` + synthetic rows, production-like counts), 0002 (failure drill, clean run,
re-run, verification V2), 0003 (same, V3), behaviour (real handlers incl. recover-fulfillment and the dispute guards against the real D1, PayPal and mail stubbed),
rollback of both, Time Travel restore and undo, delete.
Safety: the database id comes from a local state file and is compared with the production and Sandbox ids before every call; wrangler is run from a
temporary directory whose config lists only the temporary database; the token comes from `wrangler auth token` in memory. Results:
`docs/production-migrations-0002-0003-execution-plan-2026-10-14.md` section 12.
