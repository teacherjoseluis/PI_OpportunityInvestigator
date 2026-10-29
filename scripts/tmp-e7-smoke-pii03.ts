import {
  workflow,
  node,
  trigger,
  expr,
  newCredential,
} from '@n8n/workflow-sdk';

const CASE_ID = 'a87fa88d-2508-4150-b01f-da7f03a6d8c0';

const manual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: {
    name: 'Manual Trigger',
    parameters: {},
  },
});

const check022 = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Check Migration 022 Soft-Close Copy',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: `SELECT
  id,
  version_label,
  (
    SELECT elem->>'text'
    FROM jsonb_array_elements(COALESCE(gates_json->'analysis'->'valuation'->'insufficient_topics','[]'::jsonb)) elem
    WHERE elem->>'key' = 'net_cash_debt'
    LIMIT 1
  ) AS net_cash_debt_text,
  (
    SELECT elem->>'text'
    FROM jsonb_array_elements(COALESCE(gates_json->'analysis'->'risk'->'insufficient_topics','[]'::jsonb)) elem
    WHERE elem->>'key' = 'financial_financing_depth'
    LIMIT 1
  ) AS financing_depth_text,
  (
    SELECT elem->>'text'
    FROM jsonb_array_elements(COALESCE(gates_json->'analysis'->'financial'->'insufficient_topics','[]'::jsonb)) elem
    WHERE elem->>'key' = 'dilution'
    LIMIT 1
  ) AS dilution_text
FROM configuration_versions
WHERE is_active = TRUE
LIMIT 1`,
      options: {
        queryReplacement: '',
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareCase = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Prepare REGN Case COLLECTING',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE research_cases SET state = 'COLLECTING', updated_at = NOW() WHERE id = '${CASE_ID}'::uuid RETURNING id AS case_id, state, ticker, exchange, company_id`,
      options: {
        queryReplacement: '',
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const setInputs = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set Smoke Inputs',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: CASE_ID,
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: 'REGN',
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: 'NASDAQ',
            type: 'string',
          },
        ],
      },
      options: {},
    },
  },
});

const runPii03 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'IqoALspzvN3PL5Cq',
        cachedResultName: 'PII-03 Evidence Collector',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $json.case_id }}'),
          ticker: expr('{{ $json.ticker }}'),
          exchange: expr('{{ $json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const countChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Count Evidence Chunks By Source',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: `SELECT ed.source_type, COUNT(DISTINCT ed.id) AS docs, COUNT(ec.id) AS chunks
FROM evidence_documents ed
LEFT JOIN evidence_chunks ec ON ec.evidence_id = ed.id
WHERE ed.case_id = '${CASE_ID}'::uuid
  AND ed.source_type IN (
    'finnhub_company_news',
    'uspto_patent',
    'fda_drugsfda',
    'sec_edgar_filing',
    'sec_edgar_submissions',
    'clinicaltrials_gov',
    'sec_companyfacts'
  )
GROUP BY ed.source_type
ORDER BY ed.source_type`,
      options: {
        queryReplacement: '',
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

export default workflow('tmp-e7-smoke-pii03', 'TMP E7 Smoke PII-03 REGN')
  .add(manual)
  .to(check022)
  .to(prepareCase)
  .to(setInputs)
  .to(runPii03)
  .to(countChunks);
