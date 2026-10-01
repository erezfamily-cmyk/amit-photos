# PayPal reactivation gate — 1.10.2026

## Decision

Do **not** reconnect PayPal to production yet.

The current business-model phase is acquisition and demand validation. Production payments stay disabled while the 7-day Acquisition Experiment 01 runs.

Gelato is explicitly out of scope.

## Why PayPal stays off now

1. The current sample is still small. Turning checkout on now would change the funnel while we are trying to measure which offer creates demand.
2. Digital Licensing and B2B were only just deployed; we first need a clean measurement window.
3. The existing global `PAYMENTS_ENABLED` switch also protects legacy print/Gelato payment handlers. Simply flipping it to `true` would be too broad for a digital-only launch.
4. PayPal PR #76 is based on an older main branch and must be rebuilt/reviewed before any production activation.
5. A production payment launch should test willingness-to-pay only after we have evidence that qualified users are reaching the licensing offer.

## Earliest decision point

The first PayPal production decision is after:

- live smoke verification passes;
- Acquisition Experiment 01 has collected 7 full days of clean UTM-tagged traffic;
- the first business checkpoint is reviewed around **10.10.2026**.

This is a decision point, not an automatic activation date.

## Digital-only activation criteria

A limited PayPal launch may proceed only if all of the following are true:

### Demand
- `/licensing/` receives at least 20 qualified sessions in the experiment window; and
- there are at least 3 genuine digital purchase-intent actions, **or** digital purchase intent is at least 10% of qualified licensing sessions; and
- digital intent is not clearly weaker than the other monetization paths being tested.

These are canary-launch thresholds, not proof that digital licensing is the final business model.

### Measurement
- UTM/source attribution is working.
- `licensing_personal_interest` is visible in the weekly report.
- no PII is sent to GA.
- the 7-day experiment is not being changed mid-window.

### Technical/security
- PR #76 is replaced/rebased from current `main`.
- PayPal Orders v2 remains digital-only.
- Sandbox create → approve → capture → download is re-run successfully on the current code.
- cancel path is verified.
- real Sandbox webhook verification/dedup is re-run.
- D1 migration is verified against the intended production DB before activation.
- server-side price authority is preserved.
- idempotency and duplicate capture protection are verified.
- rollback/kill-switch procedure is tested.

## Required flag design before production

Do **not** reactivate payments by changing only:

```toml
PAYMENTS_ENABLED = "true"
```

The current global flag also opens legacy print payment paths.

Before production PayPal is enabled, introduce a **digital-only payment flag**, for example:

```toml
PAYMENTS_ENABLED = "false"
DIGITAL_PAYPAL_ENABLED = "false"
```

The Orders v2 digital endpoints and digital purchase UI should use the digital flag. Legacy print/Gelato payment handlers stay hard-disabled.

Only after the digital canary is stable should we consider simplifying the flags.

## Rollout sequence

1. Keep all production payments off during the acquisition experiment.
2. Review data around 10.10.
3. If demand criteria are not met: keep PayPal off and continue acquisition/offer work.
4. If demand criteria are met: rebuild PR #76 from current main and complete the digital-only flag separation.
5. Run Sandbox E2E/security checks again.
6. Deploy code with `DIGITAL_PAYPAL_ENABLED=false`.
7. Verify production routes fail closed.
8. Enable digital PayPal for a limited canary only.
9. Monitor capture success, fulfillment, support issues and revenue verification.
10. Expand only if the canary is stable.

## Gelato

No Gelato integration, print checkout, supplier selection or fulfillment automation is part of this PayPal reactivation plan.
