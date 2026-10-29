import { workflow, node, trigger, expr, newCredential } from '@n8n/workflow-sdk';

const CASE_ID = 'a87fa88d-2508-4150-b01f-da7f03a6d8c0';

const workflowInputs = {
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
};

const manual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Trigger', parameters: {} },
});

const prepareCase = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Prepare REGN Case COLLECTING',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE research_cases SET state = 'COLLECTING', updated_at = NOW() WHERE id = '${CASE_ID}'::uuid RETURNING id AS case_id, state, ticker, exchange, company_id`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ case_id: CASE_ID, ticker: 'REGN' }],
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

const runPii03 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03',
    executeOnce: true,
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'IqoALspzvN3PL5Cq',
        cachedResultName: 'PII-03 Evidence Collector',
      },
      workflowInputs,
      options: { waitForSubWorkflow: true },
    },
  },
  output: [{ outcome: 'ok' }],
});

const checkEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Check E8 Evidence',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query: `SELECT
  (SELECT COUNT(*) FROM evidence_documents WHERE case_id = '${CASE_ID}'::uuid AND source_type = 'courtlistener_docket') AS courtlistener_docs,
  (SELECT COUNT(*) FROM evidence_chunks ec JOIN evidence_documents ed ON ed.id = ec.evidence_id WHERE ed.case_id = '${CASE_ID}'::uuid AND ed.source_type = 'courtlistener_docket') AS courtlistener_chunks,
  (SELECT COUNT(*) FROM financial_metrics fm JOIN financial_periods fp ON fp.id = fm.financial_period_id WHERE fp.case_id = '${CASE_ID}'::uuid) AS metrics_count,
  (SELECT string_agg(DISTINCT fm.metric_key, ',') FROM financial_metrics fm JOIN financial_periods fp ON fp.id = fm.financial_period_id WHERE fp.case_id = '${CASE_ID}'::uuid AND fm.metric_key IN ('revenue','gross_profit','operating_income','operating_cash_flow','shares_outstanding','gross_margin','operating_margin','cash_burn','estimated_runway_months','cash','debt','net_cash')) AS metric_keys,
  (SELECT COUNT(*) FROM evidence_documents WHERE case_id = '${CASE_ID}'::uuid AND source_type = 'clinicaltrials_gov' AND metadata_json ? 'enrollment') AS ctgov_with_enrollment`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ courtlistener_docs: 1 }],
});

const resetInputs = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Reset Analyst Inputs',
    executeOnce: true,
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

const runPii04 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-04',
    executeOnce: true,
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'RvIlyuDV0MEsXezL',
        cachedResultName: 'PII-04 Financial and Business Analyst',
      },
      workflowInputs,
      options: { waitForSubWorkflow: true },
    },
  },
  output: [{ outcome: 'ok' }],
});

const runPii06 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-06',
    executeOnce: true,
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'b8CxYW8T8FrGl62x',
        cachedResultName: 'PII-06 Pipeline and Clinical Analyst',
      },
      workflowInputs,
      options: { waitForSubWorkflow: true },
    },
  },
  output: [{ outcome: 'ok' }],
});

const runPii09 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-09',
    executeOnce: true,
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'mioSWLKBMLAaBGzs',
        cachedResultName: 'PII-09 Risk and Red-Team Reviewer',
      },
      workflowInputs,
      options: { waitForSubWorkflow: true },
    },
  },
  output: [{ outcome: 'ok' }],
});

const runPii10 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-10',
    executeOnce: true,
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'lIjKOZS7qDizvynm',
        cachedResultName: 'PII-10 Scoring and Quality Gate',
      },
      workflowInputs,
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
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query: `SELECT
  (SELECT string_agg(claim_key, ',' ORDER BY claim_key) FROM claims WHERE case_id = '${CASE_ID}'::uuid AND claim_key IN ('margins','burn_runway','share_count','enrollment_inventory','litigation_docket_inventory','cash_debt')) AS e8_claim_keys,
  (SELECT jsonb_agg(DISTINCT claim_category) FROM claims WHERE case_id = '${CASE_ID}'::uuid AND claim_category IN ('business_financial','pipeline_clinical','risk_red_team')) AS categories,
  (SELECT business_quality_score FROM scores WHERE case_id = '${CASE_ID}'::uuid ORDER BY created_at DESC LIMIT 1) AS business_quality_score,
  (SELECT outcome_class FROM scores WHERE case_id = '${CASE_ID}'::uuid ORDER BY created_at DESC LIMIT 1) AS outcome_class`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ e8_claim_keys: 'margins' }],
});

export default workflow('tmp-e8-smoke', 'TMP E8 Smoke REGN Collect Analysts')
  .add(manual)
  .to(prepareCase)
  .to(setInputs)
  .to(runPii03)
  .to(checkEvidence)
  .to(resetInputs)
  .to(runPii04)
  .to(runPii06)
  .to(runPii09)
  .to(runPii10)
  .to(checkClaims);
