import { workflow, node, trigger, newCredential } from '@n8n/workflow-sdk';

const manual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Trigger', parameters: {} },
});

const applyCourtlistener = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Enable CourtListener Collector',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    jsonb_set(
      COALESCE(gates_json, '{}'::jsonb),
      '{collection,collectors,courtlistener}',
      jsonb_build_object(
        'enabled', true,
        'description', 'Slice E8 — CourtListener search v4 compact docket/opinion hits (no opinion HTML/PDF)',
        'mode', 'search_v4_compact',
        'limit', 10
      ),
      true
    ),
    '{collection,courtlistener_limit}',
    '10'::jsonb,
    true
  ),
  description = CASE
    WHEN COALESCE(description, '') LIKE '%courtlistener E8%' THEN description
    ELSE COALESCE(description, '') || ' | collection: courtlistener E8 search v4 compact enabled'
  END,
  updated_at = NOW()
WHERE is_active = TRUE
RETURNING id, version_label`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ id: 'ok' }],
});

const applyScoringMap = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Align Business Score Category',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,scoring,category_map,business_quality}',
    '"business_financial"'::jsonb,
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'scoring' -> 'category_map' IS NOT NULL
RETURNING id, version_label`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ id: 'ok' }],
});

const applyFinancialCopy = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Soften Financial Insufficient Copy',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,financial,insufficient_topics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'burn_runway' THEN
            jsonb_build_object(
              'key', 'burn_runway',
              'text', 'INSUFFICIENT_EVIDENCE: Cash burn and runway cannot be calculated without operating cash flow in XBRL companyfacts (E8) or filing-body period financials.'
            )
          WHEN elem->>'key' = 'margins' THEN
            jsonb_build_object(
              'key', 'margins',
              'text', 'INSUFFICIENT_EVIDENCE: Gross/operating margins need income-statement XBRL (E8) or filing-body financials.'
            )
          WHEN elem->>'key' = 'dilution' THEN
            jsonb_build_object(
              'key', 'dilution',
              'text', 'INSUFFICIENT_EVIDENCE: Dilution magnitude remains unquantified without offering details; E8 XBRL share counts inventory outstanding shares but not issuance economics.'
            )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(
        COALESCE(gates_json -> 'analysis' -> 'financial' -> 'insufficient_topics', '[]'::jsonb)
      ) AS elem
    ),
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'financial' -> 'insufficient_topics' IS NOT NULL
RETURNING id, version_label`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ id: 'ok' }],
});

const applyPipelineCopy = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Soften Pipeline Insufficient Copy',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,pipeline,insufficient_topics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'enrollment_and_timelines' THEN
            jsonb_build_object(
              'key', 'enrollment_and_timelines',
              'text', 'INSUFFICIENT_EVIDENCE: Enrollment targets vs actual and milestone windows still need results modules; E8 stores CT.gov designModule enrollment counts when present.'
            )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(
        COALESCE(gates_json -> 'analysis' -> 'pipeline' -> 'insufficient_topics', '[]'::jsonb)
      ) AS elem
    ),
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'pipeline' -> 'insufficient_topics' IS NOT NULL
RETURNING id, version_label`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ id: 'ok' }],
});

const applyRiskCopy = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Soften Risk Insufficient Copy',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,risk,insufficient_topics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'legal_compliance_litigation' THEN
            jsonb_build_object(
              'key', 'legal_compliance_litigation',
              'text', 'INSUFFICIENT_EVIDENCE: Litigation pleadings and compliance findings still need docket-body review; E8 CourtListener search inventories public-record hits.'
            )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(
        COALESCE(gates_json -> 'analysis' -> 'risk' -> 'insufficient_topics', '[]'::jsonb)
      ) AS elem
    ),
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'risk' -> 'insufficient_topics' IS NOT NULL
RETURNING id, gates_json->'collection'->'collectors'->'courtlistener' AS courtlistener, gates_json->'analysis'->'scoring'->'category_map'->'business_quality' AS business_quality`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
  output: [{ courtlistener: { enabled: true }, business_quality: 'business_financial' }],
});

export default workflow('tmp-e8-apply-024', 'TMP E8 Apply Migration 024')
  .add(manual)
  .to(applyCourtlistener)
  .to(applyScoringMap)
  .to(applyFinancialCopy)
  .to(applyPipelineCopy)
  .to(applyRiskCopy);
