# Discovery slice D0 — weekly candidate lead list

First, easy approach for product **UC-02** (discover candidates). Live status and deploy IDs stay in [`AGENTS.md`](../AGENTS.md). Parent product rules: [`PHARMA_INVESTMENT_OPPORTUNITY_INVESTIGATOR.md`](../PHARMA_INVESTMENT_OPPORTUNITY_INVESTIGATOR.md) (§4 UC-02, §17.1 email, §23 Phase 3).

This document is the implementation contract for **slice D0 only**. Later slices (market-cap screen, event ranking, auto-escalate to PII-00) are out of scope until D0 is signed off.

## Purpose

Once a week, email a short list of **listed US issuers whose SEC legal name looks pharma/biotech-like**, excluding tickers already investigated recently.

The owner reads the list, checks names they care about, and starts a full investigation **manually** with Slack `/pii TICKER` (or the existing investigate webhook). That reuses PII-00…PII-15 unchanged.

D0 does **not** decide that a company is a good investment. It only proposes tickers worth a look.

## User journey (the whole point)

```text
Sunday job  →  email with 0–N tickers  →  owner skims
                                          │
                                          ├─ ignore
                                          └─ /pii TICKER  →  existing full investigation
```

There is no approve button in D0. The existing slash command **is** the approval.

## Non-goals (D0)

- Do not call PII-00, PII-01…PII-15, or create a `research_cases` row.
- Do not hit TwelveData, Finnhub, USPTO, CourtListener, openFDA, or CT.gov.
- Do not score, rank by “quality,” estimate market cap, or detect catalysts.
- Do not auto-investigate the top name to fill a weekly quota.
- Do not scrape IR sites or parse filing HTML.
- Do not use an LLM to pick or describe candidates.
- Do not lower keyword/exchange rules because the list looks short.

If the filters yield zero names, the email must say so. That is a successful research outcome, not a failure.

## What D0 is allowed to use

| Input | Why it is cheap |
|---|---|
| SEC `company_tickers_exchange.json` | One public file; PII-01 already fetches and parses it |
| `config/eligibility.v1.json` exchanges + name keywords + SPAC patterns | Already the owner’s universe language |
| `research_cases` last 30 days | Same duplicate idea as PII-02 `duplicate_recent_case` |
| SMTP account | Same mailbox as investigation reports |

## Success definition

D0 is done when:

1. A **manual** hosted run produces one email to `teacherjoseluis@gmail.com`.
2. Each emailed row is enough to act: **ticker, exchange, SEC legal name, CIK**, plus the keyword(s) that matched.
3. The body tells the owner exactly how to investigate: `/pii TICKER`.
4. Tickers with a recent non-failed, non-superseded `research_cases` row are absent.
5. A failed SEC download does **not** send a “no candidates” research email (that would hide an outage).
6. The owner can `/pii` one listed ticker and the existing full chain runs as today.

Sign-off is the owner using the list that way once. After sign-off, a weekly schedule may be enabled.

---

## Workflow

**Name:** `PII-16 Discovery Digest`  
**Layout:** `workflows/pii-16-discovery/` (SDK source + bundle, same as other PII workflows)  
**Kind:** standalone. Not wired into PII-00.  
**Triggers (D0):**

1. Manual / Execute Workflow Trigger (required for smoke).
2. Schedule Trigger, **disabled** until the owner signs off D0.

Do not add a public webhook for D0.

### Node graph (logical)

```text
Trigger
  → Fetch SEC company_tickers_exchange.json   (HTTP, SEC Fair Access User-Agent)
  → Normalize + filter (Code, runOnceForAllItems)  → one item, not one item per issuer
  → Load recent investigation tickers (Postgres, one jsonb row)
  → Apply exclusions, rank, cap (Code)
  → Persist discovery_runs + discovery_candidates (Postgres)
  → Send SMTP digest
  → Log workflow_runs PII-16
```

Reuse PII-01’s EDGAR row parser and exchange aliases (`resolve-edgar-identity.js` `extractRows` / `EXCHANGE_ALIASES`). Do not copy-paste a second SEC parser; extract shared helpers if bundling requires it.

**Hard engineering rule:** the SEC file has thousands of issuers. Postgres `executeQuery` and Code nodes must **never** emit one n8n item per issuer (that is the PII-10/PII-11 OOM pattern). Every load after fetch is a single packed item (`candidates_json`, `recent_tickers_json`). `executeOnce` on Postgres loads.

---

## Universe and filters

### Source

- URL: `https://www.sec.gov/files/company_tickers_exchange.json`
- Format: `{ fields: ["cik","name","ticker","exchange"], data: [[...], ...] }` (same as PII-01).
- SEC Fair Access: HTTP User-Agent must include a descriptive product name **and** a contact email (same policy as PII-01).
- One GET per run. No pagination.

If the HTTP node fails, times out, or the payload has no usable rows → run outcome `SOURCE_FAILED`. Persist the run. Send an **ops** email (or skip email and rely on `workflow_runs` + owner checking the execution). Do **not** send the research digest with “no qualifying candidates.”

### Keep a row only if all of these pass

1. **Ticker** present after trim; normalize to uppercase.
2. **Exchange** matches configured `allowed_exchanges` using PII-01 alias equality (NASDAQ includes NASDAQ/NMS etc.; NYSE American counts as AMEX). Default exchanges: `NYSE`, `NASDAQ`, `AMEX` from eligibility config.
3. **Legal name** (SEC `name`) contains at least one configured **industry keyword** as a substring, after uppercasing the name. Default keywords from eligibility: `PHARMA`, `BIOTECH`, `BIOLOG`, `THERAPEUTIC`, `ONCOLOG`, `GENOM`.
4. **Not a shell/SPAC name** using eligibility `shell_name_patterns` (substring, uppercase).
5. **Not on** `never_show_tickers` (optional config; default empty).
6. **Not recently investigated** (below).

No industry or sector field exists on this SEC file. Keyword-on-name is the entire “is this pharma?” check. That will miss some real biotechs whose legal names lack those tokens, and will include some non-drug firms whose names happen to match (`BIOLOG` → biological, etc.). D0 accepts that noise. The owner is the next filter.

### Recently investigated (same spirit as PII-02)

Exclude ticker `T` if:

```sql
SELECT DISTINCT UPPER(TRIM(ticker)) AS ticker
FROM research_cases
WHERE created_at >= NOW() - make_interval(days => :lookback_days)
  AND state NOT IN ('FAILED', 'SUPERSEDED');
```

Default `lookback_days` = 30 (`eligibility.v1.json` `duplicate_lookback_days`).

`FAILED` and `SUPERSEDED` do **not** hide a ticker. A superseded GALT may appear again, which is correct after an owner-requested re-run.

Exchange is not required for this exclusion: if any recent case used the ticker, drop it. Keep the query as **one** `jsonb_agg` of tickers, not one item per case.

### Ranking and cap

After filters, sort by:

1. Number of distinct keyword hits (descending).
2. Ticker (ascending).

Then take at most `max_email_candidates` (default **25**).

This cap is **display only**. It does not invent extra names if fewer than 25 match. Funnel counts in the email always use the **pre-cap** matched count.

Do not randomize. Do not boost names to “make the email interesting.”

### Deduping the SEC file

If the file lists the same ticker more than once (dual-class / multiple rows), keep one row: prefer an exchange in `allowed_exchanges`, then the first row. One email line per ticker.

---

## Persistence

New tables (migration, e.g. `025_discovery_digest_v1.sql`). Do not reuse `research_cases` for leads.

### `discovery_runs`

| Column | Meaning |
|---|---|
| `id` | UUID PK |
| `started_at` / `finished_at` | timestamptz |
| `status` | `SUCCEEDED` \| `SOURCE_FAILED` \| `EMAIL_FAILED` |
| `outcome` | `CANDIDATES` \| `NO_CANDIDATES` \| `SOURCE_FAILED` |
| `sec_row_count` | issuers parsed |
| `matched_count` | after name/exchange/shell/never-show, **before** recent-case exclusion |
| `excluded_recent_count` | dropped for recent cases |
| `candidate_count` | after all filters, **before** email cap |
| `emailed_count` | rows in the email body (≤ cap) |
| `lookback_days` | int used this run |
| `configuration_version_id` | active config, if available |
| `n8n_execution_id` | text |
| `error_summary` | text, nullable |
| `metadata_json` | funnel extras, keyword version, source URL |

Exactly one row per execution.

### `discovery_candidates`

| Column | Meaning |
|---|---|
| `id` | UUID PK |
| `discovery_run_id` | FK |
| `ticker` | text, uppercase |
| `exchange` | normalized exchange label from SEC (as stored) |
| `legal_name` | SEC `name` |
| `cik` | 10-digit padded CIK |
| `matched_keywords` | text[] or jsonb array |
| `keyword_hit_count` | int |
| `excluded_reason` | null if emailed / listed as a candidate; or `recent_case` / `capped` if we persist excluded rows |

D0 may persist **only the emailed candidates** (simplest). Optionally also persist capped-out matches with `excluded_reason = 'capped'` so the owner can query “what did we drop?”. Do not persist the entire SEC universe.

No foreign key to `research_cases`. When the owner later `/pii TICKER`, that is a new case as today.

### `workflow_runs`

Insert `workflow_key = 'PII-16'`, `SUCCEEDED` or failed, with funnel counts in `metadata_json`.

### `email_deliveries`

Reuse the existing table if a `case_id` is nullable; if `case_id` is required, either:

- allow null `case_id` for discovery (preferred, small migration), or
- store `discovery_run_id` in `metadata_json` with `case_id` null if the schema already allows it.

Dedupe key: `discovery:DIGEST:<UTC calendar week>` (example `discovery:DIGEST:2026-W38`) so a retry the same week does not send a second success digest. A `SOURCE_FAILED` ops mail uses a different key (`discovery:SOURCE_FAILED:<execution_id>`) and is not a substitute for the weekly digest.

---

## Email (the only user-facing output)

**Credential:** `SMTP account` (same as PII-14).  
**From / to (D0):** `teacherjoseluis@gmail.com` unless config overrides.  
**One email per successful run**, including zero candidates.

### Subject

- If `candidate_count == 0`:  
  `Pharma Opportunity Investigator — No qualifying new candidates this week`
- Else:  
  `Pharma Opportunity Investigator — N discovery candidates this week`  
  (`N` = `emailed_count`; if `candidate_count > emailed_count`, still use emailed_count in the subject and explain the cap in the body.)

Prefix is **not** `[PII DRAFT]` and **not** `[PII Report]`. This is not an investigation report.

### Body (required fields)

Plain-language header:

- As-of timestamp (UTC).
- Funnel: SEC rows parsed → exchange kept → keyword kept → shell dropped → never-show dropped → recent-case dropped → **candidates** → **emailed**.
- Lookback days.
- Sentence: **This is a lead list from SEC names, not a recommendation. It does not run analysis.**
- Sentence: **To investigate one name, reply in Slack with** `/pii TICKER` **(exchange optional).** Same as today.

If `candidate_count == 0`, stop after the funnel. Do not invent a “closest miss.”

If `candidate_count > 0`, a table/list, one line per emailed candidate:

`TICKER | EXCHANGE | Legal name | CIK | matched: KEYWORD, …`

Optional footer: “N additional name(s) matched but were omitted by the 25-name cap.” Only if true.

Disclaimer one-liner (research aid, not advice) consistent with PII-14.

HTML table is fine for mail clients; include a text alternative.

### What the owner does next

1. Skim legal names.
2. Optionally check a ticker on the SEC site / Yahoo / whatever they already use. D0 does not require that.
3. If they want the **detailed flow**: `/pii TICKER` or POST `/webhook/pii/investigate`.

D0 must not include a “run investigation” webhook link that fires PII-00 without the owner’s existing authenticated intake.

---

## Configuration

New file `config/discovery.v1.json`, merged into `configuration_versions.gates_json.discovery` (migration; `jsonb_set` like other slices).

```json
{
  "enabled": true,
  "schedule": "0 14 * * 0",
  "timezone": "America/Denver",
  "sec_tickers_url": "https://www.sec.gov/files/company_tickers_exchange.json",
  "allowed_exchanges": ["NYSE", "NASDAQ", "AMEX"],
  "industry_keywords": ["PHARMA", "BIOTECH", "BIOLOG", "THERAPEUTIC", "ONCOLOG", "GENOM"],
  "shell_name_patterns": ["SPAC", "BLANK CHECK", "ACQUISITION CORP", "ACQUISITION CORPORATION", "ACQUISITION CO", "SHELL COMPANY"],
  "never_show_tickers": [],
  "duplicate_lookback_days": 30,
  "max_email_candidates": 25,
  "recipient": "teacherjoseluis@gmail.com",
  "from_email": "teacherjoseluis@gmail.com"
}
```

D0 defaults copy eligibility lists so the owner does not maintain two universes. If eligibility keywords later change, discovery should read **discovery config** (snapshot on the run row), not silently drift mid-week.

`never_show_tickers`: uppercase tickers the owner never wants in the digest (empty at launch).

Schedule cron is documentation for the n8n Schedule node. **Do not activate it until D0 sign-off.** Weekly is a research cadence, not a quota.

---

## Credentials (names only)

- `Postgres account`
- `SMTP account`
- SEC HTTP: no API key; User-Agent header only (same Fair Access pattern as PII-01 / PII-03)

---

## Failure and honesty rules

| Situation | Digest email? | Run status |
|---|---|---|
| SEC fetch/parse fails | No research digest. Optional short ops mail. | `SOURCE_FAILED` |
| Zero candidates after filters | Yes, “no qualifying new candidates,” with funnel counts | `SUCCEEDED` / `NO_CANDIDATES` |
| SMTP fails after persist | No second silent success | `EMAIL_FAILED` |
| Same calendar week retry after `SENT` | Skip send (`SKIPPED_DUPLICATE`) | still log the skip |

Never present the “best” rejected name as a stand-in recommendation.

---

## Tests (local, before any deploy)

Unit tests on pure functions (no n8n):

- Parse SEC `{fields,data}` fixture (reuse PII-01 fixtures if present).
- Exchange alias keep/drop.
- Keyword substring match; shell drop; never-show drop.
- Recent-ticker exclusion.
- Cap: 3 matches → 3 emailed; 40 matches → 25 emailed, `candidate_count=40`.
- Dual rows for one ticker → one candidate.
- Zero matches → `NO_CANDIDATES` payload, not an error.

`npm test` and `npm run bundle:pii-16`.

---

## Hosted validation (after explicit deploy)

1. Apply VPS migration.
2. Deploy PII-16 **inactive**, schedule off.
3. Manual execute once.
4. Confirm one email, funnel counts, Postgres `discovery_runs` + candidates, `workflow_runs` PII-16.
5. Confirm a ticker from the email is absent from recent open cases.
6. Owner `/pii` one emailed ticker; PII-00 proceeds as a normal new case.
7. Only then consider enabling the weekly schedule.

Do not run D0 against REGN/GALT as a special path. The point is a **new** name on the list.

---

## Explicitly later (not D0)

| Slice | Adds | Why wait |
|---|---|---|
| D1 | Finnhub/TwelveData cap + ADV/mcap on a **capped** subset | Quota and 403s; not needed for a lead list |
| D2 | Event hint (new 8-K / CT.gov) | Noise; PII-12 already showed false “new studies” |
| D3 | Slack “investigate?” button or auto PII-00 | Easy to wire, easy to blow budget/memory |

D0 is successful if the owner sometimes runs `/pii` from the email and sometimes ignores it.

---

## Implementation checklist (when building)

1. `config/discovery.v1.json` + migration `025` (`discovery_runs`, `discovery_candidates`, `gates_json.discovery`, email `case_id` nullability if needed).
2. Shared Code: SEC filter + funnel (packed JSON in / JSON out).
3. `workflows/pii-16-discovery/` template, bundle, README.
4. Unit tests.
5. Deploy only when the owner says deploy.
6. One manual hosted run + email sign-off.
7. Record workflow ID and execution ID in `AGENTS.md`.
