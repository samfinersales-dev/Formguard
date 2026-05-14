# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FormGuard (uscisformcheck.com) — a single-page web app that lets users upload a completed USCIS immigration form, pay $24 via Stripe, and receive an AI-generated error report from Claude vision. Static site hosted on Netlify; two serverless functions plus two GitHub Actions cron jobs handle everything dynamic. No build step, no framework, no package manager beyond `stripe` for the functions.

## Commands

There is no `build`, `lint`, or `test` script. Common operations:

- **Run locally**: `netlify dev` (proxies the static site at `index.html` and serves `netlify/functions/*` at `/.netlify/functions/<name>`). Requires `STRIPE_SECRET_KEY`, `STRIPE_PLINK_ALLOWLIST`, and `ANTHROPIC_API_KEY` in `.env` or the Netlify CLI environment.
- **Install function deps**: `npm install` (only installs `stripe`).
- **Manually trigger blog generation**: GitHub Actions tab → "Auto Blog Post Generator (v3)" → Run workflow. Or run `node .github/scripts/generate-blog-post.js` locally with `ANTHROPIC_API_KEY` set.
- **Manually trigger compliance check**: GitHub Actions tab → "Monthly Compliance Auto-Update" → Run workflow.
- **Deploy**: Push to `main`. Netlify auto-deploys. The blog generator pushes directly to `main` after generating a post; the compliance script opens a PR for human review.

## Architecture

### Payment-gated AI proxy (the core flow)

`index.html` is a 60KB single file containing the entire UI, styles, and client logic. The user picks a form, uploads an image/PDF, and the upload is base64-stashed in `sessionStorage` **without** calling the AI. They're redirected to a hardcoded Stripe Payment Link (`https://buy.stripe.com/...` in `index.html`). On return, Stripe appends `?session_id=cs_xxx` and `checkPaidReturn()` runs.

The two-function design exists to prevent free abuse of the Anthropic API:

1. **`netlify/functions/verify-payment.js`** — confirms the Stripe session is `paid` AND that `session.payment_link` is in `STRIPE_PLINK_ALLOWLIST`. The allowlist matters because the same Stripe account is shared across 5 sibling products; without it, a paid session from another product would unlock free AI calls here.
2. **`netlify/functions/claude.js`** — re-verifies the same session+allowlist on every call, then proxies the form image to `api.anthropic.com/v1/messages` (`claude-sonnet-4-6`, vision + `pdfs-2024-09-25` beta). Caps body at 8MB. CORS is locked to `uscisformcheck.com`.

Both functions implement the same allowlist check. If you change one, change the other — they are the two enforcement points and either one being permissive breaks the gate. The `26s` timeout in `netlify.toml` is tuned for Claude vision latency on larger form images and must not be lowered.

### Cron jobs (GitHub Actions)

Two scheduled workflows that share a "pull script from `.github/scripts/`, run it, clean up" pattern:

- **`auto-blog.yml`** (Tue/Thu 8am UTC) → `generate-blog-post.js`. Reads `blog-config.json` (per-site content rules: form rotation, topic angles, banned phrases, allowed stat sources, byline) and generates one HTML post into `blog/`. Has 4 layers of dedup (slug, title similarity, body hash, form×topic matrix) and recycles oldest topic when the matrix is exhausted. Commits straight to `main` and pings `NETLIFY_HOOK`.
- **`auto-update.yml`** (1st of month, 9am UTC) → `auto-update.js`. Uses Claude with `web_search` to check for regulatory changes (driven by repo-level GitHub **Variables**: `SITE_DOMAIN`, `SITE_NAME`, `APP_TYPE`, `REGULATORY_AREA`, `CHECK_ITEMS`). If changes are found, it generates an OLD_TEXT/NEW_TEXT diff against `index.html` and opens a PR. **Never auto-merges** — `compliance-reports/check-log.txt` records no-op runs as direct commits to `main`.

`generate-blog-post.js` is intentionally a multi-site shared script — it supports state-aware sites (LeaseHelper, SmallClaims), form-aware sites (FormGuard, via `formRotation`), and topic-only sites (VerifyDoc), all driven by `blog-config.json`. Don't make it FormGuard-specific; instead extend `blog-config.json` schema.

### Static legal pages

`privacy.html`, `refund.html`, `terms.html` are standalone. `sitemap.xml` lists every blog post — the compliance script and blog generator both expect it to stay current (blog generator updates it; manual blog edits should too).

`download-module.js` is loaded by `index.html` to render the post-payment results as a downloadable PDF via jsPDF (loaded from CDN on demand). Pure client-side, no server interaction.

## Conventions worth knowing

- **No package manager for the front-end**. `index.html` is hand-edited. All JS lives inline or in `download-module.js`. Don't introduce a bundler — the Netlify config has `skip_processing = true` and the compliance auto-updater regex-patches `index.html` directly.
- **Inline styles in `index.html`** use CSS custom properties at `:root`. Blog posts use their own per-post CSS derived from `blog-config.json` colors (`primaryColor`, `accentColor`, `bgColor`, `darkTheme`).
- **Model pin**: both functions and both cron scripts call `claude-sonnet-4-6` explicitly. Don't bump the model in one place without the others.
- **Stripe Payment Link is hardcoded** in `index.html` (not env-driven). Changing pricing or the link requires editing the `<a id="stripe-link" href="...">` directly.
- **`.blog-state.json` and `.blog-debug-failed.txt`** are gitignored runtime artifacts of the blog generator — don't commit them.
