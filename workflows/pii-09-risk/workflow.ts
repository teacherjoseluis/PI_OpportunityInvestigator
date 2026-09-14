import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateRiskRequestCode = `// Canonical source for PII-09 "Validate Risk Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const caseId = String(body.case_id || body.caseId || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) {
    errors.push('case_id is required and must be a UUID');
  }

  const ticker = String(body.ticker || '')
    .trim()
    .toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    errors.push('ticker is required and must be a valid symbol (1-10 chars, A-Z0-9.-)');
  }

  const exchange = String(body.exchange || 'NASDAQ')
    .trim()
    .toUpperCase();

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        outcome: 'FAILED',
        next_state: 'INCOMPLETE',
        reason: 'validation_failed',
      },
    });
    continue;
  }

  results.push({
    json: {
      valid: true,
      case_id: caseId,
      ticker,
      exchange,
      company_id: body.company_id || body.companyId || null,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const evaluateRiskRedTeamCode = `// Canonical source for PII-09 "Evaluate Risk Red Team" Code node.
// Deterministic risk/red-team signals from SEC + CT.gov metadata only (no invented risk scores).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function nodeAll(name) {
  try {
    return $(name).all().map((row) => row.json);
  } catch {
    return [];
  }
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function formMatches(form, watched) {
  const f = String(form || '').toUpperCase();
  return watched.some((w) => f === String(w).toUpperCase() || f.startsWith(String(w).toUpperCase()));
}

const validated = nodeJson('Validate Risk Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const risk =
  analysisRoot.risk ||
  validated.risk_config ||
  $input.first().json.risk_config ||
  {};

const watchedEventForms = Array.isArray(risk.watched_event_forms)
  ? risk.watched_event_forms
  : ['8-K', '6-K'];
const watchedOfferingForms = Array.isArray(risk.watched_offering_forms)
  ? risk.watched_offering_forms
  : ['S-3', '424B', '424B5', 'S-1'];
const adverseTrialStatuses = Array.isArray(risk.adverse_trial_statuses)
  ? risk.adverse_trial_statuses.map((s) => String(s).toUpperCase())
  : ['TERMINATED', 'WITHDRAWN', 'SUSPENDED'];
const minEvidence = Number(risk.min_evidence_documents ?? 1);
const minStructural = Number(risk.min_structural_claims ?? 1);
const claimCategory = risk.claim_category || 'risk_red_team';
const insufficientTopics = Array.isArray(risk.insufficient_topics)
  ? risk.insufficient_topics
  : [];

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const ticker = validated.ticker || caseRow.ticker;
const exchange = validated.exchange || caseRow.exchange;
const legalName = caseRow.legal_name || null;

let evidenceRows = nodeAll('Load Evidence Documents');
if (!evidenceRows.length) {
  const bundled = $input.first().json.evidence_documents;
  if (Array.isArray(bundled)) evidenceRows = bundled;
}

const filings = evidenceRows.filter((row) => row.source_type === 'sec_edgar_filing');
const trials = evidenceRows.filter((row) => row.source_type === 'clinicaltrials_gov');
const claims = [];

const periodic = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, ['10-K', '10-Q']),
);
if (periodic.length) {
  claims.push({
    topic_key: 'periodic_risk_factor_anchor',
    claim_text:
      'Periodic SEC reports (' +
      periodic.length +
      ' recent 10-K/10-Q in index) can anchor later Item 1A risk-factor and going-concern extraction once filing bodies are collected.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 85,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: periodic
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 2),
  });
}

const offering = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, watchedOfferingForms),
);
if (offering.length) {
  const forms = [
    ...new Set(offering.map((f) => parseMeta(f.metadata_json).form).filter(Boolean)),
  ];
  claims.push({
    topic_key: 'financing_dilution_risk_signal',
    claim_text:
      'SEC index includes capital-markets forms (' +
      forms.join(' ') +
      ' x' +
      offering.length +
      '). Financing need and dilution magnitude are not quantified without offering details and share-count facts.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 60,
    materiality: 'HIGH',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: offering
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 3),
  });
}

const eventFilings = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, watchedEventForms),
);
if (eventFilings.length) {
  const forms = [
    ...new Set(eventFilings.map((f) => parseMeta(f.metadata_json).form).filter(Boolean)),
  ];
  claims.push({
    topic_key: 'material_event_risk_signal',
    claim_text:
      'Recent material-event forms (' +
      forms.join(' ') +
      ' x' +
      eventFilings.length +
      ') may contain adverse disclosures (financing, litigation, clinical, regulatory); bodies are not parsed in Phase 1.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 55,
    materiality: 'HIGH',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: eventFilings
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 3),
  });
}

if (trials.length) {
  let adverse = 0;
  let recruiting = 0;
  let completed = 0;
  let otherStatus = 0;
  const adverseRows = [];
  for (const trial of trials) {
    const status = String(parseMeta(trial.metadata_json).overallStatus || '').toUpperCase();
    if (adverseTrialStatuses.includes(status)) {
      adverse += 1;
      adverseRows.push(trial);
    } else if (status === 'RECRUITING') recruiting += 1;
    else if (status === 'COMPLETED') completed += 1;
    else otherStatus += 1;
  }
  claims.push({
    topic_key: 'clinical_execution_risk_signal',
    claim_text:
      'ClinicalTrials.gov status mix (adverse=' +
      adverse +
      ' recruiting=' +
      recruiting +
      ' completed=' +
      completed +
      ' other=' +
      otherStatus +
      ' of ' +
      trials.length +
      ') is an execution-risk signal only; efficacy safety and protocol weaknesses need full study records.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: adverse > 0 ? 65 : 50,
    materiality: adverse > 0 ? 'HIGH' : 'MEDIUM',
    extraction_method: 'deterministic_ctgov_metadata',
    evidence_ids: (adverseRows.length ? adverseRows : trials)
      .map((t) => t.id)
      .filter(Boolean)
      .slice(0, 5),
  });
}

const insufficient_topics = [];
for (const topic of insufficientTopics) {
  const key = topic.key || topic;
  const text =
    topic.text ||
    'INSUFFICIENT_EVIDENCE: ' + key + ' requires richer risk/red-team evidence sources.';
  insufficient_topics.push(key);
  const linkIds = [...periodic, ...offering, ...eventFilings, ...trials, ...filings]
    .map((r) => r.id)
    .filter(Boolean)
    .slice(0, 2);
  claims.push({
    topic_key: 'insufficient_' + key,
    claim_text: text,
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 95,
    materiality: 'HIGH',
    extraction_method: 'deterministic_insufficient_gate',
    evidence_ids: linkIds,
  });
}

const structuralKeys = new Set([
  'periodic_risk_factor_anchor',
  'financing_dilution_risk_signal',
  'material_event_risk_signal',
  'clinical_execution_risk_signal',
]);
const structuralCount = claims.filter((c) => structuralKeys.has(c.topic_key)).length;

let outcome;
let next_state;
let reason;

if (evidenceRows.length < minEvidence) {
  outcome = 'INSUFFICIENT';
  next_state = 'ANALYZING';
  reason = 'insufficient_evidence_base';
} else if (structuralCount >= minStructural) {
  outcome = 'ANALYZED';
  next_state = 'ANALYZING';
  reason = 'risk_metadata_claims_written';
} else {
  outcome = 'PARTIAL';
  next_state = 'ANALYZING';
  reason = 'partial_risk_claims';
}

const summary = {
  outcome,
  next_state,
  reason,
  claim_count: claims.length,
  structural_claim_count: structuralCount,
  insufficient_topics,
  filings_count: filings.length,
  trials_count: trials.length,
  periodic_count: periodic.length,
  offering_count: offering.length,
  event_filings_count: eventFilings.length,
};
const metadata_b64 = Buffer.from(JSON.stringify(summary), 'utf8').toString('base64');

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      ticker,
      exchange,
      legal_name: legalName,
      outcome,
      next_state,
      reason,
      claims,
      claim_count: claims.length,
      insufficient_topics,
      counts: {
        filings_count: filings.length,
        trials_count: trials.length,
        periodic_count: periodic.length,
        offering_count: offering.length,
        event_filings_count: eventFilings.length,
        claim_count: claims.length,
        structural_claim_count: structuralCount,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
`;
const expandRiskClaimsCode = `// Expand Evaluate Risk Red Team claims[] into one item per claim upsert.

const item = $input.first().json || {};
const claims = Array.isArray(item.claims) ? item.claims : [];
const caseId = item.case_id;

if (!claims.length) {
  return [
    {
      json: {
        case_id: caseId,
        skip_upsert: true,
        claim_count: 0,
      },
    },
  ];
}

return claims.map((claim, index) => ({
  json: {
    case_id: caseId,
    skip_upsert: false,
    claim_index: index,
    topic_key: claim.topic_key || 'claim_' + index,
    claim_text: String(claim.claim_text || '').replaceAll(',', ' '),
    claim_category: claim.claim_category || 'risk_red_team',
    claim_kind: claim.claim_kind || 'inference',
    confidence: Number(claim.confidence ?? 50),
    materiality: claim.materiality || 'MEDIUM',
    extraction_method: claim.extraction_method || 'deterministic',
    evidence_ids: Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [],
    evidence_ids_csv: (Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [])
      .filter(Boolean)
      .join('|'),
    parent_outcome: item.outcome,
    parent_next_state: item.next_state,
    parent_reason: item.reason,
    parent_claim_count: claims.length,
    insufficient_topics: item.insufficient_topics || [],
    counts: item.counts || {},
    metadata_b64: item.metadata_b64 || '',
    ticker: item.ticker,
    exchange: item.exchange,
    company_id: item.company_id,
    n8n_execution_id: item.n8n_execution_id,
  },
}));
`;
const expandRiskClaimLinksCode = `// After risk claim inserts, expand claim_evidence_links rows.

function nodeAll(name) {
  try {
    return $(name).all();
  } catch {
    return [];
  }
}

const inserted = $input.all().filter((row) => row.json && row.json.claim_id);
const expanded = nodeAll('Expand Risk Claims').filter(
  (row) => row.json && row.json.skip_upsert !== true,
);

const links = [];

for (let i = 0; i < inserted.length; i += 1) {
  const claimId = inserted[i].json.claim_id;
  const source =
    expanded.find((row) => row.json.claim_text === inserted[i].json.claim_text) ||
    expanded[i] ||
    null;
  const evidenceIds = source
    ? Array.isArray(source.json.evidence_ids)
      ? source.json.evidence_ids
      : String(source.json.evidence_ids_csv || '')
          .split('|')
          .filter(Boolean)
    : [];

  for (const evidenceId of evidenceIds) {
    links.push({
      json: {
        claim_id: claimId,
        evidence_id: evidenceId,
        link_role: 'SUPPORTS',
        skip_link: false,
      },
    });
  }
}

if (!links.length) {
  const evalRow = (() => {
    try {
      return $('Evaluate Risk Red Team').first().json;
    } catch {
      return $input.first().json || {};
    }
  })();
  return [
    {
      json: {
        skip_link: true,
        case_id: evalRow.case_id,
        claim_count: Number(evalRow.claim_count || inserted.length || 0),
        outcome: evalRow.outcome,
        next_state: evalRow.next_state,
        reason: evalRow.reason,
        insufficient_topics: evalRow.insufficient_topics || [],
        counts: evalRow.counts || {},
        metadata_b64: evalRow.metadata_b64 || '',
        ticker: evalRow.ticker,
        exchange: evalRow.exchange,
        company_id: evalRow.company_id,
        n8n_execution_id: evalRow.n8n_execution_id,
      },
    },
  ];
}

return links;
`;
const prepareRiskAggregateCode = `// Prepare aggregate after risk claim/link upserts.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Risk Red Team') || $input.first().json || {};
let claimStored = 0;
try {
  claimStored = $('Insert Risk Claims')
    .all()
    .filter((row) => row.json && row.json.claim_id).length;
} catch {
  claimStored = Number(evaluated.claim_count || 0);
}

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name,
      outcome: evaluated.outcome || 'FAILED',
      next_state: evaluated.next_state || 'INCOMPLETE',
      reason: evaluated.reason || null,
      claim_count: claimStored || Number(evaluated.claim_count || 0),
      insufficient_topics: evaluated.insufficient_topics || [],
      counts: {
        ...(evaluated.counts || {}),
        claim_stored_count: claimStored,
      },
      metadata_b64: evaluated.metadata_b64 || '',
      n8n_execution_id: evaluated.n8n_execution_id || null,
    },
  },
];
`;
const buildRiskResultCode = `// Canonical source for PII-09 "Build Risk Result" Code node.

const item = $input.first().json || {};

let insufficient_topics = item.insufficient_topics;
if (typeof insufficient_topics === 'string') {
  try {
    insufficient_topics = JSON.parse(insufficient_topics);
  } catch {
    insufficient_topics = [];
  }
}
if (!Array.isArray(insufficient_topics)) insufficient_topics = [];

const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

return [
  {
    json: {
      case_id: item.case_id,
      company_id: item.company_id || null,
      ticker: item.ticker,
      exchange: item.exchange,
      legal_name: item.legal_name || null,
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'INCOMPLETE',
      reason: item.reason || null,
      claim_count: Number(item.claim_count || counts.claim_stored_count || 0),
      insufficient_topics,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
`;

const riskTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Risk Analyst Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'ticker', type: 'string' },
          { name: 'exchange', type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateRiskRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Risk Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateRiskRequestCode,
    },
  },
});

const validationPassed = ifElse({
  version: 2.3,
  config: {
    name: 'Validation Passed?',
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

const prepareValidationError = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Validation Error',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'outcome', name: 'outcome', value: 'FAILED', type: 'string' },
          { id: 'next-state', name: 'next_state', value: 'INCOMPLETE', type: 'string' },
          { id: 'reason', name: 'reason', value: 'validation_failed', type: 'string' },
          { id: 'claim-count', name: 'claim_count', value: 0, type: 'number' },
          {
            id: 'topics',
            name: 'insufficient_topics',
            value: expr('{{ [] }}'),
            type: 'array',
          },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
        ],
      },
    },
  },
});

const loadCaseAndCompany = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Case And Company',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Risk Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadEvidenceDocuments = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Evidence Documents',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id, source_type, publisher, stable_source_id, title, publication_date, metadata_json FROM evidence_documents WHERE case_id = $1::uuid ORDER BY created_at ASC',
      options: {
        queryReplacement: expr('{{ $("Validate Risk Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadAnalysisConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Analysis Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, gates_json, scores_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const evaluateRiskRedTeam = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Risk Red Team',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateRiskRedTeamCode,
    },
  },
});

const expandRiskClaims = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Risk Claims',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandRiskClaimsCode,
    },
  },
});

const hasClaims = ifElse({
  version: 2.3,
  config: {
    name: 'Has Claims?',
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
            leftValue: expr('{{ $json.skip_upsert }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertRiskClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Risk Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO claims (case_id, claim_text, claim_category, claim_kind, confidence, materiality, extraction_method, model_version, is_active) VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6, $7, 'pii-09-v1', TRUE) RETURNING id AS claim_id, case_id, claim_text",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.claim_text }},{{ $json.claim_category }},{{ $json.claim_kind }},{{ $json.confidence }},{{ $json.materiality }},{{ $json.extraction_method }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const expandClaimEvidenceLinks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Claim Evidence Links',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandRiskClaimLinksCode,
    },
  },
});

const hasLinks = ifElse({
  version: 2.3,
  config: {
    name: 'Has Claim Links?',
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
            leftValue: expr('{{ $json.skip_link }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertClaimEvidenceLinks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Claim Evidence Links',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO claim_evidence_links (claim_id, evidence_id, link_role) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (claim_id, evidence_id, link_role) DO NOTHING RETURNING id AS link_id",
      options: {
        queryReplacement: expr(
          '{{ $json.claim_id }},{{ $json.evidence_id }},{{ $json.link_role }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareRiskAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Risk Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareRiskAggregateCode,
    },
  },
});

const prepareZeroClaims = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Zero Claims Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareRiskAggregateCode,
    },
  },
});

const advanceCaseState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Advance Case State',
    parameters: {
      operation: 'executeQuery',
      query:
        'UPDATE research_cases SET state = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr('{{ $json.case_id }},{{ $json.next_state }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logRiskState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Risk State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ANALYZING', $2, $3, 'pii-09', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Advance Case State").first().json.state }},{{ $("Evaluate Risk Red Team").first().json.reason }},{{ $("Evaluate Risk Red Team").first().json.n8n_execution_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-09 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-09', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Risk Red Team").first().json.n8n_execution_id }},{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Risk Red Team").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeRiskOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Risk Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Advance Case State").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Advance Case State").first().json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'claim-count',
            name: 'claim_count',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.claim_count }}'),
            type: 'number',
          },
          {
            id: 'topics',
            name: 'insufficient_topics',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.insufficient_topics }}'),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Risk Red Team").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildRiskResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Risk Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildRiskResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-09 Risk Analyst\nPhase 1: deterministic risk/red-team signals from SEC + CT.gov metadata.\nNo invented risk scores or thesis-breakers without evidence.',
  [riskTrigger, validateRiskRequest, loadEvidenceDocuments],
  { color: 4 },
);

const claimsNote = sticky(
  '## Claims\nPersist claims + claim_evidence_links.\nExplicit INSUFFICIENT_EVIDENCE for financing depth efficacy regulatory commercial competitive patent legal thesis-breakers.',
  [evaluateRiskRedTeam, insertRiskClaims, insertClaimEvidenceLinks],
  { color: 5 },
);

const stateNote = sticky(
  '## State\nStay in ANALYZING for later analysts.\nHard failure only Ã¢â€ â€™ INCOMPLETE.',
  [advanceCaseState, buildRiskResult],
  { color: 6 },
);

const finishPath = advanceCaseState
  .to(logRiskState)
  .to(logWorkflowRun)
  .to(mergeRiskOutput)
  .to(buildRiskResult);

const afterClaimsPath = expandClaimEvidenceLinks.to(
  hasLinks
    .onTrue(insertClaimEvidenceLinks.to(prepareRiskAggregate.to(finishPath)))
    .onFalse(prepareRiskAggregate.to(finishPath)),
);

export default workflow('pii-09-risk', 'PII-09 Risk and Red-Team Reviewer')
  .add(riskTrigger)
  .to(validateRiskRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildRiskResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadEvidenceDocuments.to(
            loadAnalysisConfig.to(
              evaluateRiskRedTeam.to(
                expandRiskClaims.to(
                  hasClaims
                    .onTrue(insertRiskClaims.to(afterClaimsPath))
                    .onFalse(prepareZeroClaims.to(finishPath)),
                ),
              ),
            ),
          ),
        ),
      ),
  )
  .add(intakeNote)
  .add(claimsNote)
  .add(stateNote);
