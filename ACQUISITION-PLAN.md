# FormGuard — Acquisition Roadmap

## Thesis
FormGuard is being built as an acquisition target, not a forever-business. The
value is a defensible position in the DIY-immigration funnel: the moment right
before someone files. Likely buyers: Boundless, CitizenPath, SimpleCitizen,
LegalZoom, legal-tech PE roll-ups.

## Current state (verified May 2026)
Single-file static app on Netlify. Two serverless functions (verify-payment,
claude proxy). Stripe Payment Link, $24 one-time. Two GitHub Actions crons:
autoblog (Tue/Thu), compliance auto-PR (monthly). NO DATABASE. No persistence.
Every form-check and customer email is generated and discarded. This is the
core gap the roadmap fixes.

## The moat to build
A proprietary dataset of (form type -> errors found -> frequency) plus a list
of pre-filing users. Both are produced on every use today and thrown away.
Capturing them is Phase 1 and the highest-priority work.

## Phases
- Phase 1 (Wk 1-4): Capture layer. Supabase DB, analytics, check-event capture
  in claude.js, email capture on free preview, internal metrics dashboard.
- Phase 2 (Wk 5-10): Monetize beyond $24. Affiliate programs, post-check email
  sequence keyed to form type, refund/refile guarantee, affiliate-revenue
  tracking, B2B subscription side-door, pricing test.
- Phase 3 (Wk 11-18): Traffic. SEO sprint (~20 form-mistake pages), Trustpilot
  to 100+, BBB, one non-SEO channel, press, quarterly data review.
- Phase 4 (Wk 19-24): Positioning. Ops documentation, data room, buyer mapping,
  visibility, one partnership conversation.

## Two metrics that define the pitch
1. Monthly users in pre-filing intent state (volume of high-intent users).
2. Affiliate revenue per user (proves the funnel monetizes).

## Make-or-break notes
- Capture layer (Phase 1) MUST come before traffic (Phase 3). Traffic into a
  system that records nothing wastes the data.
- Keep NOT storing the form image. Capture metadata only. Privacy stance is an
  asset; don't break it.
- Founder has a documented pattern of losing focus ~week 4. Protect a fixed
  recurring weekly build block.

## Known cleanup item
privacy.html describes a server-side 24h storage flow that does not exist in
the code. Correct it to match reality (browser-only sessionStorage pre-payment).
