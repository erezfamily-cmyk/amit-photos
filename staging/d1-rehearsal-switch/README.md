# D1 rehearsal of the checkout switch (14.10.2026)

Evidence only; not used by the app or CI. Run once against a throwaway isolated D1
(`amit-switch-test-20261014`, id hard-coded in `d1lib.mjs`) that has been deleted.
`d1lib.mjs` refuses the production and Sandbox database ids and checks the database name.
It borrows the local `wrangler auth token` in memory only. PayPal is a fake with fake ids; no
mail, no alerts, no real payment call.

Order: `base.sql` -> real `migrations/0002_*.sql` -> real `migrations/0003_*.sql` (all via
`wrangler d1 execute --remote --yes --file`), then `REPO=<checkout> node switch-d1.mjs`.
Results: `docs/checkout-switch-and-emergency-procedure-2026-10-14.md` section 6.
