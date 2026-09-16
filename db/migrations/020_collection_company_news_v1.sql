-- Slice E5: enable Finnhub company-news compact collector (no IR HTML blobs).

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(gates_json, '{}'::jsonb),
        '{collection,collectors,company_ir}',
        jsonb_build_object(
          'enabled', true,
          'description', 'Slice E5 — Finnhub company-news compact headlines (no article HTML blobs)',
          'mode', 'finnhub_company_news',
          'lookback_days', 90,
          'limit', 25
        ),
        true
      ),
      '{collection,company_news_lookback_days}',
      '90'::jsonb,
      true
    ),
    '{collection,company_news_limit}',
    '25'::jsonb,
    true
  ),
  description = COALESCE(description, '') || ' | collection: company_ir E5 finnhub company-news enabled',
  updated_at = NOW()
WHERE is_active = TRUE;

-- Soften partnerships insufficient copy to note E5 headline coverage vs body text.
UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,growth,insufficient_topics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'partnerships_licensing' THEN
            jsonb_build_object(
              'key', 'partnerships_licensing',
              'text', 'INSUFFICIENT_EVIDENCE: Partnerships/licensing economics still need filing-body detail; E5 Finnhub headlines can surface partnership mentions but not terms.'
            )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(
        COALESCE(gates_json -> 'analysis' -> 'growth' -> 'insufficient_topics', '[]'::jsonb)
      ) AS elem
    ),
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'growth' -> 'insufficient_topics' IS NOT NULL;
