import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const parseSlackSlashCommandCode = `__PARSE_SLACK_SLASH_COMMAND__`;
const buildSlackFollowupCode = `__BUILD_SLACK_FOLLOWUP__`;

const slackSlashWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Slack Slash Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'pii/slack',
      responseMode: 'responseNode',
      authentication: 'none',
      options: {},
    },
  },
  output: [
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      params: {},
      query: {},
      body: {
        token: 'verification-token-placeholder',
        team_id: 'T00000000',
        team_domain: 'example',
        channel_id: 'C00000000',
        channel_name: 'research',
        user_id: 'U00000000',
        user_name: 'joseluis',
        command: '/pii',
        text: 'REGN NASDAQ',
        response_url:
          'https://hooks.slack.com/commands/T00000000/0000000000/example',
        trigger_id: '0000000000.0000000000',
      },
    },
  ],
});

const parseSlackSlashCommand = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Slack Slash Command',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: parseSlackSlashCommandCode,
    },
  },
  output: [
    {
      valid: true,
      ticker: 'REGN',
      exchange: 'NASDAQ',
      research_question: 'Does the current evidence justify deeper research?',
      mode: 'FULL',
      requested_by: 'slack:joseluis',
      configuration_version: 'v1',
      force_refresh: false,
      command: '/pii',
      raw_text: 'REGN NASDAQ',
      user_name: 'joseluis',
      user_id: 'U00000000',
      channel_id: 'C00000000',
      response_url:
        'https://hooks.slack.com/commands/T00000000/0000000000/example',
      trigger_id: '0000000000.0000000000',
      slack_immediate: {
        response_type: 'ephemeral',
        text: 'Starting investigation for *REGN* on *NASDAQ*…',
      },
      n8n_execution_id: '1',
    },
  ],
});

const parseValid = ifElse({
  version: 2.3,
  config: {
    name: 'Parse Valid?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.valid }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const respondUsageError = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Usage Error',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ $json.slack_immediate }}'),
      options: {
        responseCode: 200,
      },
    },
  },
  output: [
    {
      response_type: 'ephemeral',
      text: 'Could not start investigation.',
    },
  ],
});

const respondImmediateAck = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Immediate Ack',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ $json.slack_immediate }}'),
      options: {
        responseCode: 200,
      },
    },
  },
  output: [
    {
      valid: true,
      ticker: 'REGN',
      exchange: 'NASDAQ',
      research_question: 'Does the current evidence justify deeper research?',
      mode: 'FULL',
      requested_by: 'slack:joseluis',
      configuration_version: 'v1',
      force_refresh: false,
      response_url:
        'https://hooks.slack.com/commands/T00000000/0000000000/example',
      slack_immediate: {
        response_type: 'ephemeral',
        text: 'Starting investigation for *REGN* on *NASDAQ*…',
      },
    },
  ],
});

const postInvestigateRequest = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Post Investigate Request',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: 'https://teacherjoseluis.app.n8n.cloud/webhook/pii/investigate',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ ({ ticker: $json.ticker, exchange: $json.exchange, research_question: $json.research_question, mode: $json.mode, requested_by: $json.requested_by, configuration_version: $json.configuration_version, force_refresh: $json.force_refresh, request_context: $json.request_context }) }}',
      ),
      options: {
        response: {
          response: {
            neverError: true,
          },
        },
      },
    },
    credentials: {
      httpHeaderAuth: newCredential('PII Webhook Header Auth'),
    },
  },
  output: [
    {
      case_id: 'a732aa53-a065-4682-b062-5173e2e4f88d',
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      ticker: 'REGN',
      state: 'REQUESTED',
      created: true,
      message: 'Investigation case created. Processing continues asynchronously.',
      as_of: '2026-09-14T23:00:00.000Z',
    },
  ],
});

const buildSlackFollowup = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Slack Follow-up',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildSlackFollowupCode,
    },
  },
  output: [
    {
      outcome: 'ACKED',
      valid: true,
      ticker: 'REGN',
      exchange: 'NASDAQ',
      case_id: 'a732aa53-a065-4682-b062-5173e2e4f88d',
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      state: 'REQUESTED',
      created: true,
      response_url:
        'https://hooks.slack.com/commands/T00000000/0000000000/example',
      user_name: 'joseluis',
      channel_id: 'C00000000',
      slack_followup: {
        response_type: 'ephemeral',
        text: 'Investigation created for *REGN*.',
      },
      n8n_execution_id: '1',
    },
  ],
});

const hasResponseUrl = ifElse({
  version: 2.3,
  config: {
    name: 'Has Response URL?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.response_url }}'),
            operator: { type: 'string', operation: 'exists' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const postSlackFollowup = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Post Slack Follow-up',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.response_url }}'),
      authentication: 'none',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.slack_followup }}'),
      options: {
        response: {
          response: {
            neverError: true,
          },
        },
      },
    },
  },
  output: [
    {
      ok: true,
    },
  ],
});

const slackIntakeDone = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Slack Intake Done',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'done',
            name: 'slack_intake_done',
            value: true,
            type: 'boolean',
          },
        ],
      },
    },
  },
  output: [
    {
      outcome: 'ACKED',
      ticker: 'REGN',
      slack_intake_done: true,
    },
  ],
});

const flowNote = sticky(
  '## PII Slack Intake\nSlash `/pii TICKER [EXCHANGE] [question]` → ack Slack ≤3s → POST PII-00 → follow-up via response_url.\nStandalone. Not wired into PII-00.',
  [slackSlashWebhook, parseSlackSlashCommand, postInvestigateRequest],
  { color: 4 },
);

const opsNote = sticky(
  '## Deploy notes\n1. Publish this workflow + PII-00.\n2. Slack Slash Command Request URL = production webhook `/webhook/pii/slack`.\n3. Credential: PII Webhook Header Auth (outbound to investigate).\nSlack PII bot token is optional here (response_url path).',
  [respondImmediateAck, buildSlackFollowup, postSlackFollowup],
  { color: 5 },
);

export default workflow('pii-slack-intake', 'PII Slack Intake')
  .add(slackSlashWebhook)
  .to(parseSlackSlashCommand)
  .to(
    parseValid
      .onFalse(respondUsageError)
      .onTrue(
        respondImmediateAck
          .to(postInvestigateRequest)
          .to(buildSlackFollowup)
          .to(
            hasResponseUrl
              .onTrue(postSlackFollowup.to(slackIntakeDone))
              .onFalse(slackIntakeDone),
          ),
      ),
  )
  .add(flowNote)
  .add(opsNote);
