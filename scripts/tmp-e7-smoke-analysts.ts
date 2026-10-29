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

const prepareCase = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Prepare REGN Case ANALYZING',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE research_cases SET state = 'ANALYZING', updated_at = NOW() WHERE id = '${CASE_ID}'::uuid RETURNING id AS case_id, state, ticker, exchange, company_id`,
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

const set08 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set PII-08 Inputs',
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
});

const run08 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-08',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '1PuOVYf0O3GThRwq',
        cachedResultName: 'PII-08 Valuation and Market Analyst',
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
});

const set09 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set PII-09 Inputs',
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
});

const run09 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-09',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'mioSWLKBMLAaBGzs',
        cachedResultName: 'PII-09 Risk and Red-Team Reviewer',
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
});

const set04 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set PII-04 Inputs',
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
});

const run04 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-04',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'RvIlyuDV0MEsXezL',
        cachedResultName: 'PII-04 Financial and Business Analyst',
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
});

export default workflow('tmp-e7-smoke-analysts', 'TMP E7 Smoke Analysts REGN')
  .add(manual)
  .to(prepareCase)
  .to(set08)
  .to(run08)
  .to(set09)
  .to(run09)
  .to(set04)
  .to(run04);
