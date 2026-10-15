# Approval gate for the /learn social posts (draft, 15.10.2026)

Why: the analysis of "חלון כחול בקיר לבנים" called a window in the right third "centred / symmetry" and showed camera settings that contradict the real EXIF, and the automatic posts repeated it. Nothing checked the text against facts, and nothing asked the owner before posting.

## What changes
`.github/workflows/learn-generate.yml` no longer posts directly. It now has two jobs:
1. **prepare** (no social tokens): generates the analysis as a dry run (nothing saved), then `src/learn_post_gate.py prepare`:
   - reads the real EXIF from `data/photos.json`; camera numbers appear in the captions only from EXIF; the values the live page shows are compared with the EXIF;
   - measures the main subject's position from the pixels (colour distance from the median colour, largest region) and flags clear contradictions: "symmetry" or "centred" when the subject is measured off-centre, "rule of thirds" when it sits at the centre; an unmeasurable image is a note for the human, not a pass;
   - builds clean captions (no bold-heading prefix, cut at a sentence end);
   - e-mails the owner (Resend, to the secret `APPROVAL_EMAIL`) the draft, the image, the checks and the approval path; writes `draft.json` (public text and URLs only).
2. **publish** (holds the Facebook/Instagram tokens): runs only if the draft passed the checks and the owner approved the run in GitHub (environment `social-approval`, required reviewer = the owner: Review deployments - Approve and deploy, works from the GitHub mobile app). Posts to Facebook and Instagram.

A manual run with `mode = draft-only` prepares the draft and sends the e-mail but never posts. The old `src/learn_social_post.py` is disabled (it posted without approval).

## Limits (honest)
- **The approval now covers the page too (second PR):** `POST /api/analyses/generate` accepts `dry_run: true` and returns the whole analysis without saving anything; `POST /api/analyses/save` (admin only, validated: known rule, only <p>/<strong>/<em>/<br> without attributes, bounded tags/annotations/camera fields, existing photo) stores the approved analysis. The publish job saves first (the /learn page goes live) and posts to Facebook/Instagram only if the save succeeded. A draft that fails the checks leaves nothing on the site. The same save endpoint is how a corrected analysis can be written without touching the database directly.
- The measurement is a heuristic for catching clear contradictions, not a judge of the composition; it can fail on busy images and then asks for a human check.
- Camera numbers can be verified only for photos that have EXIF in `data/photos.json` (6 of the 62 analysed photos at the time of writing). For the others the captions carry no camera numbers and the page's numbers stay unverified.
- Instagram receives the same thumbnail URL as before (WebP, 800 px); a JPEG source and a full-size image are a separate change.
- Required setup (repository settings, not code): the environment `social-approval` with the owner as required reviewer, and the secret `APPROVAL_EMAIL`.

## Real EXIF in the analysis (third PR)
- The generator now reads the photo's EXIF from `data/photos.json` (served as a static asset) and puts it in the prompt as fixed values; the model is told not to change or estimate them. After the model answers, the stored camera values are forced to the EXIF values ("לא ידוע" for a field the EXIF lacks, and for every field when there is no EXIF at all); the model's explanations are kept. Result: no analysis can show an invented aperture, shutter speed, ISO or focal length again, and the gate's EXIF check stops blocking every photo with EXIF.
- The prompt also asks for composition claims to come only from what is visible in the picture.
- The gate prints the server's error code/message (shortened, never a secret) when generation fails, so a failure like the HTTP 502 of 15.10 can be diagnosed.
- Analyses that already exist keep their old (possibly invented) values until they are regenerated or corrected through `/api/analyses/save`.

## Second check and page preview (fourth PR)
- `POST /api/analyses/verify` (admin only, saves nothing): a separate, sceptical pass sends the picture and the analysis text to the model and gets back every factual claim judged `supported` / `contradicted` / `uncertain`, plus whether the chosen rule fits. Without an image it refuses instead of judging blind.
- The gate blocks the draft on any contradicted claim or an unfitting rule, lists uncertain claims as notes, and fails closed if the second check could not run.
- The approval e-mail now lists every claim with its verdict and shows a preview of the /learn page (rule, text, camera values, tags). The page address is shown as text, with the note that it returns 404 until the approval (the page is created only then); it is no longer a clickable link.
- Example that motivated it (15.10): the windmill draft passed the first checks but said the windmill "reflects perfectly in the canal" and the horizon is a symmetry axis, while most of the lower frame is reeds and grass.
- Cost: one more model call per analysis (the workflow runs weekly).

## One automatic repair round (fifth PR)
- `POST /api/analyses/revise` (admin only, saves nothing): sends the picture, the old text and exactly the claims the second check marked as contradicted (and the rule verdict) to the model, which rewrites the analysis (3 paragraphs, annotations, tags; never camera numbers). The rewrite is validated like a save (rule, plain markup only); an invalid rewrite is refused.
- The gate runs the second check; if it found contradicted claims or an unfitting rule, it asks for ONE rewrite and checks the new text again. The owner is e-mailed only the final version. Still wrong after one round, or the rewrite failed: the draft stays blocked and the e-mail lists the problems. The e-mail notes when a draft was revised and what the first-round problems were.
- Why: in the first real runs two of three drafts were blocked (windmill "perfect reflection"; kayak "lit subject" and "bright sky"), which would leave the owner with mostly blocked e-mails.
- Cost: up to two more model calls per analysis (rewrite + second check), weekly.

## Weekly pick of 3 photos (sixth PR)
- Owner's decision (15.10.2026): photos that clearly demonstrate a rule are found first, and the owner picks one of three before anything is written.
- `POST /api/analyses/candidates` (admin only, saves nothing): screens up to 8 unanalysed photos with the cheap model (Haiku), keeps only those that clearly demonstrate one of the six rules (clarity >= 0.7), best first, at most 3.
- The weekly run now only proposes: it opens a GitHub issue (label `learn-pick`) with the 3 candidates (photo, rule, clarity, reason) and e-mails its link. The owner comments **1, 2 or 3**; only a bare number from the repository owner on an open pick issue counts. The issue is then closed and the analysis is written for that photo with the rule fixed in advance (`rule` in `/api/analyses/generate`): the model explains the rule, it does not choose it. Then the existing chain runs: dry run, EXIF, measurement, second check, one repair round, approval e-mail, approval in GitHub, save and publish.
- No clear candidate in a week: an e-mail says so and nothing is written.
- Manual runs: `propose` (now), `draft-only` / `full` (optionally with `photo_id` and `rule`).

## Structured output, retry, rule override (seventh PR)
- The four learn calls to Claude (screening, analysis, second check, repair) now use a forced tool with a JSON schema, so the answer arrives as a validated object. The 15.10 failure "Expected ',' or '}' ... position 1434" (a quote inside Hebrew text breaking the hand-parsed JSON) can no longer happen. Other Claude calls in the site are untouched.
- A busy or failing Claude (429, 5xx, 529) is retried once after 1.5 s; client errors are not retried. The gate's log shows the Claude status when the site reports it.
- The owner can correct the screened rule in the pick comment: `2 שליש` (also סימטריה, קווים, זהב, מסגור, מרחב). Motivated by the green door (15.10): screened as framing, the owner identified it as rule of thirds (the door sits on the right-third line, the chair balances it on the left).
- The pick issue and e-mail say plainly: do not reply to the e-mail; the choice is read only from a GitHub comment.

## Tool-answer normalisation; measurement becomes advisory (eighth PR)
- The first full run for the green door (rule of thirds, 15.10) was blocked twice for the wrong reasons: the second check returned no claims (the model handed the claims array back as a JSON string inside the tool input), and the pixel measurement flagged the honest sentence "the door is closer to the centre than recommended" as a centring claim.
- Tool answers are now normalised against the schema (array/object fields given as JSON strings are parsed, "true"/"false" and numeric strings converted). `VERIFY_EMPTY` now says what came back.
- Pixel-measurement findings are notes for the owner, never blocks; the second check (which looks at the picture) decides. Camera contradictions with EXIF stay blocking (the stored values are forced to EXIF anyway).
