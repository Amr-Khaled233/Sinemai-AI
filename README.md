# Sinemai AI · سينمائي

Film and advertising production intelligence. A producer uploads a screenplay or an ad brief;
the platform returns a **Production & Equipment Sheet**: a scene-by-scene breakdown, a
camera/lighting/grip package, cinematographers matched by visual style, rental vendors that
actually stock the gear, and a costed budget — in Arabic (default, RTL) or English.

Built for the Saudi market: SAR pricing, Arabic-first UI, Arabic screenplay heading conventions
(`مشهد ٣ - داخلي - ... - ليل`) alongside Fountain, Final Draft and PDF.

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15 App Router, TypeScript, Server Actions |
| AI | Vercel AI SDK 5 (`ai`) + `@ai-sdk/openai` — gpt-4o for reasoning, gpt-4o-mini for narrow agents |
| Database | Postgres + `pgvector` (Vercel Postgres / Neon) via Prisma |
| Auth | NextAuth (credentials, JWT sessions) with `PRODUCER · VENDOR · DOP · ADMIN` roles |
| Files | Vercel Blob (scripts, equipment photos) |
| Email | Resend (falls back to console logging in dev) |
| PDF | `@react-pdf/renderer` with an embedded IBM Plex Sans Arabic — Arabic and English, no headless browser |
| Auth extras | Self-service password reset: hashed single-use tokens, 60-minute expiry, no account enumeration |
| i18n | `next-intl`, `dir="rtl"` + logical CSS properties; agents answer in the reader's language |
| Theming | Semantic CSS-variable tokens, light/dark/system with a no-flash init script |
| Jobs | Vercel Cron (`vercel.json`) hitting guarded `/api/cron/*` routes |

---

## Quick start

```bash
cp .env.example .env          # fill DATABASE_URL and OPENAI_API_KEY at minimum
npm install
npm run db:setup              # pgvector extension → schema push → HNSW index → seed
npm run dev
```

`db:setup` runs four steps you can also run individually:

```bash
npm run db:extensions   # CREATE EXTENSION vector      (must run before push)
npm run db:push         # Prisma schema → database
npm run db:index        # HNSW cosine index on Dop.embedding
npm run db:seed         # catalog, crew rates, style tags, launch partners, demo accounts
```

### Seeded accounts

Demo accounts are built from one real Gmail address with plus-addressing, so every
approval mail, inquiry and password reset lands in a single inbox and each account can
actually be signed into:

```bash
SEED_GMAIL=you@gmail.com SEED_PASSWORD='choose-one' npm run db:seed
```

| Email | Role |
| --- | --- |
| `you+admin@gmail.com` | ADMIN |
| `you+producer@gmail.com` | PRODUCER |
| `you+vendor-riyadh@gmail.com` · `you+vendor-jeddah@gmail.com` | VENDOR (approved, with inventory) |
| `you+dop-faisal@gmail.com` … `you+dop-tariq@gmail.com` | DOP (approved, 5 profiles) |

**No password is committed to this repository.** With `SEED_PASSWORD` unset the seed
generates a strong one and prints it once — save it from that output. Forgot the password
later? Use the reset flow on the sign-in page.

The seed ships ~30 catalog entries compiled from public manufacturer spec sheets
(ARRI, RED, Sony, Canon, Blackmagic, Aputure, Astera, Nanlux, Kino Flo, DJI, Matthews,
Sound Devices, Sennheiser, Honda). **`indicativeDayRate` values are placeholder market
estimates** used only when no approved vendor stocks an item — vendors set the real prices, and
an admin can edit these in the catalog screen.

DOP embeddings are generated during the seed when `OPENAI_API_KEY` is set. Without it the
profiles are stored unembedded and cannot be matched until the nightly job or the admin
"Re-embed cinematographers" button runs.

---

## The AI engine

Six agents, not one prompt. Each one has a narrow job, its own system prompt, and only the tools
it needs.

```
User submits project + script
        │
        ▼
Orchestrator Agent ......... no database tools; owns order + final assembly
        │
        ▼
Script Analyst Agent ....... parseScriptFile, segmentScenes
        │                    → per-scene requirements, batched 12 at a time
        ├──────────────┬─────────────────────┐
        ▼              ▼                     │  Equipment and DOP matching
Equipment Agent   DOP Matching Agent         │  run concurrently
 queryEquipment    embedText,                │
 Catalog           vectorSearchDOPs          │
        └──────┬───────┘                     │
               ▼                             │
    Vendor & Budget Agent  ← needs the package
     queryVendorInventory, getCrewDayRates
               │
               ▼
    Orchestrator assembles the sheet
               │
               ▼
    Critic Agent (no tools) → one targeted retry per flagged agent
               │
               ▼
    Production & Equipment Sheet → UI + PDF
```

### Why the numbers hold up

The hallucination surface is closed structurally, not by asking the model nicely:

- **Facts come from tool results, not model prose.** Every tool call is wrapped
  ([`loggedTool`](src/agents/runtime.ts)), and downstream code reads the recorded results.
  The model chooses *filters* and *selections*; the database supplies names, specs and prices.
- **Selection is validated against the retrieved set.** The Equipment Agent picks ids from the
  catalog shortlist it retrieved; any id outside that set is dropped before pricing and reported
  to the Critic (`droppedHallucinatedIds`).
- **Parsing is deterministic.** [`src/lib/script/parse.ts`](src/lib/script/parse.ts) decides what
  the scenes *are*; the analyst only decides what each scene *needs*.
- **All arithmetic is code.** Scene aggregates, rental allocation, weekly-rate maths, crew
  totals and the low/mid/high spread are computed in TypeScript over tool-sourced rates.
- **A reviewer gates delivery.** The Critic combines LLM review with mechanical checks (tier
  ceiling breach, no camera body, night-heavy breakdown with no lighting package, rental days
  exceeding the shoot, missing crew cost) and sends blockers back to exactly one retry per agent.
- **Everything is logged.** `AgentRun` (per invocation, retries included, with prompt, input,
  output, latency, token counts) and `AgentToolCall` (args + results) — visible in the admin
  dashboard and the basis for tuning the matching rules later.

### Answering in the reader's language

The run carries the locale the producer is actually reading, not the one stored on their
account, and every agent that writes prose for a human gets a language directive appended to
its system prompt ([`src/agents/language.ts`](src/agents/language.ts)). Equipment rationale,
cinematographer match reasons, sourcing caveats, reviewer findings and the executive summary
come back in Arabic on `/ar` and English on `/en`. Ids, enum values, numbers and equipment
model names stay exactly as the database has them — the UI translates those itself.

### Resumable execution and streaming

The orchestrator is a **state machine, not one long call**. Each step does one unit of work
(parse, *one batch of 12 scenes*, equipment+DOP, pricing, review, one retry, assemble) and
checkpoints to `AnalysisState`. `POST /api/projects/:id/analyze` runs as many steps as fit in
a 40s budget, streams newline-delimited JSON progress events, and closes with a `checkpoint`
event telling the client whether to call again.

That means **no single function invocation needs a long duration**: a feature-length breakdown
runs on a 60s plan across several short requests. Because analysed scenes are persisted per
batch, a timed-out or retried request resumes at the next cursor instead of re-analysing — and
re-paying for — the whole script. `GET` on the same route returns the current checkpoint, so a
reloaded page can rejoin a run already in flight.

### Tests

```bash
npm test      # 60 unit tests, no database and no API calls
npm run verify  # typecheck + lint + tests + parser smoke, the pre-push gate
```

The suite covers the parts that are expensive to get wrong and cheap to check:
screenplay segmentation across Fountain, Final Draft, pasted briefs and Arabic headings; the
budget arithmetic (weekly rates, cheapest-vendor allocation, availability penalties, crew
totals, uncovered items); scene aggregation; and the security gates (HTML escaping, href scheme
validation, the upload allow-list, error-code hygiene).

The pure logic is deliberately separable from the database and the model so it can be tested
directly — `aggregateScenes` takes its settings as arguments, and `allocatePackage` takes vendor
rows rather than reaching for Prisma.

```bash
npm run agents:smoke            # parses every file in ./samples — no API calls, no DB writes
npm run agents:smoke -- --full  # creates a throwaway project and runs all six agents
```

`samples/` covers Fountain, Final Draft `.fdx`, an English ad brief with `Scene N —` headings, and
an Arabic screenplay with Arabic-Indic scene numbers. The parse-only mode is the one to run in CI.

---

## Data model highlights

- `Project → Script → Scene[]` — scenes carry both parsed facts (INT/EXT, time of day, page
  eighths) and agent-derived ones (lighting complexity + notes, camera movement, special
  requirements, estimated hours).
- `Equipment` is tagged for matching: `suitableLightingComplexity`, `suitableMovementTypes`,
  `budgetTier[]`, `dayNightSuitability`, `specialCapabilities[]`, `isCore`.
- `VendorInventoryItem` holds the real prices and quantities; `AvailabilityBlock` holds
  rented-out date ranges, which the vendor tool intersects with the shoot dates.
- `Dop.embedding` is a `vector(1536)` column. text-embedding-3-large is **shortened to 1536
  dimensions** via the provider's `dimensions` parameter because pgvector's HNSW index tops out
  at 2000 dims. Prisma cannot read `Unsupported` columns, so embedding writes and similarity
  search use raw SQL in [`src/lib/embeddings.ts`](src/lib/embeddings.ts).
- `ProjectRecommendation` stores the whole sheet (package, matches, budget breakdown, critic
  notes, model provenance) so it renders, exports and shares without re-running any agent.
- `Setting`, `CrewRate`, `BudgetTierConfig`, `StyleTag` are admin-editable and read by the agents
  at run time — the budget is never hard-coded in the source.

---

## Deploying to Vercel

1. Create the project and attach Postgres (Vercel Postgres or Neon). Use the **pooled**
   connection string for `DATABASE_URL`.
2. Set the environment variables from `.env.example`, including `NEXTAUTH_URL` (your production
   URL), `NEXTAUTH_SECRET` (`openssl rand -base64 32`) and `CRON_SECRET`.
3. Run the database steps once against production:
   `npm run db:extensions && npm run db:push && npm run db:index && npm run db:seed`.
4. Deploy. `vercel.json` registers two cron jobs:
   - `/api/cron/reembed-dops` daily at 03:00 — re-embeds profiles edited since their last vector.
   - `/api/cron/availability-cleanup` at 03:30 — prunes old availability blocks and fails
     analyses left hanging by a timed-out function.
5. No plan upgrade is needed: the analyze route declares `maxDuration = 60` and the run is
   split across as many short requests as it takes. On a plan with longer durations it simply
   finishes in fewer round trips.

Arabic PDF export embeds two font files from `src/pdf/fonts/`. They are pulled into the
serverless bundle by `outputFileTracingIncludes` in `next.config.mjs` — keep that entry if you
move the PDF route.

---

## Known limits, deliberately

- **Indicative day rates are placeholders.** They exist so a sheet can still be costed when a
  needed item has no vendor. Real prices come from vendor onboarding.
- **Proximity is a soft signal.** Same-city DOPs and vendors get a small ranking nudge, never a
  hard filter — Saudi crews travel between cities routinely.
- **Scene numbers per scene are estimates.** Page eighths come from line counts, not from a
  paginated layout engine, so they approximate rather than replace a scheduling package.
- **Aerial work needs permits.** The catalog notes GACA permits for drone platforms; lead time is
  not modelled in the budget.

---

## Theming

Light, dark and "follow the OS" are one token set with two value tables in
[`src/app/globals.css`](src/app/globals.css) — `--page`, `--surface`, `--line`, `--text-strong`,
`--muted`, `--accent`, `--danger`… Tailwind maps each to a semantic utility
(`bg-surface`, `border-line`, `text-muted`), so components never name a literal colour and a
third theme would be a third value table, not a component rewrite.

Resolution order: an explicit choice on `<html data-theme>` wins; with no choice the
`prefers-color-scheme` media query applies. The choice is stored in `localStorage` and replayed
by a tiny inline script in `<head>`, so a dark-mode visitor never sees a white flash. Every
storage read and write is wrapped in try/catch, because private windows throw.

## Arabic PDF

`@react-pdf/renderer` shapes text through fontkit, which applies the font's OpenType Arabic
features and emits glyphs in visual right-to-left order — what it cannot do is invent Arabic
glyphs for Helvetica. So the sheet embeds IBM Plex Sans Arabic (SIL OFL 1.1), which carries
Latin too, keeping "ARRI ALEXA 35" in one typeface inside an Arabic sentence.

Verified rather than assumed: `لا` shapes to a single `uniFEFB` ligature glyph and `كاميرا`
to five contextual forms, table columns mirror in RTL, and hyphenation is disabled so Arabic
words are never broken mid-script. The export language follows `?locale=`, falling back to the
language the sheet's narrative was generated in.

---

## Security

The platform holds unreleased screenplays, vendor pricing and personal contact details, and it
spends money on model calls, so the controls below are part of the build rather than a later pass.

**Identity.** Credentials are bcrypt hashed at cost 12. Sign-in is rate limited per email address
and compares against a dummy hash for unknown accounts, so response timing does not reveal which
addresses exist. A password reset stamps `passwordChangedAt`, and the session callback rejects any
JWT minted before that moment — a stolen session cannot outlive the credential it was issued
against. Reset tokens are 256-bit, stored only as SHA-256 hashes, single use, and expire in an
hour; requesting one answers identically whether or not the address exists.

**Authorization.** Every page guards with `requireRole`, every server action re-checks ownership
against the session (never a client-supplied id), and every route handler re-checks both. Share
links are unguessable bearer tokens, scoped to one project, revocable, and validated against that
project on both the page and the PDF export.

**Injection and XSS.** Prisma parameterises everything, including the two raw pgvector queries,
whose vector literal is built from validated numbers. React escapes the UI, but two places bypass
it and are handled explicitly: HTML email bodies escape every user-supplied field, and anything
rendered as an `href` is scheme-checked — `z.string().url()` accepts `javascript:`, `data:` and
`vbscript:`, which would otherwise be stored XSS through a cinematographer's portfolio links.
Uploads are extension- and MIME-checked (no SVG or HTML into a public blob origin).

**Abuse and cost.** Rate limits live in Postgres, not memory, because serverless instances do not
share state and a caller could otherwise cycle instances to reset a counter. Sign-in, password
reset, registration, inquiries and — most importantly — analysis runs are all capped, since each
run spends real money on model calls.

**Request integrity.** Server Actions get Next's built-in CSRF protection; route handlers do not,
so every state-changing handler checks the request origin as well, behind the SameSite=Lax session
cookie. Responses carry `nosniff`, `frame-ancestors 'none'`, `X-Frame-Options`, a strict referrer
policy, HSTS and a closed `Permissions-Policy`. Server actions return allow-listed error codes;
anything else is logged server-side and surfaces as a generic failure.

### Known, accepted

- **No full CSP.** Only `frame-ancestors` is set. A useful script policy needs per-request nonces
  through middleware, because the app ships an inline theme bootstrap alongside Next's own inline
  runtime. Worth doing before a public launch.
- **Registration confirms whether an email is taken.** A deliberate UX trade-off, softened by the
  per-IP limit. Closing it means accepting the signup silently and mailing the existing account.
- **Two build-time advisories remain**: `postcss` bundled inside Next 15, and `deepmerge-ts` under
  the Prisma CLI. Neither is reachable at runtime; both need a major upgrade (Next 16 / Prisma 7)
  to clear.
- **Password policy is length-only** (8 characters). No breach-list check.
- **Agent logs store script text.** `AgentRun.input` keeps the prompts, which include scene
  content. That is what makes the pipeline debuggable; treat the table as customer data and set a
  retention policy.

---

## Responsive behaviour

The interface is built for a 320px phone first and widens from there; nothing is
desktop-only.

**Tables are grids.** Every table keeps its `<table>` markup for semantics, but the layout is CSS
Grid: `thead`, `tbody` and `tr` are `display: contents`, so each cell is a direct grid item and the
columns are declared once through a `--grid-cols` custom property. The native table algorithm sizes
columns from content, so one long reason string drags its column wide and starves the rest, and the
same column lands at a different width on every screen; a grid template is explicit and identical
on every row.

Stacking is driven by a **container query**, not the viewport, because what matters is whether the
columns fit that table's own box — the crew table sits in a half-width column and has to stack long
before the page does. Three thresholds, each set above the sum of that tier's column minimums so a
table never scrolls sideways inside its own card: 36rem for short tables, 48rem for five or six
columns, 60rem for the seven and eight column ones. Below its threshold each row becomes a labelled
card, and every cell carries `data-label` so no column is silently dropped.

**Touch.** Inputs render at 16px on small screens, because anything smaller makes iOS Safari zoom
the page on focus and leave it scrolled sideways. Buttons hold a 44px minimum height on touch, and
standalone text links ("forgot password?", "portfolio ↗") grow their hit area under
`@media (pointer: coarse)` using padding cancelled by a negative margin, so the visual rhythm does
not change. Content clears the notch and home indicator through `env(safe-area-inset-*)`.

**Layout.** The wordmark drops below 400px and the mark carries the brand alone; navigation becomes
a scrollable pill row under `md`; the inquiry dialog is a full-width bottom sheet on a phone and a
centred dialog above `sm`; hero actions go full width and stack; statistics sit two-up on a phone
rather than one tall column.

Verified by sweeping 320 to 1920px in a real browser: measuring `scrollWidth` against the viewport,
checking every table for overflow inside its own card, asserting that each column shares a pixel
edge across all rows, and flagging any interactive element under 32px tall. Both themes and both
languages were checked visually at phone, tablet and desktop size.
