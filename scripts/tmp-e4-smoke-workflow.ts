import {
  workflow,
  node,
  trigger,
  expr,
  newCredential,
} from '@n8n/workflow-sdk';

const manual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: {
    name: 'Manual Trigger',
    parameters: {},
  },
});

const applyE4Config = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Apply E4 Config 019',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE configuration_versions SET gates_json = jsonb_set(jsonb_set(COALESCE(gates_json, '{}'::jsonb), '{collection,collectors,fda_openfda}', jsonb_build_object('enabled', true, 'description', 'Slice E4 openFDA Drugs@FDA compact', 'mode', 'drugsfda_compact', 'limit', 25), true), '{collection,openfda_limit}', '25'::jsonb, true), updated_at = NOW() WHERE is_active = TRUE RETURNING id, version_label, gates_json->'collection'->'collectors'->'fda_openfda' AS fda_openfda",
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
      query:
        "UPDATE research_cases SET state = 'COLLECTING', updated_at = NOW() WHERE id = 'a87fa88d-2508-4150-b01f-da7f03a6d8c0'::uuid RETURNING id AS case_id, state, ticker, exchange, company_id",
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
            value: 'a87fa88d-2508-4150-b01f-da7f03a6d8c0',
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

const setInputs07 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set PII-07 Inputs',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: 'a87fa88d-2508-4150-b01f-da7f03a6d8c0',
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

const runPii07 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-07',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '4AqBDr5hjZeMLy99',
        cachedResultName: 'PII-07 Regulatory and Catalyst Analyst',
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

export default workflow('tmp-e4-smoke', 'TMP E4 Smoke REGN')
  .add(manual)
  .to(applyE4Config)
  .to(prepareCase)
  .to(setInputs)
  .to(runPii03)
  .to(setInputs07)
  .to(runPii07);
