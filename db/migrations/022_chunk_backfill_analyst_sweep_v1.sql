-- Slice E7: soften insufficient topic texts for XBRL/form soft-closes (no collector enable).

UPDATE configuration_versions
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
  AND gates_json -> 'analysis' -> 'valuation' -> 'insufficient_topics' IS NOT NULL;

UPDATE configuration_versions
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
  AND gates_json -> 'analysis' -> 'risk' -> 'insufficient_topics' IS NOT NULL;

UPDATE configuration_versions
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
  description = COALESCE(description, '') || ' | analysis: E7 chunk backfill / analyst soft-close copy',
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'financial' -> 'insufficient_topics' IS NOT NULL;
