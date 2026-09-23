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
| PDF | `@react-pdf/renderer` — no headless browser, so it fits in a serverless function |
| i18n | `next-intl`, `dir="rtl"` + logical CSS properties |
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

All use the password `Sinemai!2026`:

| Email | Role |
| --- | --- |
| `admin@sinemai.ai` | ADMIN |
| `producer@sinemai.ai` | PRODUCER |
| `vendor.riyadh@sinemai.ai` · `vendor.jeddah@sinemai.ai` | VENDOR (approved, with inventory) |
| `dop.faisal@sinemai.ai` … `dop.tariq@sinemai.ai` | DOP (approved, 5 profiles) |

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

### Streaming

`POST /api/projects/:id/analyze` streams newline-delimited JSON progress events
(`parsing → analyzing_scenes → matching_equipment → matching_dops → pricing → reviewing → saving`)
which the client renders as a live stage list.

### Testing the pipeline

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
5. The analyze route declares `maxDuration = 300`. Feature-length scripts need
   **Fluid Compute / a plan that allows long function durations**. If a run ever outgrows it, the
   orchestrator's stages are already separable — split the agents into chained functions or put
   them behind a queue (Upstash QStash) without touching agent logic.

---

## Known limits, deliberately

- **The PDF is English/Latin.** `@react-pdf/renderer` does not shape Arabic script without an
  embedded Arabic font with ligature support. Register one via `Font.register` in
  [`src/pdf/sheet-document.tsx`](src/pdf/sheet-document.tsx) to enable an Arabic export; a
  silently mis-rendered Arabic sheet would be worse than an English one.
- **Indicative day rates are placeholders.** They exist so a sheet can still be costed when a
  needed item has no vendor. Real prices come from vendor onboarding.
- **Proximity is a soft signal.** Same-city DOPs and vendors get a small ranking nudge, never a
  hard filter — Saudi crews travel between cities routinely.
- **Scene numbers per scene are estimates.** Page eighths come from line counts, not from a
  paginated layout engine, so they approximate rather than replace a scheduling package.
- **Aerial work needs permits.** The catalog notes GACA permits for drone platforms; lead time is
  not modelled in the budget.
