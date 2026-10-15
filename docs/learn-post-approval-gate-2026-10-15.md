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
