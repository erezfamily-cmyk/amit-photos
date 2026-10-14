# Production D1 backup before migrations 0002/0003: protected storage options (14.10.2026)

**Status: PLAN CHOSEN by the owner on 14.10.2026 (Time Travel bookmark + table-scoped export, age-encrypted, retention 14 days); this is the choice of a plan only — NO export has been made.** The text below keeps the options for the record. **Original status: options only. No export was made, no bucket, key or token was created, nothing was read from production for this document.** The owner has not approved exporting production data. Companion to `docs/production-migrations-0002-0003-execution-plan-2026-10-14.md` section 4.

## 1. What a backup has to protect against, and what is already covered
The migrations are additive and touch only `paypal_orders`, `paypal_webhook_events`, `download_tokens` (new columns) and add new tables/indexes. The dress rehearsal (14.10) showed that a failed run leaves nothing behind and that the rollback files and a Time Travel restore both work. So the backup is insurance against an unforeseen problem, not part of the happy path.

| Layer | Covers | Cost / risk |
|---|---|---|
| **A. Time Travel bookmark** (always) | The whole database back to the bookmark. Nothing leaves Cloudflare. | Free. Restore replaces the entire database and loses every later write; retention depends on the plan (I did not verify the figure: read it from `time-travel info` and record it). |
| **B. Table-scoped export** (recommended extra) | Exactly the data the migrations can touch: `paypal_orders`, `paypal_webhook_events`, `download_tokens` (8 legacy rows, bearer links), plus a **schema-only** export of the whole database (`--no-data`). | Small, low sensitivity (no subscribers, sessions or settings). `wrangler d1 export --table …` and `--no-data` exist in the pinned wrangler 4.149.0. |
| **C. Full export** (owner decision, not recommended by default) | Everything, including subscribers' e-mail addresses, admin sessions, `settings` (which can hold credentials such as the `admin_password` fallback that the login code reads, and social-network tokens) and `download_tokens`. | Secret-grade personal data. Only if the owner wants a copy that survives a Cloudflare-side loss; then treat it as a secret store. |

**Recommendation:** A + B. Take C only if you want an off-Cloudflare copy of the whole site database for its own sake, with the controls below.

## 2. Protected storage options for B (and C)
| Option | Where it lives | Encryption / access | Retention and deletion | Notes |
|---|---|---|---|---|
| **1. Encrypted file on the owner's machine** (simplest) | A folder outside the repository on an encrypted disk | Encrypt with `age` to a public key; the private key is kept by the owner in the password manager (the pattern already used for other backups of the owner); the plaintext export file is deleted (overwritten) right after encryption | Owner deletes the encrypted file at the end of the retention period | No cloud permissions needed beyond the export itself. Single machine = single point of loss. |
| **2. Private R2 bucket** | A new bucket used only for this, no public access, no custom domain, `r2.dev` disabled | Client-side `age` encryption before upload (the bucket then holds ciphertext only); access by a scoped token | Bucket **lifecycle rule** deletes objects after the retention period (below); the owner verifies deletion by listing the bucket | Off-machine copy. Needs one scoped API token (see section 3). |
| **3. Both** | 1 + 2 | as above | as above | Overkill for table-scoped data; reasonable for C. |

Not recommended: committing the export (even encrypted) to the Git repository, leaving the plaintext on disk, printing it into any terminal log, PR, HANDOFF or chat, or using the existing public photos bucket.

## 3. Permissions (least privilege)
- **Today:** the local `wrangler` login carries very broad scopes (the account's whole API surface). It should not be the credential for a backup operation.
- **Proposed:** a dedicated **API token created for this operation only**, with an expiry (for example 24 hours) and these permissions: D1 **read** (export) restricted to the single database `amit-photos-db`; and, for option 2, R2 **object write** restricted to the one backup bucket. No account-wide, no D1 write, no Workers permissions. Created by the owner in the Cloudflare dashboard, handed to the terminal through a hidden prompt or environment variable, never pasted into chat or a file, revoked right after the operation (verify in the token list).
- The export itself is a read, but D1 may make the database unavailable to queries while it runs; for a database of about 3.4 MB that is seconds. Run it in the quiet window of the plan (P7).

## 4. Retention and deletion time
- Contents of B are low sensitivity but still contain bearer download links: keep for **14 days after the migrations are verified** (that covers the observation period and the code deploy that follows), then delete.
- Contents of C (if taken): keep for **7 days** and no longer than the observation period; delete earlier if the migrations are verified and the code deploy is done.
- Implementation: lifecycle rule on the bucket for option 2 (expiry 14 or 7 days); a calendar reminder and a written deletion check for option 1.
- **Deletion check** (recorded in HANDOFF): the bucket listing is empty (or the file is gone from disk and the recycle bin), the temporary token is revoked, any plaintext copy is gone. Time Travel bookmarks need no cleanup.

## 5. How to prove the backup can be restored (without touching production)
1. Decrypt locally with the private key (owner), into an empty directory outside the repository.
2. Create a temporary isolated D1 (name never reused; the harness `staging/d1-dress-rehearsal-2026-10-14/dress.mjs` already guards the production and Sandbox ids).
3. Load the schema-only export, then the data export (`wrangler d1 execute <temp> --remote --file …`).
4. Compare with the pre-migration snapshot taken in the plan (P4/P5): same object list, same row counts for the exported tables, same data checksum over the original columns, and `PRAGMA integrity_check` returns `ok`.
5. Delete the temporary D1, the decrypted file and the temporary token; confirm `d1 list` shows only production and Sandbox.
Pass = counts and checksums equal. Until a restore test passes, the export counts as "taken", not as "verified".

## 6. Decisions for the owner (nothing is done until you answer)
1. A + B (recommended), A only, or A + C?
2. Storage: local encrypted file, private R2 bucket, or both; where the `age` private key lives (a new key pair for this project is cleaner than reusing another project's).
3. Approve creating a short-lived scoped API token (and the R2 bucket if chosen) at execution time.
4. Retention: 14 days (B) / 7 days (C), or other.

## 7. Chosen plan (owner, 14.10.2026): plan selection only, nothing executed
- **Layers:** A (Time Travel bookmark before each migration, with timestamp) + B (table-scoped export: `paypal_orders`, `paypal_webhook_events`, `download_tokens` with data, plus a whole-database **schema-only** export). No full export (C).
- **Encryption:** `age`, public-key encryption; plaintext never leaves the operator's temporary folder and is overwritten right after encryption.
- **Retention:** **14 days** from the verified migrations, then deletion with a recorded deletion check (section 4).
- **Still to decide at execution time (not yet chosen):** storage location (local encrypted file, private R2 bucket with a 14-day lifecycle rule, or both) and who holds the `age` private key; approval to create a short-lived scoped token (and the bucket if R2). These need the owner's go at execution time together with the go for the migrations; no export, key, token or bucket is created before that.
- **Proof of restorability** (section 5) stays part of the plan: decrypt, load into a temporary isolated D1, compare counts and checksums, `PRAGMA integrity_check`, delete.
