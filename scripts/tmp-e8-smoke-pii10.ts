import { workflow, node, trigger, expr, newCredential } from '@n8n/workflow-sdk';

const CASE_ID = 'a87fa88d-2508-4150-b01f-da7f03a6d8c0';

const manual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Trigger', parameters: {} },
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
          { id: 'case-id', name: 'case_id', value: CASE_ID, type: 'string' },
          { id: 'ticker', name: 'ticker', value: 'REGN', type: 'string' },
          { id: 'exchange', name: 'exchange', value: 'NASDAQ', type: 'string' },
        ],
      },
      options: {},
    },
  },
  output: [{ case_id: CASE_ID, ticker: 'REGN', exchange: 'NASDAQ' }],
});

const runPii10 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-10',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'lIjKOZS7qDizvynm',
        cachedResultName: 'PII-10 Scoring and Quality Gate',
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
      options: { waitForSubWorkflow: true },
    },
  },
  output: [{ outcome: 'ok' }],
});

const checkClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Check E8 Claims And Score',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: `SELECT
  (SELECT string_agg(claim_key, ',' ORDER BY claim_key) FROM claims WHERE case_id = '${CASE_ID}'::uuid AND claim_key IN ('margins','burn_runway','share_count','enrollment_inventory','litigation_docket_inventory','cash_debt')) AS e8_claim_keys,
  (SELECT business_quality_score FROM scores WHERE case_id = '${CASE_ID}'::uuid ORDER BY created_at DESC LIMIT 1) AS business_quality_score,
  (SELECT outcome_class FROM scores WHERE case_id = '${CASE_ID}'::uuid ORDER BY created_at DESC LIMIT 1) AS outcome_class,
  (SELECT gates_failed FROM scores WHERE case_id = '${CASE_ID}'::uuid ORDER BY created_at DESC LIMIT 1) AS gates_failed`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ e8_claim_keys: 'margins', business_quality_score: 1 }],
});

export default workflow('tmp-e8-smoke-pii10', 'TMP E8 Smoke PII-10 REGN')
  .add(manual)
  .to(setInputs)
  .to(runPii10)
  .to(checkClaims);
