# The Capacity Compass™ — Renew You Living

AI-assisted personal capacity & decision-support tool. Zero npm dependencies (Node ≥ 18). Vanilla-JS, mobile-first front end; Node `http` server.

## Run it
```bash
cp .env.example .env     # edit as needed
npm run dev              # ACCESS_MODE=test (NON-PRODUCTION): any email can sign in; link shown on screen
npm test                 # 41 automated tests (engine, auth, entitlements, AI layer with a mocked provider)
npm start                # production-mode access: entitlement required
```
Open http://localhost:3000. Founder admin: http://localhost:3000/admin (needs `ADMIN_TOKEN`).

## Architecture
| Piece | File |
|---|---|
| Deterministic engine (totals, conflicts, recommendation candidates, HD matching, script templates, safety) — shared by browser & server | `lib/engine.js` |
| AI engines 1–4 (organize, analyze, HD reflection, boundary) with Anthropic tool-use structured output | `lib/ai.js` |
| Schema validator (every AI response) | `lib/schema.js` |
| Auth, entitlements, GHL webhook, admin, rate limits, API | `server.js` |
| JSON-file store, AES-256-GCM at rest when `DATA_ENCRYPTION_KEY` set | `lib/store.js` |
| Human Design reference library (founder-editable) | `data/hd-library.json`, `/admin` |
| UI | `public/` |

**Engine 5 (final plan)** is deterministic assembly of the user's *confirmed* choices (no AI call) by design, so rejected recommendations can never leak into the Capacity Edit.

Rules enforced in code (and tested): fixed commitments never subtracted twice; unknown hours never treated as zero (totals labelled partial); unsorted cards excluded from totals; hypothetical vs confirmed changes kept separate with the original preserved; AI may not invent hours/status/deadlines (each must quote evidence found in the user's text); AI recommendations are dropped unless they target real, adjustable, non-personal cards; time impact comes from the engine, not the model; HD uses approved library entries only; HD never alters the practical recommendation; threats/retaliation → no confrontation scripts.

## AI integration
Set `ANTHROPIC_API_KEY` (+ optional `AI_MODEL`, default `claude-sonnet-5-5`). Calls are server-side only, forced tool-use JSON, validated, with a 45s timeout, per-user daily cap (`AI_DAILY_LIMIT`) and 8/min limit. Users must consent (provider, what is sent, storage, retention) before any call; server enforces it. Without a key, or on any AI failure, the app falls back to **Guided mode**, labelled as rule-based, never as AI. Editing fields never triggers AI; the dashboard shows a "may be out of date" banner and the user refreshes on purpose.

## Paid access ($27 order bump, GoHighLevel)
Implemented: passwordless magic links (single-use, 15 min, POST-confirmed so email scanners can't burn them), HttpOnly sessions, entitlement re-checked on **every** request (revocation is immediate), `POST /api/webhooks/ghl`, admin grant/revoke.

Production wiring (remaining steps):
1. Set `GHL_WEBHOOK_SECRET`, `ADMIN_TOKEN`, `APP_URL`, `NODE_ENV=production`, `ACCESS_MODE=production`.
2. In GHL, on the order-bump paid event add a Workflow → **Webhook** action → `POST https://YOUR_APP/api/webhooks/ghl`, header `x-webhook-secret: <secret>`, JSON body `{"event":"grant","email":"{{contact.email}}","orderId":"{{order.id}}","ticket":"general_admission|vip","productId":"..."}`. Optionally set `GHL_PRODUCT_ID`; `ELIGIBLE_TICKETS` restricts to General Admission/VIP (map your GHL ticket/product to those values).
3. Refund workflow → same webhook with `{"event":"revoke","email":...,"reason":"refund"}`.
4. Sign-in email: set `EMAIL_WEBHOOK_URL` to a GHL inbound-webhook workflow (or Zapier) that sends `{to, subject, text, link}` as an email. Until set, production cannot deliver links (they're only logged in dev/test).
5. Set `CHECKOUT_URL`, `SUPPORT_EMAIL`, `COACHING_URL`, `OFFER_PRICE`.
Test access (`ACCESS_MODE=test`, or admin "Grant TEST access") is bannered "non-production" in the UI. **Never enable on a public deployment.**

## Human Design library
`data/hd-library.json` ships with **zero approved entries and no invented definitions**. Until entries are approved, users who enter chart details see "no approved reflection available". Founder: open `/admin`, load with `ADMIN_TOKEN`, write wording per Type/Authority/Strategy/Profile (body, reflective questions with optional `{responsibility}`, practical application, limitations), set status `approved`. Editing an approved entry bumps its version and returns it to draft. Required before launch is listed in the file (`requiredBeforeLaunch`) and in the admin page. The `consistency_rules` block (valid Type/Authority/Strategy pairings, used only to ask one clarifying question) is a standard mapping — **founder should verify it**.

## Deploy
Any Node host (Render, Fly, Railway, a VPS) behind HTTPS. Mount a persistent volume at `DATA_DIR`; set `DATA_ENCRYPTION_KEY` (`openssl rand -hex 32`). For multi-instance scale, replace `lib/store.js` with Postgres/Supabase and move rate-limit counters to Redis. No third-party scripts/fonts/analytics are loaded.

## Test results
**Performed and passing (41):** scenarios 1–5, 7–9, 11, 12 and the 6 (HD skipped) logic in `test/engine.test.js`; unauthenticated rejection, production no-access, webhook verification, single-use links, revocation, per-email rate limit, CSRF header, encryption at rest, user isolation, admin auth, approval workflow, AI schema rejection, hallucinated-id dropping, evidence stripping, AI daily limit, AI failure fallback, safety short-circuit, static path traversal (`test/server.test.js`). Manual browser run (Chromium, 390×844 phone viewport): full flow brain dump → cards → capacity → priority → skip HD → dashboard → accept → boundary → next move → Capacity Edit, reload persistence, no console errors.
**Not performed:** live Anthropic calls (no key/network; AI tested against a mocked provider only, so real output quality and prompt tuning are unverified); live GoHighLevel webhook; real email delivery; scenario 10 (reject → custom action) and the HD UI with approved content were exercised via logic/API, not clicked through in the browser; scenario 11's UI path not clicked through; screen-reader and keyboard-only audit; real-device mobile testing; PDF export is via the browser print dialog (print CSS provided, not visually verified in a print preview); load testing.

## Remaining launch requirements
1. Founder-approved HD entries (see above). 2. `ANTHROPIC_API_KEY` and a prompt-quality pass with real outputs; confirm retention wording with your Anthropic agreement. 3. GHL workflows + email delivery. 4. Production datastore/backups. 5. Legal review of privacy text and refund→revocation policy. 6. Accessibility audit. 7. Confirm the safety-resource wording for your audience/regions.
