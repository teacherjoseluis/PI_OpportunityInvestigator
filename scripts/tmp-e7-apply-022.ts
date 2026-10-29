import { workflow, node, trigger, newCredential } from '@n8n/workflow-sdk';

const manual = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Trigger', parameters: {} },
});

const applyValuation = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Apply 022 Valuation Copy',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,valuation,insufficient_topics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'net_cash_debt' THEN
            jsonb_build_object(
              'key', 'net_cash_debt',
              'text', 'INSUFFICIENT_EVIDENCE: Net cash/debt inventory closes when E1 XBRL financial_metrics exist (E7); EV-adjusted multiples and market prices still need licensed market data.'
            )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(
        COALESCE(gates_json -> 'analysis' -> 'valuation' -> 'insufficient_topics', '[]'::jsonb)
      ) AS elem
    ),
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'valuation' -> 'insufficient_topics' IS NOT NULL
RETURNING id, version_label`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const applyRisk = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Apply 022 Risk Copy',
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
          WHEN elem->>'key' = 'financial_financing_depth' THEN
            jsonb_build_object(
              'key', 'financial_financing_depth',
              'text', 'INSUFFICIENT_EVIDENCE: Balance-sheet cash/debt inventory closes when E1 XBRL metrics exist (E7); runway, covenants, and financing-need depth still need fuller liquidity analysis.'
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
RETURNING id, version_label`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const applyFinancial = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Apply 022 Financial Copy',
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
          WHEN elem->>'key' = 'dilution' THEN
            jsonb_build_object(
              'key', 'dilution',
              'text', 'INSUFFICIENT_EVIDENCE: Dilution magnitude and share-count impact remain unquantified without offering details and XBRL share counts; capital-markets form signals alone (E7 soft-close) do not quantify dilution.'
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
  description = CASE
    WHEN COALESCE(description, '') LIKE '%E7 chunk backfill%' THEN description
    ELSE COALESCE(description, '') || ' | analysis: E7 chunk backfill / analyst soft-close copy'
  END,
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'financial' -> 'insufficient_topics' IS NOT NULL
RETURNING id, version_label, description`,
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

export default workflow('tmp-e7-apply-022', 'TMP E7 Apply Migration 022')
  .add(manual)
  .to(applyValuation)
  .to(applyRisk)
  .to(applyFinancial);
