# Campaign page handoff

Updated: 2026-10-15

## Live page

- Campaign landing page: <https://amitphotos.com/campaign/>
- Campaign page source: [`index.html`](./index.html)
- The page is a standalone Hebrew/English landing page served from the site's static assets.

## What is on the page

- Introductory hero with links to the photography guides (`/camera/`), videos (`/videos/`) and gallery (`/#gallery`).
- A campaign video and its poster image in [`media/`](./media/). The video stays on its poster frame until the visitor presses play.
- A preview of Amit's gallery with a landscape photograph and a wildlife photograph.
- Cards linking to the site's gallery, guides, locations, photo analyses, videos, games, free guide and gear pages.
- WhatsApp, Facebook and LinkedIn share links. The public campaign URL is embedded in those links and the Open Graph metadata.

## Where to make changes

Most edits belong in `campaign/index.html`:

- Text and Hebrew/English copy: edit elements with `data-he` and `data-en` together.
- Hero title, introductory copy and calls to action: `.hero-copy` in the hero section.
- Gallery preview: `.gallery-preview-grid`.
- Site destinations: the `href` attributes on the hero buttons and `.area-card` links.
- Colors, layout and responsive behavior: the page's inline `<style>` block.
- Social share URLs and preview metadata: the share section and the Open Graph/Twitter tags in `<head>`.

Campaign media lives in `campaign/media/`. Keep the poster image in sync if replacing the video. Preserve the pause/play control and reduced-motion behavior when changing video playback.

## Gallery image paths

Gallery images are served by the Worker from the `PHOTOS` R2 bucket at `/photos/<object-key>`. The current preview uses:

- `1d8LFk1t2KZRu2o8VmgJxszQCFPbEW-lg.webp` — “שדה פרחים בשפע” (landscape)
- `1NmCLTIcIAIf7CEsak3J21NxRLMI28QIP.webp` — “ברווז בטבע”

When replacing a gallery image, use a path that exists in the live gallery and verify it loads at `https://amitphotos.com/photos/<object-key>`. The static `data/photos.json` catalog can help locate an image and its title, but the browser's live result is the final check. A missing image can be hidden by the page's `onerror` handler; inspect the rendered page to make sure a fallback is not concealing an unavailable R2 object.

## Preview and deploy

1. Work on `codex/campaign-landing` or a new branch based on the current `main`.
2. Preview `campaign/index.html` locally with a static server from the repository root, then check desktop and mobile widths, language switching, the paused video poster, image loading, internal destinations and share links.
3. Run `git diff --check` before committing.
4. Deployments run from pushes to `main`. `.github/workflows/deploy.yml` includes `campaign/**`; it deploys with Wrangler, syncs the required Resend secret and purges the Cloudflare cache. A feature-branch push alone does not publish the page.
5. After deployment, open <https://amitphotos.com/campaign/> and check the live image URLs and social preview. External social preview caches may take time to refresh.

The workflow needs the repository's configured Cloudflare and Resend GitHub secrets. Do not add secret values to this handoff or to the repository.
