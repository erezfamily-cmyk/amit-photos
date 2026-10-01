# Digital Licensing MVP — 1.10.2026

> Status: product definition + non-transactional public explainer.  
> Production payments remain disabled. This document does not authorize enabling checkout.

## Goal

Test whether visitors are willing to pay for digital use of Amit Photos images before adding more commerce complexity.

The MVP intentionally separates:

1. **Personal digital use** — can eventually use the existing digital checkout and the existing `small / medium / large` SKUs.
2. **Commercial use** — inquiry/quote only in MVP; no instant automated commercial license yet.

This preserves the current PayPal Orders v2 backend work in PR #76 and avoids changing the payment schema before there is demand evidence.

---

## Product model v1

### Personal-use digital license

One purchaser receives one image file for personal, non-commercial use.

The existing resolution SKUs remain the product variants:

| Existing SKU | Delivery | Existing test price |
|---|---:|---:|
| `small` | 1500px long edge | ₪19 |
| `medium` | 3000px long edge | ₪59 |
| `large` | largest available / current full-size rule | ₪129 |

These are **test prices, not a permanent pricing commitment**.

### Personal-use examples

Allowed in the MVP product definition:
- personal device wallpaper
- personal social profile/post
- personal website/blog that is not primarily commercial
- personal reference/use
- one-off personal home print from the purchased file

Not included:
- advertising or paid promotion
- business website/social account
- client work
- merchandise
- resale
- redistribution of the file
- stock/library redistribution
- templates, logos, branding assets
- NFT/tokenization
- sublicensing or transferring the license

The purchaser receives a license to use the image; copyright remains with Amit Erez.

### Commercial use

Commercial licensing is **not instant checkout in MVP**.

Examples that require a commercial quote:
- company website
- business social media
- advertising
- editorial/commercial publication
- office/hospitality display package
- client project
- packaging or merchandise
- campaigns or sponsored content

CTA: contact Amit Photos with image, intended use, duration/territory where relevant, and expected distribution.

This creates a B2B signal without prematurely building commercial-license pricing logic into PayPal.

---

## Why this shape

Current storefront and PR #76 already use `small / medium / large` as authoritative digital SKUs.

Changing checkout now to a full matrix of:

`license_type × resolution × territory × duration × channel`

would add unnecessary schema, UI, pricing and fulfillment complexity before we know whether commercial licensing has demand.

MVP therefore uses:

**Personal license + resolution SKU** for automated digital commerce, and  
**Commercial inquiry** for higher-value/complex usage.

---

## PayPal / backend compatibility

No change is required to PR #76 for the MVP definition.

Current Orders v2 design already stores:

- `order_type = digital`
- `photo_id`
- `sku = small | medium | large`
- server-authoritative amount/currency
- fulfillment token

For MVP, all automated digital purchases are interpreted as **personal-use licenses**.

Future commercial automation, if justified by data, should add an explicit license field rather than overloading `sku`.

Do not infer commercial rights from file resolution.

---

## Public UX v1

Create a bilingual `/licensing/` explainer page that:

- explains personal vs commercial use
- shows the three existing personal-use file variants
- states that checkout is temporarily unavailable while payment security is being upgraded
- provides a commercial-use contact CTA
- does not expose PayPal credentials or payment controls
- does not imply that Gelato is part of digital licensing
- is mobile-first and accessible

Do **not** add it to the primary nav yet. First review copy and UX.

---

## Analytics

No PII.

Recommended events:

- normal GA page view for `/licensing/`
- `licensing_personal_interest` — click from licensing page toward gallery/personal images
- `licensing_commercial_contact` — commercial inquiry CTA
- later, after checkout activation: `license_checkout_start` with safe `label=personal` only

Do not pass email, name, free-text intended use or other user-entered fields to GA.

---

## MVP success signals

Digital licensing remains a priority if, after the measurement baseline:

- `purchase_intent / photo_view` continues to show repeat behavior
- visitors continue beyond intent into product selection
- the licensing explainer receives meaningful engagement
- commercial contact clicks/inquiries appear
- verified purchases exist after payments are eventually enabled

Do not evaluate purchase conversion while `PAYMENTS_ENABLED=false`.

---

## Commercial-license follow-up only if demand appears

Possible later tiers:

1. Small business web/social
2. Editorial / publication
3. Advertising / campaign
4. Interior / hospitality / multi-location
5. Extended or exclusive license

Do not build these into checkout until actual inquiries show what buyers need.

---

## Legal/content checklist before paid launch

This MVP copy is a product draft, not legal advice.

Before enabling paid licensing:
- confirm final personal-license terms
- confirm refund/cancellation language for digital goods
- confirm consumer-law requirements for the target markets
- add a clearly accessible license/terms link at checkout
- ensure the delivered license text matches the product shown before payment
- ensure privacy policy accurately describes any new data collected
- keep copyright ownership language consistent site-wide

---

## Implementation order

1. [x] Define MVP product model.
2. [ ] Add bilingual `/licensing/` explainer page.
3. [ ] Add privacy-safe analytics to the page.
4. [ ] Review HE/EN wording and accessibility at 390px.
5. [ ] Decide where to link the page after review.
6. [ ] After PR #76/payment readiness: adapt checkout copy to say “Personal-use license”.
7. [ ] Do not enable production payments until the existing baseline/security go-live criteria are met.

## Explicit non-goals

- No production payment activation.
- No commercial instant checkout.
- No cart redesign.
- No Gelato work.
- No exclusivity automation.
- No legal conclusion that the draft terms are sufficient in every jurisdiction.


## Existing price-source integration

The licensing page must not own a separate hard-coded price table.

Existing authoritative flow:

1. Global digital prices are stored in D1 `settings` under key `prices`.
2. Public `GET /api/admin/prices` returns `{ small, medium, large }`.
3. Admin can update those global values through `handleAdminPrices`.
4. A specific photo may override those values through `photos.price_overrides`.
5. The existing gallery applies per-photo overrides and promotions in `getEffectivePrice(photoId, size)`.
6. PayPal Orders v2 in PR #76 independently re-reads D1 global prices + `price_overrides` server-side before creating the order, so client values are never authoritative.

The `/licensing/` explainer now loads the current global values from `/api/admin/prices` and formats them using the same current EN rounded-USD display rule.

Important limitation:
- the explainer shows the global/base price only because no specific photo has been selected there;
- the final price for a selected image remains the price shown by that image's purchase flow, including any photo override or active promotion;
- after PayPal Orders v2 is activated, the server remains authoritative even if browser-displayed values are stale or manipulated.

This keeps one pricing source of truth rather than creating a licensing-only price configuration.
