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
const normalizeSecXbrlEvidenceCode = `// Canonical helpers + PII-03 "Normalize SEC XBRL Facts" Code node.
// Extracts cash/debt metrics from SEC companyfacts JSON (Slice E1).

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
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function padCik(cik) {
  const digits = String(cik == null ? '' : cik).replace(/\\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pick the latest USD fact from a companyfacts concept unit map. */
function pickLatestFact(conceptNode) {
  if (!conceptNode || typeof conceptNode !== 'object') return null;
  const units = conceptNode.units || {};
  const series = units.USD || units['USD/shares'] || null;
  if (!Array.isArray(series) || !series.length) return null;

  const ranked = series
    .map((row) => ({
      val: toNumber(row.val),
      end: row.end || null,
      fy: row.fy == null ? null : Number(row.fy),
      fp: row.fp || null,
      form: row.form || null,
      filed: row.filed || null,
      accn: row.accn || null,
      frame: row.frame || null,
    }))
    .filter((row) => row.val != null && row.end);

  if (!ranked.length) return null;

  ranked.sort((a, b) => {
    if (a.end !== b.end) return a.end < b.end ? 1 : -1;
    const af = a.filed || '';
    const bf = b.filed || '';
    if (af !== bf) return af < bf ? 1 : -1;
    return 0;
  });

  return ranked[0];
}

function readConcept(facts, taxonomy, concept) {
  const node = facts && facts[taxonomy] && facts[taxonomy][concept];
  if (!node) return null;
  const latest = pickLatestFact(node);
  if (!latest) return null;
  return {
    concept,
    taxonomy,
    label: node.label || concept,
    ...latest,
  };
}

function firstConcept(facts, taxonomy, concepts) {
  for (const concept of concepts) {
    const hit = readConcept(facts, taxonomy, concept);
    if (hit) return hit;
  }
  return null;
}

/**
 * Extract cash / marketable securities / debt metrics from companyfacts payload.
 * Pure function — used by Code node and unit tests.
 */
function extractCashDebtMetrics(companyfacts, options) {
  const opts = options || {};
  const facts = (companyfacts && companyfacts.facts) || {};
  const taxonomy = opts.taxonomy || 'us-gaap';

  const cashConcepts = opts.cash_concepts || [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsAndShortTermInvestments',
    'Cash',
  ];
  const marketableConcepts = opts.marketable_concepts || [
    'MarketableSecuritiesCurrent',
    'AvailableForSaleSecuritiesCurrent',
    'ShortTermInvestments',
    'MarketableSecurities',
  ];
  const shortDebtConcepts = opts.short_debt_concepts || [
    'ShortTermBorrowings',
    'LongTermDebtCurrent',
    'DebtCurrent',
    'LongTermDebtAndCapitalLeaseObligationsCurrent',
  ];
  const longDebtConcepts = opts.long_debt_concepts || [
    'LongTermDebtNoncurrent',
    'LongTermDebt',
    'LongTermDebtAndCapitalLeaseObligations',
    'LongTermDebtNoncurrentAndCapitalLeaseObligations',
  ];

  const cash = firstConcept(facts, taxonomy, cashConcepts);
  const marketable = firstConcept(facts, taxonomy, marketableConcepts);
  const shortDebt = firstConcept(facts, taxonomy, shortDebtConcepts);
  const longDebt = firstConcept(facts, taxonomy, longDebtConcepts);

  if (!cash && !marketable && !shortDebt && !longDebt) {
    return { ok: false, error: 'no_cash_debt_concepts', metrics: [], period: null };
  }

  const anchor = cash || marketable || longDebt || shortDebt;
  const periodEnd = anchor.end;
  const periodLabel = 'XBRL_' + periodEnd;
  const fp = String(anchor.fp || '').toUpperCase();
  let fiscalQuarter = null;
  if (fp === 'Q1') fiscalQuarter = 1;
  else if (fp === 'Q2') fiscalQuarter = 2;
  else if (fp === 'Q3') fiscalQuarter = 3;
  else if (fp === 'Q4' || fp === 'FY') fiscalQuarter = fp === 'FY' ? 4 : 4;

  const period = {
    period_label: periodLabel,
    period_start: null,
    period_end: periodEnd,
    fiscal_year: anchor.fy,
    fiscal_quarter: fiscalQuarter,
    form: anchor.form || null,
    filed: anchor.filed || null,
    accession: anchor.accn || null,
  };

  const metrics = [];
  function pushMetric(key, fact, notes) {
    if (!fact) return;
    metrics.push({
      metric_key: key,
      metric_value: fact.val,
      currency: 'USD',
      unit: 'USD',
      scale: 'as_reported',
      assumption_set: 'reported',
      calculation_notes: notes || fact.concept,
      concept: fact.concept,
      end: fact.end,
      form: fact.form || null,
    });
  }

  pushMetric('cash_and_equivalents', cash, cash ? cash.concept : null);
  pushMetric('marketable_securities_current', marketable, marketable ? marketable.concept : null);
  pushMetric('short_term_debt', shortDebt, shortDebt ? shortDebt.concept : null);
  pushMetric('long_term_debt', longDebt, longDebt ? longDebt.concept : null);

  const cashVal = cash ? cash.val : 0;
  const mktVal = marketable ? marketable.val : 0;
  const stVal = shortDebt ? shortDebt.val : 0;
  const ltVal = longDebt ? longDebt.val : 0;
  const liquid = (cash ? cash.val : 0) + (marketable ? marketable.val : 0);
  const totalDebt = (shortDebt ? shortDebt.val : 0) + (longDebt ? longDebt.val : 0);

  if (cash || marketable) {
    metrics.push({
      metric_key: 'liquid_assets',
      metric_value: liquid,
      currency: 'USD',
      unit: 'USD',
      scale: 'as_reported',
      assumption_set: 'reported',
      calculation_notes:
        'cash_and_equivalents(' +
        cashVal +
        ') + marketable_securities_current(' +
        mktVal +
        ')',
      concept: 'derived',
      end: periodEnd,
      form: anchor.form || null,
    });
  }

  if (shortDebt || longDebt) {
    metrics.push({
      metric_key: 'total_debt',
      metric_value: totalDebt,
      currency: 'USD',
      unit: 'USD',
      scale: 'as_reported',
      assumption_set: 'reported',
      calculation_notes:
        'short_term_debt(' + stVal + ') + long_term_debt(' + ltVal + ')',
      concept: 'derived',
      end: periodEnd,
      form: anchor.form || null,
    });
  }

  if ((cash || marketable) && (shortDebt || longDebt || totalDebt === 0)) {
    metrics.push({
      metric_key: 'net_cash',
      metric_value: liquid - totalDebt,
      currency: 'USD',
      unit: 'USD',
      scale: 'as_reported',
      assumption_set: 'reported',
      calculation_notes: 'liquid_assets - total_debt',
      concept: 'derived',
      end: periodEnd,
      form: anchor.form || null,
    });
  }

  return {
    ok: metrics.length > 0,
    error: metrics.length ? null : 'no_metrics',
    period,
    metrics,
    entityName: (companyfacts && companyfacts.entityName) || null,
    cik: companyfacts && companyfacts.cik != null ? String(companyfacts.cik) : null,
  };
}

// --- Code node entry (n8n) ---
const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const xbrlCfg = collectors.sec_filing_bodies || {};
const enabled = xbrlCfg.enabled !== false;

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const cik = padCik(caseRow.cik || validated.cik || item.cik);
const legalName = caseRow.legal_name || item.legal_name || null;
const ticker = validated.ticker || caseRow.ticker || item.ticker;

if (!enabled) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        cik,
        legal_name: legalName,
        ticker,
        collector: 'sec_filing_bodies',
        ok: true,
        skipped: true,
        error: null,
        document_count: 0,
        metric_count: 0,
        documents: [],
        has_xbrl_docs: false,
      },
    },
  ];
}

const payload = item.companyfacts || item;
const hasError = Boolean(
  payload.error || payload.code || (payload.statusCode && payload.statusCode >= 400),
);
const hasFacts = payload.facts && typeof payload.facts === 'object';

if (!cik || hasError || !hasFacts) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        cik,
        legal_name: legalName,
        ticker,
        collector: 'sec_filing_bodies',
        ok: false,
        skipped: false,
        error: hasError ? 'sec_companyfacts_fetch_failed' : !cik ? 'cik_missing' : 'companyfacts_invalid',
        document_count: 0,
        metric_count: 0,
        documents: [],
        has_xbrl_docs: false,
      },
    },
  ];
}

const extracted = extractCashDebtMetrics(payload, {
  cash_concepts: xbrlCfg.cash_concepts,
  marketable_concepts: xbrlCfg.marketable_concepts,
  short_debt_concepts: xbrlCfg.short_debt_concepts,
  long_debt_concepts: xbrlCfg.long_debt_concepts,
});

if (!extracted.ok) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        cik,
        legal_name: legalName || extracted.entityName,
        ticker,
        collector: 'sec_filing_bodies',
        ok: false,
        skipped: false,
        error: extracted.error || 'extract_failed',
        document_count: 0,
        metric_count: 0,
        documents: [],
        has_xbrl_docs: false,
      },
    },
  ];
}

const compactBody = {
  cik,
  entityName: extracted.entityName || legalName,
  period: extracted.period,
  metrics: extracted.metrics.map((m) => ({
    metric_key: m.metric_key,
    metric_value: m.metric_value,
    concept: m.concept,
    end: m.end,
    form: m.form,
  })),
};
const bodyJson = JSON.stringify(compactBody);
const contentSha = sha256Hex(bodyJson);
const stableId = 'sec-companyfacts-cashdebt-' + cik + '-' + extracted.period.period_end;

const meta = {
  collector: 'sec_filing_bodies',
  cik,
  period: extracted.period,
  metric_keys: extracted.metrics.map((m) => m.metric_key),
  source: 'data.sec.gov/api/xbrl/companyfacts',
};
const chunkText =
  'SEC XBRL companyfacts cash/debt snapshot for ' +
  (extracted.entityName || legalName || ticker) +
  ' as of ' +
  extracted.period.period_end +
  ': ' +
  extracted.metrics
    .map((m) => m.metric_key + '=' + m.metric_value)
    .join('; ') +
  '.';

const document = {
  case_id: caseId,
  company_id: companyId,
  source_type: 'sec_companyfacts',
  publisher: 'SEC EDGAR',
  canonical_url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json',
  stable_source_id: stableId,
  title:
    'SEC companyfacts cash/debt ' +
    (extracted.entityName || ticker || cik) +
    ' @ ' +
    extracted.period.period_end,
  publication_date: extracted.period.filed || extracted.period.period_end,
  content_sha256: contentSha,
  authority_tier: 'primary',
  access_status: 'retrieved',
  parsing_status: 'xbrl_facts_extracted',
  raw_content_location: 'inline:metadata_json',
  metadata_json: meta,
  metadata_b64: toBase64(meta),
  chunk_text: chunkText,
};

const metricsForSql = extracted.metrics.map((m) => ({
  metric_key: m.metric_key,
  metric_value: m.metric_value,
  currency: m.currency || 'USD',
  unit: m.unit || 'USD',
  scale: m.scale || 'as_reported',
  assumption_set: m.assumption_set || 'reported',
  calculation_notes: m.calculation_notes || null,
}));

const period = extracted.period;
const chunkMetaB64 = toBase64({ kind: 'xbrl_cash_debt_summary', period_end: period.period_end });

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      cik,
      legal_name: legalName || extracted.entityName,
      ticker,
      collector: 'sec_filing_bodies',
      ok: true,
      skipped: false,
      error: null,
      document_count: 1,
      metric_count: metricsForSql.length,
      documents: [document],
      has_xbrl_docs: true,
      period_label: period.period_label,
      period_start: period.period_start,
      period_end: period.period_end,
      fiscal_year: period.fiscal_year,
      fiscal_quarter: period.fiscal_quarter,
      metrics_b64: toBase64(metricsForSql),
      chunk_text: chunkText,
      chunk_index: 0,
      chunk_token_estimate: Math.ceil(chunkText.length / 4),
      chunk_metadata_b64: chunkMetaB64,
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
const prepareOpenfdaQueryCode = `// Canonical source for PII-03 "Prepare OpenFDA Query" Code node.
// Builds Drugs@FDA search URL from legal_name when fda_openfda is enabled.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function searchTokenFromLegalName(legalName) {
  const stop = new Set([
    'INC',
    'INCORPORATED',
    'CORP',
    'CORPORATION',
    'LTD',
    'LIMITED',
    'LLC',
    'CO',
    'COMPANY',
    'PLC',
    'LP',
    'LLP',
    'THE',
    'AND',
    'OF',
    'PHARMACEUTICALS',
    'PHARMACEUTICAL',
    'PHARMA',
    'BIOTECH',
    'BIOTECHNOLOGY',
    'THERAPEUTICS',
    'BIOSCIENCES',
    'SCIENCES',
    'LABORATORIES',
    'LABS',
    'HOLDINGS',
    'GROUP',
    'USA',
    'US',
  ]);
  const tokens = String(legalName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\\s]/g, ' ')
    .split(/\\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
  return tokens[0] || null;
}

const validated = nodeJson('Validate Collection Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Collection Config') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || {};
const collectors = collection.collectors || {};
const fdaCfg = collectors.fda_openfda || {};
const enabled = fdaCfg.enabled === true;
const limit = Number(collection.openfda_limit ?? fdaCfg.limit ?? 25);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || null;
const ticker = validated.ticker || caseRow.ticker || null;
const searchToken = searchTokenFromLegalName(legalName);

let openfda_url = '';
let skip_fetch = true;
let skip_reason = null;

if (!enabled) {
  skip_reason = 'collector_disabled';
} else if (!searchToken) {
  skip_reason = 'search_token_missing';
} else {
  skip_fetch = false;
  const quoted = encodeURIComponent('"' + searchToken + '"');
  const search =
    'openfda.manufacturer_name:' +
    quoted +
    '+OR+sponsor_name:' +
    quoted;
  openfda_url =
    'https://api.fda.gov/drug/drugsfda.json?search=' +
    search +
    '&limit=' +
    Math.max(1, Math.min(100, limit));
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'fda_openfda',
      enabled,
      skip_fetch,
      skip_reason,
      search_token: searchToken,
      openfda_limit: limit,
      openfda_url,
    },
  },
];
`;
const normalizeFdaOpenfdaEvidenceCode = `// Canonical source for PII-03 "Normalize OpenFDA Evidence" Code node.
// Compact Drugs@FDA application facts (Slice E4) — no label/PDF blob archive.

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
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

/** Coerce YYYYMMDD / ISO / partial dates to Postgres-safe YYYY-MM-DD. */
function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\\d{8}$/.test(raw)) {
    return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
  }
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\\d{4}-\\d{2}$/.test(raw)) return raw + '-01';
  if (/^\\d{4}$/.test(raw)) return raw + '-01-01';
  return '';
}

/**
 * Derive a compact openFDA search token from a legal name.
 * Exported for unit tests via the Code-node script body.
 */
function searchTokenFromLegalName(legalName) {
  const stop = new Set([
    'INC',
    'INCORPORATED',
    'CORP',
    'CORPORATION',
    'LTD',
    'LIMITED',
    'LLC',
    'CO',
    'COMPANY',
    'PLC',
    'LP',
    'LLP',
    'THE',
    'AND',
    'OF',
    'PHARMACEUTICALS',
    'PHARMACEUTICAL',
    'PHARMA',
    'BIOTECH',
    'BIOTECHNOLOGY',
    'THERAPEUTICS',
    'BIOSCIENCES',
    'SCIENCES',
    'LABORATORIES',
    'LABS',
    'HOLDINGS',
    'GROUP',
    'USA',
    'US',
  ]);
  const tokens = String(legalName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\\s]/g, ' ')
    .split(/\\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
  return tokens[0] || null;
}

function compactApplication(row) {
  const products = Array.isArray(row.products) ? row.products : [];
  const submissions = Array.isArray(row.submissions) ? row.submissions : [];

  const brandNames = [
    ...new Set(
      products
        .map((p) => safeText(p && p.brand_name))
        .filter(Boolean),
    ),
  ];
  const marketingStatuses = [
    ...new Set(
      products
        .map((p) => safeText(p && p.marketing_status))
        .filter(Boolean),
    ),
  ];
  const dosageForms = [
    ...new Set(
      products
        .map((p) => safeText(p && p.dosage_form))
        .filter(Boolean),
    ),
  ];
  const routes = [
    ...new Set(products.map((p) => safeText(p && p.route)).filter(Boolean)),
  ];

  const origApproved = submissions
    .filter(
      (s) =>
        String(s.submission_type || '').toUpperCase() === 'ORIG' &&
        String(s.submission_status || '').toUpperCase() === 'AP',
    )
    .map((s) => ({
      submission_status_date: toSqlDate(s.submission_status_date),
      review_priority: s.review_priority || null,
      submission_class_code: s.submission_class_code || null,
      submission_class_code_description: s.submission_class_code_description || null,
    }))
    .filter((s) => s.submission_status_date)
    .sort((a, b) => (a.submission_status_date < b.submission_status_date ? -1 : 1));

  const latestSubmissionDate = submissions
    .map((s) => toSqlDate(s.submission_status_date))
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  const origin = origApproved[0] || null;

  return {
    application_number: safeText(row.application_number),
    sponsor_name: safeText(row.sponsor_name),
    brand_names: brandNames,
    marketing_statuses: marketingStatuses,
    dosage_forms: dosageForms,
    routes,
    product_count: products.length,
    submission_count: submissions.length,
    original_approval_date: origin ? origin.submission_status_date : null,
    original_review_priority: origin ? origin.review_priority : null,
    original_submission_class: origin ? origin.submission_class_code_description || origin.submission_class_code : null,
    latest_submission_date: latestSubmissionDate,
  };
}

// --- Code node entry (n8n) ---
const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const prepareRow = nodeJson('Prepare OpenFDA Query') || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const fdaCfg = collectors.fda_openfda || {};
const enabled = fdaCfg.enabled === true;

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || prepareRow.legal_name || item.legal_name || null;
const ticker = validated.ticker || caseRow.ticker || item.ticker;
const searchToken =
  prepareRow.search_token || searchTokenFromLegalName(legalName) || null;
const limit = Number(
  prepareRow.openfda_limit ?? collection.openfda_limit ?? fdaCfg.limit ?? 25,
);

if (!enabled) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'fda_openfda',
        ok: true,
        skipped: true,
        error: null,
        documents: [],
        document_count: 0,
        search_token: searchToken,
      },
    },
  ];
}

const payload = item.results != null || item.error != null || item.meta != null ? item : item.openfda || item;
const errorCode =
  (payload.error && (payload.error.code || payload.error.message)) ||
  payload.code ||
  null;
const statusCode = Number(payload.statusCode || 0);
const isNotFound =
  String(errorCode || '').toUpperCase().includes('NOT_FOUND') ||
  String((payload.error && payload.error.message) || '')
    .toLowerCase()
    .includes('no matches');
const hardFail =
  !isNotFound &&
  Boolean(payload.error || (statusCode >= 400 && statusCode !== 404));

if (hardFail) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'fda_openfda',
        ok: false,
        skipped: false,
        error: 'openfda_fetch_failed',
        documents: [],
        document_count: 0,
        search_token: searchToken,
      },
    },
  ];
}

const results = Array.isArray(payload.results) ? payload.results : [];
const documents = [];

for (const row of results.slice(0, Math.max(1, limit))) {
  const compact = compactApplication(row);
  if (!compact.application_number) continue;

  const body = {
    kind: 'fda_drugsfda',
    application_number: compact.application_number,
    sponsor_name: compact.sponsor_name,
    brand_names: compact.brand_names,
    original_approval_date: compact.original_approval_date,
    product_count: compact.product_count,
    submission_count: compact.submission_count,
  };
  const meta = {
    collector: 'fda_openfda',
    mode: 'drugsfda_compact',
    search_token: searchToken,
    ...compact,
  };
  const brandsLabel = compact.brand_names.length
    ? compact.brand_names.join('/')
    : compact.application_number;
  const chunkText = safeText(
    'FDA Drugs@FDA ' +
      compact.application_number +
      ' ' +
      brandsLabel +
      ' sponsor ' +
      (compact.sponsor_name || 'UNKNOWN') +
      (compact.original_approval_date
        ? ' ORIG-AP ' + compact.original_approval_date
        : '') +
      ' products ' +
      compact.product_count +
      ' submissions ' +
      compact.submission_count,
  );

  documents.push({
    source_type: 'fda_drugsfda',
    publisher: 'openFDA',
    stable_source_id: 'fda-drugsfda-' + compact.application_number,
    canonical_url:
      'https://api.fda.gov/drug/drugsfda.json?search=application_number:%22' +
      encodeURIComponent(compact.application_number) +
      '%22',
    title: safeText('Drugs@FDA ' + brandsLabel + ' (' + compact.application_number + ')'),
    publication_date:
      compact.original_approval_date || compact.latest_submission_date || '',
    content_sha256: sha256Hex(JSON.stringify(body)),
    metadata_b64: toBase64(meta),
    chunk_text: chunkText,
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'fda_openfda',
      ok: true,
      skipped: false,
      error: null,
      documents,
      document_count: documents.length,
      search_token: searchToken,
      openfda_total:
        (payload.meta && payload.meta.results && payload.meta.results.total) ||
        documents.length,
    },
  },
];
`;
const prepareCompanyNewsQueryCode = `// Canonical source for PII-03 "Prepare Company News Query" Code node.
// Builds Finnhub /company-news date window when company_ir is enabled (Slice E5).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

const validated = nodeJson('Validate Collection Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Collection Config') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || {};
const collectors = collection.collectors || {};
const irCfg = collectors.company_ir || {};
const enabled = irCfg.enabled === true;
const lookbackDays = Number(
  collection.company_news_lookback_days ?? irCfg.lookback_days ?? 90,
);
const limit = Number(collection.company_news_limit ?? irCfg.limit ?? 25);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || null;
const ticker = String(validated.ticker || caseRow.ticker || '')
  .trim()
  .toUpperCase();

const to = new Date();
const from = new Date(to.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000);
const fromDate = isoDate(from);
const toDate = isoDate(to);

let skip_fetch = true;
let skip_reason = null;

if (!enabled) {
  skip_reason = 'collector_disabled';
} else if (!ticker) {
  skip_reason = 'ticker_missing';
} else {
  skip_fetch = false;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'company_ir',
      enabled,
      skip_fetch,
      skip_reason,
      lookback_days: lookbackDays,
      company_news_limit: limit,
      from_date: fromDate,
      to_date: toDate,
    },
  },
];
`;
const normalizeCompanyNewsEvidenceCode = `// Canonical source for PII-03 "Normalize Company News Evidence" Code node.
// Compact Finnhub company-news headlines (Slice E5) — no article HTML/PDF archive.

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
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function toSqlDateFromUnix(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function truncate(text, max) {
  const s = safeText(text);
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const prepareRow = nodeJson('Prepare Company News Query') || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const irCfg = collectors.company_ir || {};
const enabled = irCfg.enabled === true;
const limit = Number(
  prepareRow.company_news_limit ?? collection.company_news_limit ?? irCfg.limit ?? 25,
);

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || prepareRow.legal_name || item.legal_name || null;
const ticker = String(
  validated.ticker || caseRow.ticker || prepareRow.ticker || item.ticker || '',
)
  .trim()
  .toUpperCase();

if (!enabled) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'company_ir',
        ok: true,
        skipped: true,
        error: null,
        documents: [],
        document_count: 0,
      },
    },
  ];
}

// Finnhub returns a bare array on success (n8n → one item per article).
// Errors are a single object with error/message/statusCode.
let rows = [];
const allItems = $input.all().map((r) => r.json).filter(Boolean);
if (
  allItems.length &&
  allItems.every((r) => r && typeof r === 'object' && (r.headline != null || r.id != null))
) {
  rows = allItems;
} else if (Array.isArray(item)) {
  rows = item;
} else if (Array.isArray(item.news)) {
  rows = item.news;
} else if (Array.isArray(item.data)) {
  rows = item.data;
}

const payload = item && !Array.isArray(item) ? item : {};
const statusCode = Number(payload.statusCode || 0);
const errMsg =
  (typeof payload.error === 'string' && payload.error) ||
  (payload.error && payload.error.message) ||
  (statusCode >= 400 ? payload.message : null) ||
  null;
const hardFail = Boolean(errMsg) || (statusCode >= 400 && !rows.length);
if (hardFail && !rows.length) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'company_ir',
        ok: false,
        skipped: false,
        error: 'company_news_fetch_failed',
        documents: [],
        document_count: 0,
      },
    },
  ];
}

const documents = [];
const seen = new Set();

for (const row of rows.slice(0, Math.max(1, limit))) {
  if (!row || typeof row !== 'object') continue;
  const headline = safeText(row.headline);
  const newsId = row.id != null ? String(row.id) : null;
  if (!headline && !newsId) continue;

  const stable =
    'finnhub-news-' + (newsId || sha256Hex(headline + '|' + (row.datetime || '')).slice(0, 16));
  if (seen.has(stable)) continue;
  seen.add(stable);

  const pubDate = toSqlDateFromUnix(row.datetime);
  const summary = truncate(row.summary || '', 400);
  const source = safeText(row.source || 'Finnhub');
  const url = String(row.url || '').trim();

  const body = {
    kind: 'finnhub_company_news',
    id: newsId,
    headline,
    datetime: row.datetime || null,
    source,
    related: row.related || ticker,
  };
  const meta = {
    collector: 'company_ir',
    mode: 'finnhub_company_news',
    news_id: newsId,
    headline,
    datetime: row.datetime || null,
    publication_date: pubDate,
    source,
    related: row.related || ticker,
    url,
    summary,
    category: row.category || null,
  };
  const chunkText = safeText(
    'Company news ' +
      (pubDate || 'undated') +
      ' ' +
      source +
      ': ' +
      headline +
      (summary ? ' — ' + summary : ''),
  );

  documents.push({
    source_type: 'finnhub_company_news',
    publisher: source || 'Finnhub',
    stable_source_id: stable,
    canonical_url: url || 'https://finnhub.io/api/v1/company-news',
    title: truncate(headline || stable, 200),
    publication_date: pubDate,
    content_sha256: sha256Hex(JSON.stringify(body)),
    metadata_b64: toBase64(meta),
    chunk_text: chunkText,
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'company_ir',
      ok: true,
      skipped: false,
      error: null,
      documents,
      document_count: documents.length,
      from_date: prepareRow.from_date || null,
      to_date: prepareRow.to_date || null,
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
    publisher: String(doc.publisher || '').replaceAll(',', ' '),
    stable_source_id: String(doc.stable_source_id || '').replaceAll(',', ' '),
    canonical_url: String(doc.canonical_url || '').replaceAll(',', '%2C'),
    title_safe: String(doc.title || doc.title_safe || '').replaceAll(',', ' '),
    publication_date: toSqlDate(doc.publication_date),
    content_sha256: doc.content_sha256,
    metadata_b64: doc.metadata_b64,
    chunk_text: doc.chunk_text || '',
    chunk_index: doc.chunk_index == null ? 0 : doc.chunk_index,
    chunk_token_estimate:
      doc.chunk_token_estimate ||
      (doc.chunk_text ? Math.max(1, Math.ceil(String(doc.chunk_text).length / 4)) : null),
    parent_ok: item.ok === true,
    parent_document_count: docs.length,
  },
}));
`;
const prepareEvidenceChunkUpsertsCode = `// After Upsert * Evidence: pair returned evidence_id with Expand * Documents chunk_text.
// Slice E7 — write evidence_chunks for SEC/CT/FDA/news/USPTO (XBRL already has its own path).

function nodeAll(name) {
  try {
    return $(name).all().map((row) => row.json);
  } catch {
    return [];
  }
}

const EXPAND_CANDIDATES = [
  'Expand SEC Documents',
  'Expand CT.gov Documents',
  'Expand FDA Documents',
  'Expand Company News Documents',
  'Expand USPTO Documents',
];

const upserted = $input
  .all()
  .map((row) => row.json)
  .filter((row) => row && row.evidence_id);

let expanded = [];
for (const name of EXPAND_CANDIDATES) {
  const rows = nodeAll(name).filter((row) => row && row.skip_upsert !== true);
  if (!rows.length) continue;
  // Prefer the expand set that overlaps stable_source_id with upserted rows.
  const upsertIds = new Set(upserted.map((u) => String(u.stable_source_id || '')));
  const overlap = rows.filter((r) => upsertIds.has(String(r.stable_source_id || ''))).length;
  if (overlap > 0 || rows.length === upserted.length) {
    expanded = rows;
    break;
  }
  if (!expanded.length) expanded = rows;
}

function toBase64(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

const out = [];
for (let i = 0; i < upserted.length; i += 1) {
  const u = upserted[i];
  const ex =
    expanded.find((e) => String(e.stable_source_id || '') === String(u.stable_source_id || '')) ||
    expanded[i] ||
    {};
  const chunkText = String(ex.chunk_text || '')
    .replaceAll(',', ';')
    .replace(/\\s+/g, ' ')
    .trim();
  if (!chunkText) continue;
  const meta = {
    collector: ex.collector || null,
    source_type: u.source_type || ex.source_type || null,
    stable_source_id: u.stable_source_id || ex.stable_source_id || null,
  };
  out.push({
    json: {
      evidence_id: u.evidence_id,
      chunk_index: 0,
      chunk_text: chunkText,
      chunk_token_estimate: Math.max(1, Math.ceil(chunkText.length / 4)),
      chunk_metadata_b64: toBase64(meta),
    },
  });
}

if (!out.length) {
  return [
    {
      json: {
        skip_chunk: true,
        evidence_id: null,
        chunk_index: 0,
        chunk_text: '',
        chunk_token_estimate: null,
        chunk_metadata_b64: '',
      },
    },
  ];
}

return out;
`;
const countSecUpsertsCode = `// Count SEC upsert results for PII-03.

let items = [];
try {
  items = $('Upsert SEC Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
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

let items = [];
try {
  items = $('Upsert CT.gov Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
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
const prepareXbrlFinancialUpsertsCode = `// After Upsert XBRL Evidence: bind returned evidence_id onto period/metrics/chunk fields.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const upserted = $input.first().json || {};
const normalized = nodeJson('Normalize SEC XBRL Facts') || {};
const evidenceId = upserted.evidence_id || upserted.id || null;

return [
  {
    json: {
      case_id: normalized.case_id || upserted.case_id,
      company_id: normalized.company_id || upserted.company_id,
      evidence_id: evidenceId,
      period_label: normalized.period_label,
      period_start: normalized.period_start,
      period_end: normalized.period_end,
      fiscal_year: normalized.fiscal_year,
      fiscal_quarter: normalized.fiscal_quarter,
      metrics_b64: normalized.metrics_b64,
      // Commas break n8n Postgres queryReplacement CSV binding.
      chunk_text: String(normalized.chunk_text || '').replaceAll(',', ';'),
      chunk_index: normalized.chunk_index == null ? 0 : normalized.chunk_index,
      chunk_token_estimate: normalized.chunk_token_estimate || null,
      chunk_metadata_b64: normalized.chunk_metadata_b64 || '',
      metric_count: normalized.metric_count || 0,
      xbrl_stored_count: evidenceId ? 1 : 0,
    },
  },
];
`;
const countXbrlUpsertsCode = `// Count XBRL evidence + metric upsert results for coverage.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const prepared = nodeJson('Prepare XBRL Financial Upserts') || $input.first().json || {};
const metricRows = (() => {
  try {
    return $('Upsert XBRL Financial Metrics').all().length;
  } catch {
    return Number(prepared.metric_count || 0);
  }
})();

return [
  {
    json: {
      case_id: prepared.case_id,
      company_id: prepared.company_id,
      xbrl_stored_count: Number(prepared.xbrl_stored_count || (prepared.evidence_id ? 1 : 0)),
      xbrl_metric_count: metricRows,
      evidence_id: prepared.evidence_id || null,
    },
  },
];
`;
const prepareXbrlZeroCountCode = `// XBRL collector skipped or produced no documents.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const normalized = nodeJson('Normalize SEC XBRL Facts') || $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || {};

return [
  {
    json: {
      case_id: normalized.case_id || validated.case_id,
      company_id: normalized.company_id || null,
      xbrl_stored_count: 0,
      xbrl_metric_count: 0,
      skipped: normalized.skipped === true,
      error: normalized.error || null,
    },
  },
];
`;
const countFdaUpsertsCode = `// Count OpenFDA / Drugs@FDA upsert results for PII-03 coverage.

let items = [];
try {
  items = $('Upsert FDA Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
let caseId = null;
let companyId = null;

try {
  const fda = $('Normalize OpenFDA Evidence').first().json;
  caseId = fda.case_id;
  companyId = fda.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
  companyId = items[0] && items[0].json.company_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      fda_stored_count: items.length,
      fda_ok: true,
    },
  },
];
`;
const prepareFdaZeroCountCode = `// Prepare zero OpenFDA count when collector skipped or no matches.

let caseId = null;
let companyId = null;
let skipped = false;
let ok = true;

try {
  const prep = $('Prepare OpenFDA Query').first().json;
  caseId = prep.case_id;
  companyId = prep.company_id;
  skipped = prep.skip_fetch === true || prep.enabled === false;
} catch {
  // continue
}

try {
  const fda = $('Normalize OpenFDA Evidence').first().json;
  caseId = caseId || fda.case_id;
  companyId = companyId || fda.company_id;
  skipped = skipped || fda.skipped === true;
  ok = fda.ok !== false;
} catch {
  // continue
}

try {
  if (!caseId) {
    const ct = $('Count CT.gov Upserts').first().json;
    caseId = ct.case_id;
    companyId = ct.company_id;
  }
} catch {
  try {
    if (!caseId) {
      const zero = $('Prepare CT.gov Zero Count').first().json;
      caseId = zero.case_id;
      companyId = zero.company_id;
    }
  } catch {
    // continue
  }
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      fda_stored_count: 0,
      fda_ok: ok,
      fda_skipped: skipped,
    },
  },
];
`;
const countCompanyNewsUpsertsCode = `// Count Finnhub company-news upsert results for PII-03 coverage.

let items = [];
try {
  items = $('Upsert Company News Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
let caseId = null;
let companyId = null;

try {
  const news = $('Normalize Company News Evidence').first().json;
  caseId = news.case_id;
  companyId = news.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
  companyId = items[0] && items[0].json.company_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      news_stored_count: items.length,
      news_ok: true,
    },
  },
];
`;
const prepareCompanyNewsZeroCountCode = `// Prepare zero company-news count when collector skipped or no matches.

let caseId = null;
let companyId = null;
let skipped = false;
let ok = true;

try {
  const prep = $('Prepare Company News Query').first().json;
  caseId = prep.case_id;
  companyId = prep.company_id;
  skipped = prep.skip_fetch === true || prep.enabled === false;
} catch {
  // continue
}

try {
  const news = $('Normalize Company News Evidence').first().json;
  caseId = caseId || news.case_id;
  companyId = companyId || news.company_id;
  skipped = skipped || news.skipped === true;
  ok = news.ok !== false;
} catch {
  // continue
}

try {
  if (!caseId) {
    const fda = $('Count FDA Upserts').first().json;
    caseId = fda.case_id;
    companyId = fda.company_id;
  }
} catch {
  try {
    if (!caseId) {
      const zero = $('Prepare FDA Zero Count').first().json;
      caseId = zero.case_id;
      companyId = zero.company_id;
    }
  } catch {
    // continue
  }
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      news_stored_count: 0,
      news_ok: ok,
      news_skipped: skipped,
    },
  },
];
`;
const prepareUsptoQueryCode = `// Canonical source for PII-03 "Prepare USPTO Query" Code node.
// Builds ODP Patent File Wrapper assignee/applicant search when uspto_patents is enabled (Slice E6).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function searchTokenFromLegalName(legalName) {
  const stop = new Set([
    'INC',
    'INCORPORATED',
    'CORP',
    'CORPORATION',
    'LTD',
    'LIMITED',
    'LLC',
    'CO',
    'COMPANY',
    'PLC',
    'LP',
    'LLP',
    'THE',
    'AND',
    'OF',
    'PHARMACEUTICALS',
    'PHARMACEUTICAL',
    'PHARMA',
    'BIOTECH',
    'BIOTECHNOLOGY',
    'THERAPEUTICS',
    'BIOSCIENCES',
    'SCIENCES',
    'LABORATORIES',
    'LABS',
    'HOLDINGS',
    'GROUP',
    'USA',
    'US',
  ]);
  const tokens = String(legalName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\\s]/g, ' ')
    .split(/\\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
  return tokens[0] || null;
}

const validated = nodeJson('Validate Collection Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Collection Config') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || {};
const collectors = collection.collectors || {};
const usptoCfg = collectors.uspto_patents || {};
const enabled = usptoCfg.enabled === true;
const limit = Number(collection.uspto_patents_limit ?? usptoCfg.limit ?? 25);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || null;
const ticker = String(validated.ticker || caseRow.ticker || '')
  .trim()
  .toUpperCase();
const searchToken = searchTokenFromLegalName(legalName);

let skip_fetch = true;
let skip_reason = null;
let query = '';

if (!enabled) {
  skip_reason = 'collector_disabled';
} else if (!searchToken) {
  skip_reason = 'search_token_missing';
} else {
  skip_fetch = false;
  const quoted = '"' + searchToken + '"';
  query =
    '(assignmentBag.assigneeBag.assigneeNameText:' +
    quoted +
    ' OR applicationMetaData.applicantBag.applicantNameText:' +
    quoted +
    ')';
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'uspto_patents',
      enabled,
      skip_fetch,
      skip_reason,
      search_token: searchToken,
      uspto_patents_limit: limit,
      query,
    },
  },
];
`;
const normalizeUsptoPatentsEvidenceCode = `// Canonical source for PII-03 "Normalize USPTO Patents Evidence" Code node.
// Compact ODP Patent File Wrapper facts (Slice E6) — no PDF/HTML bodies.

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
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function toSqlDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\\d{4}-\\d{2}$/.test(s)) return s + '-01';
  if (/^\\d{4}$/.test(s)) return s + '-01-01';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function truncate(text, max) {
  const s = safeText(text);
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function firstName(bag, keys) {
  if (!bag || typeof bag !== 'object') return null;
  for (const key of keys) {
    const v = bag[key];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return safeText(v);
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function pickRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.patentFileWrapperDataBag)) return payload.patentFileWrapperDataBag;
  if (Array.isArray(payload.patentFileWrapperDataBagBag)) {
    return payload.patentFileWrapperDataBagBag;
  }
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const prepareRow = nodeJson('Prepare USPTO Query') || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const usptoCfg = collectors.uspto_patents || {};
const enabled = usptoCfg.enabled === true;
const limit = Number(
  prepareRow.uspto_patents_limit ?? collection.uspto_patents_limit ?? usptoCfg.limit ?? 25,
);

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || prepareRow.legal_name || item.legal_name || null;
const ticker = String(
  validated.ticker || caseRow.ticker || prepareRow.ticker || item.ticker || '',
)
  .trim()
  .toUpperCase();
const searchToken = prepareRow.search_token || null;

if (!enabled) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'uspto_patents',
        ok: true,
        skipped: true,
        error: null,
        documents: [],
        document_count: 0,
      },
    },
  ];
}

const payload = item && !Array.isArray(item) ? item : {};
const rows = pickRows(payload);
const statusCode = Number(payload.statusCode || 0);
const errMsg =
  (typeof payload.error === 'string' && payload.error) ||
  (payload.error && payload.error.message) ||
  (statusCode >= 400 ? payload.message : null) ||
  null;
const hardFail = Boolean(errMsg) || (statusCode >= 400 && !rows.length);
if (hardFail && !rows.length) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'uspto_patents',
        ok: false,
        skipped: false,
        error: 'uspto_fetch_failed',
        documents: [],
        document_count: 0,
      },
    },
  ];
}

const documents = [];
const seen = new Set();

for (const row of rows.slice(0, Math.max(1, limit))) {
  if (!row || typeof row !== 'object') continue;
  const metaApp = row.applicationMetaData || row.application_meta_data || {};
  const appNumber = firstName(row, ['applicationNumberText', 'application_number_text']) ||
    firstName(metaApp, ['applicationNumberText', 'applicationNumber']);
  const patentNumber = firstName(metaApp, ['patentNumber', 'patentNumberText', 'patent_number']);
  const title = firstName(metaApp, ['inventionTitle', 'invention_title', 'title']) || '';
  if (!appNumber && !patentNumber && !title) continue;

  const stable =
    'uspto-app-' +
    (appNumber || patentNumber || sha256Hex(title).slice(0, 16)).replace(/[^A-Za-z0-9-]/g, '');
  if (seen.has(stable)) continue;
  seen.add(stable);

  const filingDate = toSqlDate(
    firstName(metaApp, ['filingDate', 'filing_date', 'applicationFilingDate']),
  );
  const grantDate = toSqlDate(firstName(metaApp, ['grantDate', 'grant_date', 'patentGrantDate']));
  const statusText = firstName(metaApp, [
    'applicationStatusDescriptionText',
    'applicationStatusDescription',
    'status',
  ]);
  const pubDate = grantDate || filingDate;
  const displayTitle = truncate(
    (patentNumber ? 'US' + patentNumber + ' — ' : '') + (title || appNumber || stable),
    200,
  );

  const body = {
    kind: 'uspto_patent_file_wrapper',
    application_number: appNumber,
    patent_number: patentNumber,
    invention_title: title,
    filing_date: filingDate || null,
    grant_date: grantDate || null,
  };
  const meta = {
    collector: 'uspto_patents',
    mode: 'patent_file_wrapper_compact',
    search_token: searchToken,
    application_number: appNumber,
    patent_number: patentNumber,
    invention_title: title,
    filing_date: filingDate || null,
    grant_date: grantDate || null,
    publication_date: pubDate || null,
    application_status: statusText,
  };
  const chunkText = safeText(
    'USPTO ' +
      (patentNumber ? 'patent ' + patentNumber : 'application ' + (appNumber || 'unknown')) +
      (pubDate ? ' ' + pubDate : '') +
      ': ' +
      (title || 'untitled') +
      (statusText ? ' [' + statusText + ']' : ''),
  );

  documents.push({
    source_type: 'uspto_patent',
    publisher: 'USPTO',
    stable_source_id: stable,
    canonical_url: appNumber
      ? 'https://data.uspto.gov/patent-file-wrapper/search?q=' + encodeURIComponent(appNumber)
      : 'https://data.uspto.gov/apis/patent-file-wrapper/search',
    title: displayTitle,
    publication_date: pubDate,
    content_sha256: sha256Hex(JSON.stringify(body)),
    metadata_b64: toBase64(meta),
    chunk_text: chunkText,
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'uspto_patents',
      ok: true,
      skipped: false,
      error: null,
      documents,
      document_count: documents.length,
      search_token: searchToken,
      api_count: Number(payload.count || payload.total || rows.length || 0),
    },
  },
];
`;
const countUsptoUpsertsCode = `// Count USPTO patent upsert results for PII-03 coverage.

let items = [];
try {
  items = $('Upsert USPTO Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
let caseId = null;
let companyId = null;

try {
  const patents = $('Normalize USPTO Patents Evidence').first().json;
  caseId = patents.case_id;
  companyId = patents.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
  companyId = items[0] && items[0].json.company_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      patents_stored_count: items.length,
      patents_ok: true,
    },
  },
];
`;
const prepareUsptoZeroCountCode = `// Prepare zero USPTO patents count when collector skipped or no matches.

let caseId = null;
let companyId = null;
let skipped = false;
let ok = true;

try {
  const prep = $('Prepare USPTO Query').first().json;
  caseId = prep.case_id;
  companyId = prep.company_id;
  skipped = prep.skip_fetch === true || prep.enabled === false;
} catch {
  // continue
}

try {
  const patents = $('Normalize USPTO Patents Evidence').first().json;
  caseId = caseId || patents.case_id;
  companyId = companyId || patents.company_id;
  skipped = skipped || patents.skipped === true;
  ok = patents.ok !== false;
} catch {
  // continue
}

try {
  if (!caseId) {
    const news = $('Count Company News Upserts').first().json;
    caseId = news.case_id;
    companyId = news.company_id;
  }
} catch {
  try {
    if (!caseId) {
      const zero = $('Prepare Company News Zero Count').first().json;
      caseId = zero.case_id;
      companyId = zero.company_id;
    }
  } catch {
    // continue
  }
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      patents_stored_count: 0,
      patents_ok: ok,
      patents_skipped: skipped,
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
const xbrlNorm = nodeJson('Normalize SEC XBRL Facts') || item.xbrl || {};
const fdaNorm = nodeJson('Normalize OpenFDA Evidence') || item.fda || {};
const fdaPrep = nodeJson('Prepare OpenFDA Query') || {};
const newsNorm = nodeJson('Normalize Company News Evidence') || item.news || {};
const newsPrep = nodeJson('Prepare Company News Query') || {};
const patentsNorm = nodeJson('Normalize USPTO Patents Evidence') || item.patents || {};
const patentsPrep = nodeJson('Prepare USPTO Query') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || item.collection || {};
const minSec = Number(collection.min_sec_documents ?? 1);
const partialNeedsHuman = collection.partial_requires_human_review === true;
const xbrlEnabled =
  collection.collectors &&
  collection.collectors.sec_filing_bodies &&
  collection.collectors.sec_filing_bodies.enabled === true;
const fdaEnabled =
  (collection.collectors &&
    collection.collectors.fda_openfda &&
    collection.collectors.fda_openfda.enabled === true) ||
  fdaPrep.enabled === true;
const newsEnabled =
  (collection.collectors &&
    collection.collectors.company_ir &&
    collection.collectors.company_ir.enabled === true) ||
  newsPrep.enabled === true;
const patentsEnabled =
  (collection.collectors &&
    collection.collectors.uspto_patents &&
    collection.collectors.uspto_patents.enabled === true) ||
  patentsPrep.enabled === true;

const secAttempted = countItems('Expand SEC Documents') || Number(secNorm.document_count || 0);
const ctAttempted = countItems('Expand CT.gov Documents') || Number(ctNorm.document_count || 0);

const secStored = Number(
  item.sec_stored_count ?? nodeJson('Count SEC Upserts')?.sec_stored_count ?? secAttempted,
);
const ctStored = Number(
  item.ct_stored_count ?? nodeJson('Count CT.gov Upserts')?.ct_stored_count ?? ctAttempted,
);
const xbrlStored = Number(
  item.xbrl_stored_count ??
    nodeJson('Count XBRL Upserts')?.xbrl_stored_count ??
    nodeJson('Prepare XBRL Zero Count')?.xbrl_stored_count ??
    0,
);
const xbrlMetrics = Number(
  item.xbrl_metric_count ?? nodeJson('Count XBRL Upserts')?.xbrl_metric_count ?? 0,
);
const fdaStored = Number(
  item.fda_stored_count ??
    nodeJson('Count FDA Upserts')?.fda_stored_count ??
    nodeJson('Prepare FDA Zero Count')?.fda_stored_count ??
    0,
);
const newsStored = Number(
  item.news_stored_count ??
    nodeJson('Count Company News Upserts')?.news_stored_count ??
    nodeJson('Prepare Company News Zero Count')?.news_stored_count ??
    0,
);
const patentsStored = Number(
  item.patents_stored_count ??
    nodeJson('Count USPTO Upserts')?.patents_stored_count ??
    nodeJson('Prepare USPTO Zero Count')?.patents_stored_count ??
    0,
);

const secOk = secNorm.ok === true && secStored >= minSec;
const secFailed = secNorm.ok === false;
const ctFailed = ctNorm.ok === false;
const xbrlOk =
  !xbrlEnabled || xbrlNorm.skipped === true || xbrlNorm.ok === true || xbrlStored > 0;
const xbrlFailed = xbrlEnabled && xbrlNorm.skipped !== true && xbrlNorm.ok === false && xbrlStored < 1;
const fdaSkipped =
  !fdaEnabled ||
  fdaNorm.skipped === true ||
  fdaPrep.skip_fetch === true ||
  nodeJson('Prepare FDA Zero Count')?.fda_skipped === true;
const fdaOk =
  !fdaEnabled ||
  fdaSkipped ||
  fdaNorm.ok === true ||
  fdaStored > 0 ||
  nodeJson('Count FDA Upserts')?.fda_ok === true;
const fdaFailed = fdaEnabled && !fdaSkipped && fdaNorm.ok === false && fdaStored < 1;
const newsSkipped =
  !newsEnabled ||
  newsNorm.skipped === true ||
  newsPrep.skip_fetch === true ||
  nodeJson('Prepare Company News Zero Count')?.news_skipped === true;
const newsOk =
  !newsEnabled ||
  newsSkipped ||
  newsNorm.ok === true ||
  newsStored > 0 ||
  nodeJson('Count Company News Upserts')?.news_ok === true;
const newsFailed = newsEnabled && !newsSkipped && newsNorm.ok === false && newsStored < 1;
const patentsSkipped =
  !patentsEnabled ||
  patentsNorm.skipped === true ||
  patentsPrep.skip_fetch === true ||
  nodeJson('Prepare USPTO Zero Count')?.patents_skipped === true;
const patentsOk =
  !patentsEnabled ||
  patentsSkipped ||
  patentsNorm.ok === true ||
  patentsStored > 0 ||
  nodeJson('Count USPTO Upserts')?.patents_ok === true;
const patentsFailed =
  patentsEnabled && !patentsSkipped && patentsNorm.ok === false && patentsStored < 1;

const totalStored =
  secStored +
  (ctFailed ? 0 : ctStored) +
  xbrlStored +
  fdaStored +
  newsStored +
  patentsStored;
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
  {
    key: 'sec_filing_bodies',
    ok: xbrlOk,
    skipped: !xbrlEnabled || xbrlNorm.skipped === true,
    error: xbrlFailed ? xbrlNorm.error || 'xbrl_failed' : null,
    document_count: xbrlStored,
    metric_count: xbrlMetrics,
  },
  {
    key: 'fda_openfda',
    ok: fdaOk,
    skipped: !fdaEnabled || fdaSkipped,
    error: fdaFailed ? fdaNorm.error || 'fda_failed' : null,
    document_count: fdaStored,
  },
  {
    key: 'company_ir',
    ok: newsOk,
    skipped: !newsEnabled || newsSkipped,
    error: newsFailed ? newsNorm.error || 'company_news_failed' : null,
    document_count: newsStored,
  },
  {
    key: 'uspto_patents',
    ok: patentsOk,
    skipped: !patentsEnabled || patentsSkipped,
    error: patentsFailed ? patentsNorm.error || 'uspto_failed' : null,
    document_count: patentsStored,
  },
];

let outcome;
let next_state;
let reason;

if (secOk && !ctFailed) {
  outcome = 'COLLECTED';
  next_state = 'ANALYZING';
  reason = xbrlFailed
    ? 'minimum_coverage_met_xbrl_partial'
    : fdaFailed
      ? 'minimum_coverage_met_fda_partial'
      : newsFailed
        ? 'minimum_coverage_met_news_partial'
        : patentsFailed
          ? 'minimum_coverage_met_patents_partial'
          : 'minimum_coverage_met';
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
  xbrl_stored_count: xbrlStored,
  xbrl_metric_count: xbrlMetrics,
  fda_stored_count: fdaStored,
  news_stored_count: newsStored,
  patents_stored_count: patentsStored,
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
      company_id:
        secNorm.company_id ||
        ctNorm.company_id ||
        fdaNorm.company_id ||
        newsNorm.company_id ||
        patentsNorm.company_id ||
        validated.company_id ||
        null,
      ticker: validated.ticker || item.ticker,
      exchange: validated.exchange || item.exchange,
      cik: secNorm.cik || validated.cik || null,
      legal_name:
        secNorm.legal_name ||
        ctNorm.legal_name ||
        fdaNorm.legal_name ||
        newsNorm.legal_name ||
        patentsNorm.legal_name ||
        null,
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

const upsertEvidenceChunkSql =
  "INSERT INTO evidence_chunks (evidence_id, chunk_index, chunk_text, token_estimate, metadata_json) VALUES ($1::uuid, COALESCE(NULLIF(NULLIF(TRIM($2), ''), 'null')::integer, 0), $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::integer, convert_from(decode($5, 'base64'), 'UTF8')::jsonb) ON CONFLICT (evidence_id, chunk_index) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, token_estimate = EXCLUDED.token_estimate, metadata_json = EXCLUDED.metadata_json RETURNING id AS chunk_id, evidence_id";

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

const prepareSecEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare SEC Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasSecChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has SEC Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertSecEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert SEC Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
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

const fetchSecCompanyfacts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch SEC Companyfacts',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: expr(
        '=https://data.sec.gov/api/xbrl/companyfacts/CIK{{ $("Load Case And Company").item.json.cik }}.json',
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
        timeout: 90000,
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

const normalizeSecXbrlEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize SEC XBRL Facts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeSecXbrlEvidenceCode,
    },
  },
});

const expandXbrlDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand XBRL Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasXbrlDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has XBRL Docs?',
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

const upsertXbrlEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'xbrl_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertXbrlEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertXbrlEvidenceSql,
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

const prepareXbrlFinancialUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare XBRL Financial Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareXbrlFinancialUpsertsCode,
    },
  },
});

const upsertXbrlFinancialPeriod = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Financial Period',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO financial_periods (company_id, case_id, period_label, period_start, period_end, fiscal_year, fiscal_quarter, source_evidence_id) VALUES ($1::uuid, $2::uuid, $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::date, NULLIF(NULLIF(TRIM($5), ''), 'null')::date, NULLIF(NULLIF(TRIM($6), ''), 'null')::integer, NULLIF(NULLIF(TRIM($7), ''), 'null')::integer, $8::uuid) ON CONFLICT (company_id, period_label) DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, financial_periods.case_id), period_end = COALESCE(EXCLUDED.period_end, financial_periods.period_end), fiscal_year = COALESCE(EXCLUDED.fiscal_year, financial_periods.fiscal_year), fiscal_quarter = COALESCE(EXCLUDED.fiscal_quarter, financial_periods.fiscal_quarter), source_evidence_id = COALESCE(EXCLUDED.source_evidence_id, financial_periods.source_evidence_id), updated_at = NOW() RETURNING id AS financial_period_id, company_id, case_id",
      options: {
        queryReplacement: expr(
          '{{ $json.company_id }},{{ $json.case_id }},{{ $json.period_label }},{{ $json.period_start }},{{ $json.period_end }},{{ $json.fiscal_year }},{{ $json.fiscal_quarter }},{{ $json.evidence_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertXbrlFinancialMetrics = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Financial Metrics',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH metrics AS (SELECT * FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS x(metric_key text, metric_value numeric, currency text, unit text, scale text, assumption_set text, calculation_notes text)) INSERT INTO financial_metrics (financial_period_id, metric_key, metric_value, currency, unit, scale, assumption_set, source_evidence_id, calculation_notes) SELECT $1::uuid, metric_key, metric_value, COALESCE(currency, 'USD'), COALESCE(unit, 'USD'), COALESCE(scale, 'as_reported'), COALESCE(NULLIF(assumption_set, ''), 'reported'), $3::uuid, calculation_notes FROM metrics ON CONFLICT (financial_period_id, metric_key, assumption_set) DO UPDATE SET metric_value = EXCLUDED.metric_value, currency = EXCLUDED.currency, unit = EXCLUDED.unit, scale = EXCLUDED.scale, source_evidence_id = EXCLUDED.source_evidence_id, calculation_notes = EXCLUDED.calculation_notes RETURNING id AS financial_metric_id, metric_key",
      options: {
        queryReplacement: expr(
          '{{ $json.financial_period_id }},{{ $("Prepare XBRL Financial Upserts").item.json.metrics_b64 }},{{ $("Prepare XBRL Financial Upserts").item.json.evidence_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertXbrlEvidenceChunk = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Evidence Chunk',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $("Prepare XBRL Financial Upserts").item.json.evidence_id }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_index }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_text }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_token_estimate }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countXbrlUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count XBRL Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countXbrlUpsertsCode,
    },
  },
});

const prepareXbrlZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare XBRL Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareXbrlZeroCountCode,
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

const prepareCtgovEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare CT.gov Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasCtgovChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has CT.gov Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertCtgovEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert CT.gov Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
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

const prepareOpenfdaQuery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare OpenFDA Query',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareOpenfdaQueryCode,
    },
  },
});

const openfdaEnabled = ifElse({
  version: 2.3,
  config: {
    name: 'OpenFDA Enabled?',
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
            leftValue: expr('{{ $json.skip_fetch }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const fetchOpenfdaDrugsfda = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch OpenFDA DrugsFDA',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: expr('={{ $("Prepare OpenFDA Query").item.json.openfda_url }}'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' },
          {
            name: 'User-Agent',
            value: 'PI Opportunity Investigator teacherjoseluis@gmail.com',
          },
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

const normalizeFdaOpenfdaEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize OpenFDA Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeFdaOpenfdaEvidenceCode,
    },
  },
});

const expandFdaDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand FDA Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasFdaDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has FDA Docs?',
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

const upsertFdaEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'fda_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertFdaEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert FDA Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertFdaEvidenceSql,
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

const prepareFdaEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare FDA Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasFdaChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has FDA Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertFdaEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert FDA Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countFdaUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count FDA Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countFdaUpsertsCode,
    },
  },
});

const prepareFdaZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare FDA Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareFdaZeroCountCode,
    },
  },
});

const finnhubAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

const prepareCompanyNewsQuery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Company News Query',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCompanyNewsQueryCode,
    },
  },
});

const companyNewsEnabled = ifElse({
  version: 2.3,
  config: {
    name: 'Company News Enabled?',
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
            leftValue: expr('{{ $json.skip_fetch }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const fetchCompanyNews = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Company News',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://finnhub.io/api/v1/company-news',
      ...finnhubAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Prepare Company News Query").item.json.ticker }}'),
          },
          {
            name: 'from',
            value: expr('{{ $("Prepare Company News Query").item.json.from_date }}'),
          },
          {
            name: 'to',
            value: expr('{{ $("Prepare Company News Query").item.json.to_date }}'),
          },
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
    credentials: {
      httpQueryAuth: newCredential('Finnhub API key'),
    },
  },
});

const normalizeCompanyNewsEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Company News Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeCompanyNewsEvidenceCode,
    },
  },
});

const expandCompanyNewsDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Company News Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasCompanyNewsDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has Company News Docs?',
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

const upsertCompanyNewsEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'secondary', 'retrieved', 'news_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertCompanyNewsEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Company News Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertCompanyNewsEvidenceSql,
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

const prepareCompanyNewsEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Company News Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasCompanyNewsChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has Company News Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertCompanyNewsEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Company News Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countCompanyNewsUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count Company News Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countCompanyNewsUpsertsCode,
    },
  },
});

const prepareCompanyNewsZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Company News Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCompanyNewsZeroCountCode,
    },
  },
});

const usptoAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
};

const prepareUsptoQuery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare USPTO Query',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareUsptoQueryCode,
    },
  },
});

const usptoEnabled = ifElse({
  version: 2.3,
  config: {
    name: 'USPTO Patents Enabled?',
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
            leftValue: expr('{{ $json.skip_fetch }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const fetchUsptoPatents = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch USPTO Patents',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.uspto.gov/api/v1/patent/applications/search',
      ...usptoAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'q',
            value: expr('{{ $("Prepare USPTO Query").item.json.query }}'),
          },
          {
            name: 'limit',
            value: expr('{{ $("Prepare USPTO Query").item.json.uspto_patents_limit }}'),
          },
          {
            name: 'fields',
            value:
              'applicationNumberText,applicationMetaData.inventionTitle,applicationMetaData.patentNumber,applicationMetaData.filingDate,applicationMetaData.grantDate,applicationMetaData.applicationStatusDescriptionText',
          },
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
    credentials: {
      httpHeaderAuth: newCredential('USPTO ODP API Key'),
    },
  },
});

const normalizeUsptoPatentsEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize USPTO Patents Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeUsptoPatentsEvidenceCode,
    },
  },
});

const expandUsptoDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand USPTO Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasUsptoDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has USPTO Docs?',
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

const upsertUsptoEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'patent_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertUsptoEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert USPTO Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertUsptoEvidenceSql,
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

const prepareUsptoEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare USPTO Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasUsptoChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has USPTO Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertUsptoEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert USPTO Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countUsptoUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count USPTO Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countUsptoUpsertsCode,
    },
  },
});

const prepareUsptoZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare USPTO Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareUsptoZeroCountCode,
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
  '## PII-03 Evidence Collector\nSEC + CT.gov + E1 XBRL + E4 openFDA + E5 Finnhub company-news + E6 USPTO patents.\nDeferred: full HTML bodies, object storage.',
  [collectionTrigger, validateCollectionRequest, loadCaseAndCompany],
  { color: 4 },
);

const collectorsNote = sticky(
  '## Collectors\nSEC Fair Access User-Agent required.\nUpsert evidence_documents by content_sha256; Finnhub for news; USPTO ODP header auth for Patent File Wrapper.',
  [
    fetchSecSubmissions,
    fetchSecCompanyfacts,
    fetchCtgovStudies,
    fetchOpenfdaDrugsfda,
    fetchCompanyNews,
    fetchUsptoPatents,
    upsertSecEvidence,
  ],
  { color: 5 },
);

const coverageNote = sticky(
  '## Coverage\nmin_sec_documents default 1 → ANALYZING.\nXBRL/FDA/news/USPTO failure is partial (does not block ANALYZING when SEC/CT ok).\nE7: non-XBRL collectors write evidence_chunks after document upsert when chunk_text present.',
  [evaluateCollectionCoverage, advanceCaseState, buildCollectionResult],
  { color: 6 },
);

const finishPath = evaluateCollectionCoverage
  .to(advanceCaseState)
  .to(logCollectionState)
  .to(logWorkflowRun)
  .to(mergeCollectionOutput)
  .to(buildCollectionResult);

const patentsAndFinish = prepareUsptoQuery.to(
  usptoEnabled
    .onTrue(
      fetchUsptoPatents.to(
        normalizeUsptoPatentsEvidence.to(
          expandUsptoDocuments.to(
            hasUsptoDocs
              .onTrue(
                upsertUsptoEvidence.to(
                  prepareUsptoEvidenceChunks.to(
                    hasUsptoChunks
                      .onTrue(upsertUsptoEvidenceChunks.to(countUsptoUpserts.to(finishPath)))
                      .onFalse(countUsptoUpserts.to(finishPath)),
                  ),
                ),
              )
              .onFalse(prepareUsptoZeroCount.to(finishPath)),
          ),
        ),
      ),
    )
    .onFalse(prepareUsptoZeroCount.to(finishPath)),
);

const newsAndFinish = prepareCompanyNewsQuery.to(
  companyNewsEnabled
    .onTrue(
      fetchCompanyNews.to(
        normalizeCompanyNewsEvidence.to(
          expandCompanyNewsDocuments.to(
            hasCompanyNewsDocs
              .onTrue(
                upsertCompanyNewsEvidence.to(
                  prepareCompanyNewsEvidenceChunks.to(
                    hasCompanyNewsChunks
                      .onTrue(
                        upsertCompanyNewsEvidenceChunks.to(
                          countCompanyNewsUpserts.to(patentsAndFinish),
                        ),
                      )
                      .onFalse(countCompanyNewsUpserts.to(patentsAndFinish)),
                  ),
                ),
              )
              .onFalse(prepareCompanyNewsZeroCount.to(patentsAndFinish)),
          ),
        ),
      ),
    )
    .onFalse(prepareCompanyNewsZeroCount.to(patentsAndFinish)),
);

const fdaAndFinish = prepareOpenfdaQuery.to(
  openfdaEnabled
    .onTrue(
      fetchOpenfdaDrugsfda.to(
        normalizeFdaOpenfdaEvidence.to(
          expandFdaDocuments.to(
            hasFdaDocs
              .onTrue(
                upsertFdaEvidence.to(
                  prepareFdaEvidenceChunks.to(
                    hasFdaChunks
                      .onTrue(upsertFdaEvidenceChunks.to(countFdaUpserts.to(newsAndFinish)))
                      .onFalse(countFdaUpserts.to(newsAndFinish)),
                  ),
                ),
              )
              .onFalse(prepareFdaZeroCount.to(newsAndFinish)),
          ),
        ),
      ),
    )
    .onFalse(prepareFdaZeroCount.to(newsAndFinish)),
);

const ctgovAndFinish = fetchCtgovStudies.to(
  normalizeCtgovEvidence.to(
    expandCtgovDocuments.to(
      hasCtgovDocs
        .onTrue(
          upsertCtgovEvidence.to(
            prepareCtgovEvidenceChunks.to(
              hasCtgovChunks
                .onTrue(upsertCtgovEvidenceChunks.to(countCtgovUpserts.to(fdaAndFinish)))
                .onFalse(countCtgovUpserts.to(fdaAndFinish)),
            ),
          ),
        )
        .onFalse(prepareCtgovZeroCount.to(fdaAndFinish)),
    ),
  ),
);

const xbrlAndFinish = fetchSecCompanyfacts.to(
  normalizeSecXbrlEvidence.to(
    expandXbrlDocuments.to(
      hasXbrlDocs
        .onTrue(
          upsertXbrlEvidence.to(
            prepareXbrlFinancialUpserts.to(
              upsertXbrlFinancialPeriod.to(
                upsertXbrlFinancialMetrics.to(
                  upsertXbrlEvidenceChunk.to(countXbrlUpserts.to(ctgovAndFinish)),
                ),
              ),
            ),
          ),
        )
        .onFalse(prepareXbrlZeroCount.to(ctgovAndFinish)),
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
                    .onTrue(
                      upsertSecEvidence.to(
                        prepareSecEvidenceChunks.to(
                          hasSecChunks
                            .onTrue(upsertSecEvidenceChunks.to(countSecUpserts.to(xbrlAndFinish)))
                            .onFalse(countSecUpserts.to(xbrlAndFinish)),
                        ),
                      ),
                    )
                    .onFalse(prepareSecZeroCount.to(xbrlAndFinish)),
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
