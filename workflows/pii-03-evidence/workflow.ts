import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateCollectionRequestCode = `// Canonical source for PII-03 "Validate Collection Request" Code node.

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
      cik: body.cik || null,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const normalizeSecEvidenceCode = `// Canonical source for PII-03 "Normalize SEC Evidence" Code node.
// Builds evidence_documents payloads from SEC company submissions JSON.

const crypto = require('crypto');

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function toBase64(obj) {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function padCik(cik) {
  const digits = String(cik == null ? '' : cik).replace(/\\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

function accessionToUrl(cik, accession) {
  const cikNum = String(cik).replace(/^0+/, '') || '0';
  const accNoDash = String(accession || '').replace(/-/g, '');
  if (!accNoDash) return null;
  return (
    'https://www.sec.gov/Archives/edgar/data/' +
    cikNum +
    '/' +
    accNoDash +
    '/' +
    accession +
    '.txt'
  );
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const filingLimit = Number(collection.sec_recent_filings_limit ?? 10);

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const cik = padCik(caseRow.cik || validated.cik || item.cik);
const legalName = caseRow.legal_name || item.legal_name || null;

const payload = item.submissions || item;
const hasError = Boolean(payload.error || payload.code || payload.statusCode >= 400);
const hasFilings = payload.filings && payload.filings.recent;

if (!cik || hasError || !hasFilings) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        cik,
        legal_name: legalName,
        collector: 'sec_edgar',
        ok: false,
        error: hasError ? 'sec_fetch_failed' : !cik ? 'cik_missing' : 'sec_submissions_invalid',
        documents: [],
        document_count: 0,
      },
    },
  ];
}

const recent = payload.filings.recent;
const forms = recent.form || [];
const accessions = recent.accessionNumber || [];
const filingDates = recent.filingDate || [];
const primaryDocs = recent.primaryDocument || [];
const count = Math.min(filingLimit, forms.length, accessions.length);

const documents = [];

const summaryMeta = {
  cik,
  name: payload.name || legalName,
  tickers: payload.tickers || [],
  exchanges: payload.exchanges || [],
  sic: payload.sic || null,
  sicDescription: payload.sicDescription || null,
  recent_filing_count: forms.length,
  collected_filing_count: count,
};
const summaryBody = JSON.stringify({
  kind: 'sec_edgar_submissions',
  cik,
  name: summaryMeta.name,
  recent_filing_count: forms.length,
});
documents.push({
  source_type: 'sec_edgar_submissions',
  publisher: 'SEC',
  stable_source_id: 'submissions:' + cik,
  canonical_url: 'https://data.sec.gov/submissions/CIK' + cik + '.json',
  title: safeText('SEC submissions ' + (summaryMeta.name || cik)),
  publication_date: '',
  content_sha256: sha256Hex(summaryBody),
  metadata_b64: toBase64(summaryMeta),
  chunk_text: safeText(
    'SEC submissions for ' +
      (summaryMeta.name || cik) +
      '. Recent filings indexed: ' +
      forms.length +
      '.',
  ),
});

for (let i = 0; i < count; i += 1) {
  const form = forms[i];
  const accession = accessions[i];
  const filingDate = filingDates[i] || '';
  const primaryDocument = primaryDocs[i] || '';
  const url = accessionToUrl(cik, accession);
  const meta = {
    cik,
    form,
    accessionNumber: accession,
    filingDate,
    primaryDocument,
  };
  const body = JSON.stringify({
    kind: 'sec_edgar_filing',
    cik,
    accession,
    form,
    filingDate,
  });
  documents.push({
    source_type: 'sec_edgar_filing',
    publisher: 'SEC',
    stable_source_id: accession,
    canonical_url: url || 'https://www.sec.gov/',
    title: safeText(form + ' ' + accession),
    publication_date: filingDate,
    content_sha256: sha256Hex(body),
    metadata_b64: toBase64(meta),
    chunk_text: safeText('SEC ' + form + ' filed ' + filingDate + ' accession ' + accession),
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      cik,
      legal_name: legalName,
      collector: 'sec_edgar',
      ok: true,
      error: null,
      documents,
      document_count: documents.length,
    },
  },
];
`;
const normalizeCtgovEvidenceCode = `// Canonical source for PII-03 "Normalize CT.gov Evidence" Code node.

const crypto = require('crypto');

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function toBase64(obj) {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

/** Coerce CT.gov partial dates (YYYY-MM / YYYY) to a Postgres-safe date, else ''. */
function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\\d{4}-\\d{2}$/.test(raw)) return raw + '-01';
  if (/^\\d{4}$/.test(raw)) return raw + '-01-01';
  return '';
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const secNorm = nodeJson('Normalize SEC Evidence') || {};

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || secNorm.company_id || null;
const legalName = caseRow.legal_name || secNorm.legal_name || item.legal_name || null;

const payload = item.studies != null ? item : item.ctgov || item;
const hasError = Boolean(payload.error || payload.code || payload.statusCode >= 400);
const studies = Array.isArray(payload.studies) ? payload.studies : [];

if (hasError) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        collector: 'clinicaltrials_gov',
        ok: false,
        error: 'ctgov_fetch_failed',
        documents: [],
        document_count: 0,
        sec_document_count: Number(secNorm.document_count || 0),
        sec_ok: secNorm.ok === true,
      },
    },
  ];
}

const documents = [];

for (const study of studies) {
  const proto = study.protocolSection || {};
  const ident = proto.identificationModule || {};
  const status = proto.statusModule || {};
  const sponsor = proto.sponsorCollaboratorsModule || {};
  const design = proto.designModule || {};
  const nctId = ident.nctId;
  if (!nctId) continue;

  const briefTitle = ident.briefTitle || ident.officialTitle || nctId;
  const overallStatus = status.overallStatus || null;
  const leadSponsor = (sponsor.leadSponsor && sponsor.leadSponsor.name) || null;
  const phases = (design.phases || []).join('|');
  const startDate =
    (status.startDateStruct && status.startDateStruct.date) ||
    (status.studyFirstSubmitDate) ||
    '';

  const meta = {
    nctId,
    briefTitle,
    overallStatus,
    leadSponsor,
    phases: design.phases || [],
    startDate,
  };
  const body = JSON.stringify({
    kind: 'clinicaltrials_gov',
    nctId,
    overallStatus,
    briefTitle,
  });

  documents.push({
    source_type: 'clinicaltrials_gov',
    publisher: 'ClinicalTrials.gov',
    stable_source_id: nctId,
    canonical_url: 'https://clinicaltrials.gov/study/' + nctId,
    title: safeText(briefTitle),
    publication_date: toSqlDate(startDate),
    content_sha256: sha256Hex(body),
    metadata_b64: toBase64(meta),
    chunk_text: safeText(
      nctId + ' ' + briefTitle + ' status ' + (overallStatus || 'UNKNOWN') + ' phase ' + (phases || 'NA'),
    ),
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      collector: 'clinicaltrials_gov',
      ok: true,
      error: null,
      documents,
      document_count: documents.length,
      sec_document_count: Number(secNorm.document_count || 0),
      sec_ok: secNorm.ok === true,
    },
  },
];
`;
const expandEvidenceDocumentsCode = `// Canonical source for PII-03 "Expand Evidence Documents" Code node.
// Turns a normalize node's documents[] into one item per upsert row.

function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\\d{4}-\\d{2}$/.test(raw)) return raw + '-01';
  if (/^\\d{4}$/.test(raw)) return raw + '-01-01';
  return '';
}

const item = $input.first().json || {};
const docs = Array.isArray(item.documents) ? item.documents : [];
const caseId = item.case_id;
const companyId = item.company_id || '';

if (!docs.length) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        skip_upsert: true,
        collector: item.collector || null,
        parent_ok: item.ok === true,
        parent_error: item.error || null,
        parent_document_count: 0,
      },
    },
  ];
}

return docs.map((doc) => ({
  json: {
    case_id: caseId,
    company_id: companyId || '',
    skip_upsert: false,
    collector: item.collector || null,
    source_type: doc.source_type,
    publisher: doc.publisher,
    stable_source_id: doc.stable_source_id,
    canonical_url: String(doc.canonical_url || '').replaceAll(',', '%2C'),
    title_safe: doc.title || doc.title_safe || '',
    publication_date: toSqlDate(doc.publication_date),
    content_sha256: doc.content_sha256,
    metadata_b64: doc.metadata_b64,
    chunk_text: doc.chunk_text || '',
    parent_ok: item.ok === true,
    parent_document_count: docs.length,
  },
}));
`;
const countSecUpsertsCode = `// Count SEC upsert results for PII-03.

const items = $input.all().filter((row) => row.json && row.json.evidence_id);
let caseId = null;
let companyId = null;
try {
  const sec = $('Normalize SEC Evidence').first().json;
  caseId = sec.case_id;
  companyId = sec.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      sec_stored_count: items.length,
      sec_ok: items.length > 0,
    },
  },
];
`;
const countCtgovUpsertsCode = `// Count CT.gov upsert results for PII-03.

const items = $input.all().filter((row) => row.json && row.json.evidence_id);
let caseId = null;
let companyId = null;
let secStored = 0;
try {
  const ct = $('Normalize CT.gov Evidence').first().json;
  caseId = ct.case_id;
  companyId = ct.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
}
try {
  secStored = Number($('Count SEC Upserts').first().json.sec_stored_count || 0);
} catch {
  try {
    secStored = Number($('Prepare SEC Zero Count').first().json.sec_stored_count || 0);
  } catch {
    secStored = 0;
  }
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      sec_stored_count: secStored,
      ct_stored_count: items.length,
      ct_ok: true,
    },
  },
];
`;
const prepareCtgovZeroCountCode = `// Prepare zero CT.gov count while preserving SEC stored count.

let secStored = 0;
let caseId = null;
let companyId = null;

try {
  const sec = $('Count SEC Upserts').first().json;
  secStored = Number(sec.sec_stored_count || 0);
  caseId = sec.case_id;
  companyId = sec.company_id;
} catch {
  // continue
}

try {
  if (!caseId) {
    const zero = $('Prepare SEC Zero Count').first().json;
    secStored = Number(zero.sec_stored_count || 0);
    caseId = zero.case_id;
    companyId = zero.company_id;
  }
} catch {
  // continue
}

try {
  const ct = $('Normalize CT.gov Evidence').first().json;
  caseId = caseId || ct.case_id;
  companyId = companyId || ct.company_id;
} catch {
  // continue
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      sec_stored_count: secStored,
      ct_stored_count: 0,
      ct_ok: true,
    },
  },
];
`;
const evaluateCollectionCoverageCode = `// Canonical source for PII-03 "Evaluate Collection Coverage" Code node.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function countItems(name) {
  try {
    return $(name).all().filter((row) => row.json && row.json.skip_upsert !== true).length;
  } catch {
    return 0;
  }
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const secNorm = nodeJson('Normalize SEC Evidence') || item.sec || {};
const ctNorm = nodeJson('Normalize CT.gov Evidence') || item.ctgov || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || item.collection || {};
const minSec = Number(collection.min_sec_documents ?? 1);
const partialNeedsHuman = collection.partial_requires_human_review === true;

const secAttempted = countItems('Expand SEC Documents') || Number(secNorm.document_count || 0);
const ctAttempted = countItems('Expand CT.gov Documents') || Number(ctNorm.document_count || 0);

// Prefer upserted evidence_id counts when available from prior aggregate nodes.
const secStored = Number(
  item.sec_stored_count ?? nodeJson('Count SEC Upserts')?.sec_stored_count ?? secAttempted,
);
const ctStored = Number(
  item.ct_stored_count ?? nodeJson('Count CT.gov Upserts')?.ct_stored_count ?? ctAttempted,
);

const secOk = secNorm.ok === true && secStored >= minSec;
const ctOk = ctNorm.ok === true; // zero studies can still be a successful empty search
const secFailed = secNorm.ok === false;
const ctFailed = ctNorm.ok === false;

const totalStored = secStored + (ctFailed ? 0 : ctStored);
const collector_status = [
  {
    key: 'sec_edgar',
    ok: secNorm.ok === true,
    error: secNorm.error || null,
    document_count: secStored,
  },
  {
    key: 'clinicaltrials_gov',
    ok: ctNorm.ok === true,
    error: ctNorm.error || null,
    document_count: ctFailed ? 0 : ctStored,
  },
];

let outcome;
let next_state;
let reason;

if (secOk && !ctFailed) {
  outcome = ctStored > 0 || ctOk ? 'COLLECTED' : 'COLLECTED';
  next_state = 'ANALYZING';
  reason = 'minimum_coverage_met';
} else if (totalStored > 0 || secOk) {
  outcome = 'PARTIAL';
  next_state = partialNeedsHuman ? 'AWAITING_HUMAN_REVIEW' : 'ANALYZING';
  reason = secFailed
    ? 'sec_failed_partial'
    : ctFailed
      ? 'ctgov_failed_partial'
      : 'partial_coverage';
} else {
  outcome = 'FAILED';
  next_state = 'INCOMPLETE';
  reason = 'no_evidence_collected';
}

const summary = {
  sec_stored_count: secStored,
  ct_stored_count: ctFailed ? 0 : ctStored,
  total_stored_count: totalStored,
  min_sec_documents: minSec,
};

const summaryJson = JSON.stringify({
  outcome,
  next_state,
  reason,
  collector_status,
  counts: summary,
});
const metadata_b64 = Buffer.from(summaryJson, 'utf8').toString('base64');

return [
  {
    json: {
      case_id: validated.case_id || item.case_id,
      company_id: secNorm.company_id || ctNorm.company_id || validated.company_id || null,
      ticker: validated.ticker || item.ticker,
      exchange: validated.exchange || item.exchange,
      cik: secNorm.cik || validated.cik || null,
      legal_name: secNorm.legal_name || ctNorm.legal_name || null,
      outcome,
      next_state,
      reason,
      collector_status,
      counts: summary,
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || item.n8n_execution_id || null,
    },
  },
];
`;
const buildCollectionResultCode = `// Canonical source for PII-03 "Build Collection Result" Code node.

const item = $input.first().json || {};

let collector_status = item.collector_status;
if (typeof collector_status === 'string') {
  try {
    collector_status = JSON.parse(collector_status);
  } catch {
    collector_status = [];
  }
}
if (!Array.isArray(collector_status)) collector_status = [];

const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

return [
  {
    json: {
      case_id: item.case_id,
      company_id: item.company_id || null,
      ticker: item.ticker,
      exchange: item.exchange,
      cik: item.cik || null,
      legal_name: item.legal_name || null,
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'INCOMPLETE',
      reason: item.reason || null,
      collector_status,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
`;

const collectionTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Evidence Collect Trigger',
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
      case_id: '91815cf2-865d-4173-8263-f490cc129608',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateCollectionRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Collection Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateCollectionRequestCode,
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
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
          {
            id: 'status',
            name: 'collector_status',
            value: expr('{{ [] }}'),
            type: 'array',
          },
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
        queryReplacement: expr('{{ $("Validate Collection Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadCollectionConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Collection Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, gates_json, freshness_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const fetchSecSubmissions = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch SEC Submissions',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: expr(
        '=https://data.sec.gov/submissions/CIK{{ $("Load Case And Company").item.json.cik }}.json',
      ),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          {
            name: 'User-Agent',
            value: 'PI Opportunity Investigator teacherjoseluis@gmail.com',
          },
          { name: 'Accept', value: 'application/json' },
          { name: 'Accept-Encoding', value: 'gzip, deflate' },
        ],
      },
      options: {
        timeout: 60000,
        lowercaseHeaders: false,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const normalizeSecEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize SEC Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeSecEvidenceCode,
    },
  },
});

const expandSecDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand SEC Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasSecDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has SEC Docs?',
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

const upsertEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'metadata_only', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertSecEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert SEC Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceSql,
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.source_type }},{{ $json.publisher }},{{ $json.canonical_url }},{{ $json.stable_source_id }},{{ $json.title_safe }},{{ $json.publication_date }},{{ $json.content_sha256 }},{{ $json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countSecUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count SEC Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countSecUpsertsCode,
    },
  },
});

const prepareSecZeroCount = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare SEC Zero Count',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Normalize SEC Evidence").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Normalize SEC Evidence").item.json.company_id }}'),
            type: 'string',
          },
          { id: 'sec-count', name: 'sec_stored_count', value: 0, type: 'number' },
          { id: 'sec-ok', name: 'sec_ok', value: false, type: 'boolean' },
        ],
      },
    },
  },
});

const fetchCtgovStudies = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch CT.gov Studies',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://clinicaltrials.gov/api/v2/studies',
      authentication: 'none',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'query.spons',
            value: expr('{{ $("Load Case And Company").item.json.legal_name }}'),
          },
          {
            name: 'pageSize',
            value: expr(
              '{{ $("Load Collection Config").item.json.gates_json.collection.ctgov_page_size || 20 }}',
            ),
          },
          { name: 'format', value: 'json' },
        ],
      },
      options: {
        timeout: 60000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const normalizeCtgovEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize CT.gov Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeCtgovEvidenceCode,
    },
  },
});

const expandCtgovDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand CT.gov Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasCtgovDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has CT.gov Docs?',
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

const upsertCtgovEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert CT.gov Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceSql,
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.source_type }},{{ $json.publisher }},{{ $json.canonical_url }},{{ $json.stable_source_id }},{{ $json.title_safe }},{{ $json.publication_date }},{{ $json.content_sha256 }},{{ $json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countCtgovUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count CT.gov Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countCtgovUpsertsCode,
    },
  },
});

const prepareCtgovZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare CT.gov Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCtgovZeroCountCode,
    },
  },
});

const evaluateCollectionCoverage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Collection Coverage',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateCollectionCoverageCode,
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

const logCollectionState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Collection State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'COLLECTING', $2, $3, 'pii-03', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Advance Case State").item.json.state }},{{ $("Evaluate Collection Coverage").item.json.reason }},{{ $("Evaluate Collection Coverage").item.json.n8n_execution_id }}',
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
    name: 'Log PII-03 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-03', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Evaluate Collection Coverage").item.json.n8n_execution_id }},{{ $("Advance Case State").item.json.case_id }},{{ $("Evaluate Collection Coverage").item.json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeCollectionOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Collection Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Advance Case State").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Advance Case State").item.json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.counts }}'),
            type: 'object',
          },
          {
            id: 'status',
            name: 'collector_status',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.collector_status }}'),
            type: 'array',
          },
        ],
      },
    },
  },
});

const buildCollectionResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Collection Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildCollectionResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-03 Evidence Collector\nPhase 1: SEC submissions + ClinicalTrials.gov.\nDeferred: FDA, IR, patents, full filing bodies, object storage.',
  [collectionTrigger, validateCollectionRequest, loadCaseAndCompany],
  { color: 4 },
);

const collectorsNote = sticky(
  '## Collectors\nSEC Fair Access User-Agent required.\nUpsert evidence_documents by content_sha256.',
  [fetchSecSubmissions, fetchCtgovStudies, upsertSecEvidence],
  { color: 5 },
);

const coverageNote = sticky(
  '## Coverage\nmin_sec_documents default 1 → ANALYZING.\nPARTIAL still advances unless config requires human review.',
  [evaluateCollectionCoverage, advanceCaseState, buildCollectionResult],
  { color: 6 },
);

const finishPath = evaluateCollectionCoverage
  .to(advanceCaseState)
  .to(logCollectionState)
  .to(logWorkflowRun)
  .to(mergeCollectionOutput)
  .to(buildCollectionResult);

const ctgovAndFinish = fetchCtgovStudies.to(
  normalizeCtgovEvidence.to(
    expandCtgovDocuments.to(
      hasCtgovDocs
        .onTrue(upsertCtgovEvidence.to(countCtgovUpserts.to(finishPath)))
        .onFalse(prepareCtgovZeroCount.to(finishPath)),
    ),
  ),
);

export default workflow('pii-03-evidence', 'PII-03 Evidence Collector')
  .add(collectionTrigger)
  .to(validateCollectionRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildCollectionResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadCollectionConfig.to(
            fetchSecSubmissions.to(
              normalizeSecEvidence.to(
                expandSecDocuments.to(
                  hasSecDocs
                    .onTrue(upsertSecEvidence.to(countSecUpserts.to(ctgovAndFinish)))
                    .onFalse(prepareSecZeroCount.to(ctgovAndFinish)),
                ),
              ),
            ),
          ),
        ),
      ),
  )
  .add(intakeNote)
  .add(collectorsNote)
  .add(coverageNote);
