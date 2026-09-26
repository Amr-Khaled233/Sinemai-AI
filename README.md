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
| Email | Gmail SMTP with an App Password via `nodemailer` (falls back to console logging in dev) |
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

`db:setup` is migrations followed by the seed:

```bash
npm run db:deploy   # applies prisma/migrations — includes the pgvector extension and HNSW index
npm run db:seed     # catalog, crew rates, style tags, launch partners, demo accounts
```

The schema is versioned as a migration history rather than pushed, so production
has a record of what changed and a path back. Change the schema with
`npm run db:migrate`, which writes a new migration; deploy applies them in order.

An existing database created with the old `db push` flow is adopted with
`npm run db:baseline`, which marks the initial migration as already applied
instead of trying to recreate tables that are already there.

The history is covered by a test: `tests/migration.test.ts` applies every migration to a
real Postgres running in-process, so a migration that would not apply fails locally rather
than at deploy time against the production database.

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
        ▼
Clarify step ............... askProducer → pauses the run until the producer
        │                    answers (or skips) what the brief leaves open
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

### Asking before guessing

Once the script is broken down and before anything is priced, the run checks whether the brief
leaves something open that would change the sheet: no shoot dates, a shoot window shorter than
the breakdown needs, drone scenes, special requirements, no visual direction at all. Code spots
those candidates ([`detectGaps`](src/agents/clarifications.ts)); a model decides which actually
matter for this production and, if any do, calls the `askProducer` tool
([`clarify-agent.ts`](src/agents/clarify-agent.ts)) with at most four questions.

The run then pauses at `AWAITING_INPUT` and the project page shows the questions, with
suggested answers where it is a choice. Every question carries the assumption the run will use
if it is left blank, so "skip" is always an option and a producer is never stuck. The answers go
into every agent after the pause — equipment, cinematographers, vendors, the reviewer and the
executive summary — as facts about the production.

A pause costs nothing while it waits: no request is made until the producer answers, the
nightly cleanup does not fail a paused run, and a failure in the clarify step itself just skips
it. The one-shot path (`runProductionAnalysis`, used by the smoke script) has nobody to ask, so it
goes with the assumptions.

### Answering in the reader's language

The run carries the locale the producer is actually reading, not the one stored on their
account, and every agent that writes prose for a human gets a language directive appended to
its system prompt ([`src/agents/language.ts`](src/agents/language.ts)). Equipment rationale,
cinematographer match reasons, sourcing caveats, reviewer findings and the executive summary
come back in Arabic on `/ar` and English on `/en`. Ids, enum values, numbers and equipment
model names stay exactly as the database has them — the UI translates those itself.

### Editing the package

The agents propose, the producer decides. Quantities and rental days are editable on the sheet,
items can be removed, and anything in the catalog can be added.

Saving does not re-run the agent graph: the script has not changed, so there is nothing for a
model to re-reason about. It re-queries vendor stock and crew rates and runs the same
`priceProject` the agent used — instant, free, and arithmetically identical to a generated
sheet, because both call one function. An edited sheet says so, since the reviewer signed off
on the version the agents produced.

### The shooting schedule

The sheet does not stop at a list of scenes. Scenes are grouped by call — day and night are
separate units, because a crew cannot shoot both in one twelve-hour day — then by location, and
filled into days up to the configured day length. Each day reports its locations, hours and page
count, and the schedule flags what a first AD would flag: a day that runs over its hours, a day
mixing day and night calls, company moves, and scenes carrying special requirements.

It is a planning aid, not a call sheet: it has no cast availability, no daylight table and no
travel times, so it is the starting point a scheduler edits rather than the final word.

### Version history

Every replacement of a sheet freezes the outgoing one first — a full re-analysis and a package
edit both snapshot into `RecommendationVersion` — so "what did that change actually cost" has an
answer. The compare view diffs a stored version against the live sheet: budget movement with a
direction (a saving is green), the package line by line as added, removed, changed or untouched,
and which cinematographers came and went. Snapshotting never fails the operation that triggered
it; a lost snapshot is a missing history entry, not a failed analysis.

### Spreadsheet export

`GET /api/projects/:id/xlsx` returns a six-tab workbook — overview, scenes, schedule, equipment,
vendors, budget — under the same access rules as the PDF: the owner, an admin, or anyone holding
a live share token. Production managers work in spreadsheets, and a PDF is something they retype.

Money is written as numbers with a currency format rather than as formatted strings, so the
budget column still sums in Excel. Tab names and headers follow the reader's locale.

### Producer insights

`/producer/insights` answers the questions a producer asks across projects rather than inside
one: how many sheets have been costed, what they total, the average budget, total shoot days,
the share of night work, which equipment keeps coming back and how many rental days it accounts
for, which cinematographers keep matching, and the budget band per project.

It is counted from the sheets themselves, with no separate analytics table, so it is exactly as
accurate as the sheets are — and a package edit shows up in it immediately.

### Rejoining a run

The analysis keeps going on the server whether or not the page is open, so a producer who
reloads or closes the tab rejoins the run in progress instead of seeing an idle button and
starting a second one. A short lease on `AnalysisState` decides who drives: the database picks
one client through a conditional update, and any other tab watches the checkpoint instead. If
the driver disappears its lease expires and a watcher takes over, so a run is never orphaned —
and the same step is never executed, or billed, twice.

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
npm test      # 192 unit tests, no database and no API calls
npm run verify  # typecheck + lint + tests + parser smoke, the pre-push gate
```

The suite covers the parts that are expensive to get wrong and cheap to check:
screenplay segmentation across Fountain, Final Draft, pasted briefs and Arabic headings; the
budget arithmetic (weekly rates, cheapest-vendor allocation, availability penalties, crew
totals, uncovered items); scene aggregation; schedule packing and its warnings; the version
diff; the workbook (generated, unzipped and its tab names asserted, because the library silently
ignored the wrong key once); the migration history applied end to end in an in-process Postgres;
and the security gates (HTML escaping, href scheme validation, the upload allow-list, error-code
hygiene).

Three of the suites audit the codebase rather than exercise it —
[access control](tests/access-control.test.ts), [message scopes](tests/i18n-scopes.test.ts) and the
error-code allow-list — because the failure they catch is an omission, and an omission has no test
of its own to fail. Each one found a real defect on the day it was written.

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
- `RecommendationVersion` is an append-only copy of a sheet as it stood before it was replaced,
  keyed `(projectId, version)` and stamped with why it was superseded (a re-analysis or a hand
  edit), which is what makes the compare view possible after the fact.
- `Setting`, `CrewRate`, `BudgetTierConfig`, `StyleTag` are admin-editable and read by the agents
  at run time — the budget is never hard-coded in the source.

---

## Deploying to Vercel

1. Create the project and attach Postgres (Vercel Postgres or Neon). Use the **pooled**
   connection string for `DATABASE_URL`.
2. Set the environment variables from `.env.example`, including `NEXTAUTH_URL` (your production
   URL), `NEXTAUTH_SECRET` (`openssl rand -base64 32`) and `CRON_SECRET`.
3. Apply the migrations and seed once against production, from your machine. Use the
   **direct** (non-pooled) connection string here — migrations take locks a pooler does not hold:
   `DATABASE_URL="<direct url>" npm run db:deploy`, then the same with `npm run db:seed`.
   Every later schema change is one more `npm run db:deploy` before (or right after) the push that
   ships it.
4. Deploy. `vercel.json` registers two cron jobs:
   - `/api/cron/reembed-dops` daily at 03:00 — re-embeds profiles edited since their last vector.
   - `/api/cron/availability-cleanup` at 03:30 — prunes old availability blocks and fails
     analyses left hanging by a timed-out function (a run paused on questions is left alone).
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
against the session (never a client-supplied id), and every route handler re-checks both. "The
owner, or an admin" is one predicate ([`mayReadProject`](src/lib/authz.ts)) rather than four copies
of an expression, and posting is deliberately not covered by it: an admin may read a producer's
sheet but does not send inquiries as them.

Share links are unguessable bearer tokens (144 bits), scoped to one project, revocable, expiring,
and compared in constant time. Both exports go through one gate —
[`src/lib/sheet-export.ts`](src/lib/sheet-export.ts) — so who may download a sheet cannot end up
meaning something different for the PDF than for the spreadsheet, which is exactly what two
hand-maintained copies of the check invited.

That the guards are *there* is checked mechanically: [`tests/access-control.test.ts`](tests/access-control.test.ts)
walks the action layer and every route handler, and fails on one that reaches for neither a session
nor a documented stand-in (a share token, the cron secret, NextAuth's own handler). A new action
cannot quietly ship without a guard.

**Injection and XSS.** Prisma parameterises everything, including the two raw pgvector queries,
whose vector literal is built from validated numbers. React escapes the UI, but three places bypass
it and are handled explicitly:

- **Email.** Every template lives in [`src/lib/email.ts`](src/lib/email.ts) and escapes every
  user-supplied field. One route used to build its HTML inline and interpolated the applicant's own
  name into it, which put working markup in the inbox of the account that approves listings — a
  phishing link in an email the admin already trusts. A test now fails on any `html:` template
  literal written outside that module.
- **Links.** Anything rendered as an `href` is scheme-checked: `z.string().url()` accepts
  `javascript:`, `data:` and `vbscript:`, which would otherwise be stored XSS through a
  cinematographer's portfolio links. The exports apply the same allow-list, so a hostile URL cannot
  ride out inside a PDF or a spreadsheet cell either.
- **Spreadsheet cells.** User text goes in as inline strings, never formulas, so a project named
  `=HYPERLINK(...)` opens as text in Excel instead of executing. Asserted by unzipping a generated
  workbook and checking no `<f>` element exists.

Uploads are extension- and MIME-checked with a size cap (no SVG or HTML into a public blob origin).

**Abuse and cost.** Rate limits live in Postgres, not memory, because serverless instances do not
share state and a caller could otherwise cycle instances to reset a counter. Sign-in, password
reset, registration, inquiries and — most importantly — analysis runs are all capped, since each
run spends real money on model calls.

Exports are capped too, which they were not: rendering a PDF is the heaviest thing the app does and
a share link is a URL anyone can replay, so the limit is per project and per caller (share token,
or IP). Checking whether a reset link is still live is capped as well — it answers a question about
a secret, so it does not stay a free oracle.

**What the browser is given.** Messages are scoped per area rather than shipped whole: the landing
page used to serialise all 23 KB of the catalog into its HTML, so an anonymous reader could read the
admin and vendor strings out of the page source. Now each area declares the namespaces its *client*
components need ([`src/i18n/scopes.ts`](src/i18n/scopes.ts)) and the shell carries three. The
landing page ships 1.3 KB and no admin strings.

The risk in scoping is a namespace someone forgets, so
[`tests/i18n-scopes.test.ts`](tests/i18n-scopes.test.ts) walks each page's real import graph, finds
the client components it renders, and fails if one asks for a namespace its area does not serve —
and also if an area serves one nothing under it uses. It found a real coupling immediately: the
cinematographer's profile imported a picker out of the producer's form module.

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
- **Five advisories remain, from two roots**: `postcss` bundled inside Next 15 (XSS in its CSS
  stringifier, file read via `sourceMappingURL`) and `deepmerge-ts` under the Prisma CLI (stack
  exhaustion). Both are build-time only — no request path reaches either, and the CSS and Prisma
  config they process are ours — and both need a major upgrade (Next 16 / Prisma 7) to clear.
  `npm audit` is therefore expected to be non-empty; read it, do not silence it.
- **Password policy is length-only** (8 characters). No breach-list check.
- **Agent logs store script text.** `AgentRun.input` keeps the prompts, which include scene
  content. That is what makes the pipeline debuggable; treat the table as customer data and set a
  retention policy.
- **Share tokens travel in the URL.** That is what makes a share link a link, but it means they
  reach proxy logs and browser history. They are revocable and expiring; treat a leaked link as a
  leaked sheet and revoke it.
- **`production-sheet.tsx` is still one 580-line component** of six independent cards. Splitting it
  is worthwhile and was left alone deliberately: without a database to render against, a JSX split
  that typechecks is not a split that has been seen to work.

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

---

## Errors and logging

Every server failure — in a page, a route handler or a server action — reaches one place:
Next's `onRequestError` hook in [`src/instrumentation.ts`](src/instrumentation.ts), plus the
`publicError` funnel that every server action already returns through.

Reports are written as one JSON object per line to stdout, which Vercel and every log pipeline
ingest as-is, and optionally POSTed to `ERROR_WEBHOOK_URL` (a Slack/Discord webhook or any
collector). Nothing here is tied to a vendor: swapping in Sentry means changing one function.

Two things matter more than the destination:

- **Every report carries a short reference** shown to the user in the error boundary, so a
  support message maps to exactly one log line.
- **Nothing secret is ever written.** Payloads passing through this code include prompts,
  connection strings and API keys, so values are pattern-redacted and any field *named* like a
  credential is dropped whatever it holds. This is covered by tests.

Failures are grouped by a fingerprint — the scope plus the message with ids, numbers and quoted
values stripped — so the same fault across a thousand projects reads as one problem. The hash is
FNV-1a rather than SHA-256 because it is a grouping key, not a signature, and the reporter has to
run in the edge runtime as well as in node.
