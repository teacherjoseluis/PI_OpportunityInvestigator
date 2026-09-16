-- Slice E6: enable USPTO ODP Patent File Wrapper compact collector (no PDF/HTML blobs).

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    jsonb_set(
      COALESCE(gates_json, '{}'::jsonb),
      '{collection,collectors,uspto_patents}',
      jsonb_build_object(
        'enabled', true,
        'description', 'Slice E6 — USPTO ODP Patent File Wrapper compact application/patent facts (no PDF/HTML blobs)',
        'mode', 'patent_file_wrapper_compact',
        'limit', 25
      ),
      true
    ),
    '{collection,uspto_patents_limit}',
    '25'::jsonb,
    true
  ),
  description = COALESCE(description, '') || ' | collection: uspto_patents E6 patent file wrapper enabled',
  updated_at = NOW()
WHERE is_active = TRUE;

-- Soften patent_exclusivity insufficient copy to note E6 inventory vs Orange Book exclusivity.
UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,risk,insufficient_topics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'patent_exclusivity' THEN
            jsonb_build_object(
              'key', 'patent_exclusivity',
              'text', 'INSUFFICIENT_EVIDENCE: Orange Book exclusivity, claim scope, and patent litigation still need deeper IP sources; E6 USPTO File Wrapper can inventory applications/patents but not exclusivity economics.'
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
