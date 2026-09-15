// Canonical helpers + PII-03 "Normalize SEC XBRL Facts" Code node.
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
  const digits = String(cik == null ? '' : cik).replace(/\D/g, '');
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
