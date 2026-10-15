# Approval gate for the /learn social posts (draft, 15.10.2026)

Why: the analysis of "חלון כחול בקיר לבנים" called a window in the right third "centred / symmetry" and showed camera settings that contradict the real EXIF, and the automatic posts repeated it. Nothing checked the text against facts, and nothing asked the owner before posting.

## What changes
`.github/workflows/learn-generate.yml` no longer posts directly. It now has two jobs:
1. **prepare** (no social tokens): generates the analysis with the existing endpoint, then `src/learn_post_gate.py prepare`:
   - reads the real EXIF from `data/photos.json`; camera numbers appear in the captions only from EXIF; the values the live page shows are compared with the EXIF;
   - measures the main subject's position from the pixels (colour distance from the median colour, largest region) and flags clear contradictions: "symmetry" or "centred" when the subject is measured off-centre, "rule of thirds" when it sits at the centre; an unmeasurable image is a note for the human, not a pass;
   - builds clean captions (no bold-heading prefix, cut at a sentence end);
   - e-mails the owner (Resend, to the secret `APPROVAL_EMAIL`) the draft, the image, the checks and the approval path; writes `draft.json` (public text and URLs only).
2. **publish** (holds the Facebook/Instagram tokens): runs only if the draft passed the checks and the owner approved the run in GitHub (environment `social-approval`, required reviewer = the owner: Review deployments - Approve and deploy, works from the GitHub mobile app). Posts to Facebook and Instagram.

A manual run with `mode = draft-only` prepares the draft and sends the e-mail but never posts. The old `src/learn_social_post.py` is disabled (it posted without approval).

## Limits (honest)
- The analysis page is still saved by the generate endpoint before the approval; a draft that fails the checks stops the posts but the page stays live with its text. A later change should add a draft state to the endpoint (needs a schema or API change, not done here).
- The measurement is a heuristic for catching clear contradictions, not a judge of the composition; it can fail on busy images and then asks for a human check.
- Camera numbers can be verified only for photos that have EXIF in `data/photos.json` (6 of the 62 analysed photos at the time of writing). For the others the captions carry no camera numbers and the page's numbers stay unverified.
- Instagram receives the same thumbnail URL as before (WebP, 800 px); a JPEG source and a full-size image are a separate change.
- Required setup (repository settings, not code): the environment `social-approval` with the owner as required reviewer, and the secret `APPROVAL_EMAIL`.
