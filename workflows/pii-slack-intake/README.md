# PII Slack Intake

Thin Slack slash-command front door for PII-00. Parses `/pii TICKER [EXCHANGE] [question]`, acks Slack within 3 seconds, POSTs the investigation JSON to PII-00, then posts a follow-up via Slack `response_url`.

Standalone Phase 1 slice — **not wired into PII-00**.

## Slash command

| Text | Result |
|---|---|
| `/pii REGN` | ticker `REGN`, exchange `NASDAQ` (default) |
| `/pii REGN NYSE` | ticker + exchange |
| `/pii REGN NASDAQ cash runway?` | ticker + exchange + research question |
| `/pii` | ephemeral usage help |

## Endpoint

- **Method:** `POST`
- **Path:** `/webhook/pii/slack`
- **Auth:** none on inbound (Slack slash commands cannot send `X-PII-API-Key`)
- **Outbound:** HTTP POST to `/webhook/pii/investigate` using credential **`PII Webhook Header Auth`**

Production URL for Slack Slash Command Request URL:

`https://teacherjoseluis.app.n8n.cloud/webhook/pii/slack`

## Behavior

1. Receive Slack form-urlencoded slash payload
2. Parse ticker / exchange / question
3. `Respond to Webhook` immediately (`response_type: ephemeral`)
4. POST investigation body to PII-00 (**includes `request_context.slack`** for later PII-15 DM)
5. POST follow-up to `response_url` with `case_id` or failure detail

Completion DM after PII-11 is handled by **PII-15** (separate workflow; needs deploy).

## Credentials

- **PII Webhook Header Auth** — required (calls PII-00)
- **Slack PII bot** — optional for this slice (follow-up uses `response_url`)

## Regenerate

```bash
npm run bundle:pii-slack
```

## Deploy

Deployed **published**: workflow `Co5hmZSuqqk97rhg`, version `ea286637-10af-4dd0-9fcd-18e825878c47`. Credential: **PII Webhook Header Auth**. `callerPolicy=workflowsFromSameOwner`. Canvas: https://teacherjoseluis.app.n8n.cloud/workflow/Co5hmZSuqqk97rhg

PII-00…PII-11 published so `/webhook/pii/investigate` accepts Slack outbound POSTs.

## Smoke

1. Slack app → Slash Commands → `/pii` → Request URL = `https://teacherjoseluis.app.n8n.cloud/webhook/pii/slack`
2. In Slack: `/pii REGN`
3. Expect ephemeral ack, then follow-up with `case_id`
