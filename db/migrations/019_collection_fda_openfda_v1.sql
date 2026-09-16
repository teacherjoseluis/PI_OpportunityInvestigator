-- Slice E4: enable compact openFDA Drugs@FDA collector; refresh regulatory insufficient copy.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    jsonb_set(
      COALESCE(gates_json, '{}'::jsonb),
      '{collection,collectors,fda_openfda}',
      jsonb_build_object(
        'enabled', true,
        'description', 'Slice E4 — openFDA Drugs@FDA compact application facts (no label/PDF blobs)',
        'mode', 'drugsfda_compact',
        'limit', 25
      ),
      true
    ),
    '{collection,openfda_limit}',
    '25'::jsonb,
    true
  ),
  description = COALESCE(description, '') || ' | collection: fda_openfda E4 drugsfda compact enabled',
  updated_at = NOW()
WHERE is_active = TRUE;

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis,regulatory,insufficient_topics}',
    COALESCE(gates_json -> 'analysis' -> 'regulatory' -> 'insufficient_topics', '[]'::jsonb),
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'regulatory' -> 'insufficient_topics' IS NOT NULL;

-- Replace FDA decision-calendar insufficient text to reflect E4 historical coverage gap vs forward calendar.
UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,regulatory,insufficient_topics}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'key' = 'fda_decision_calendar' THEN
            jsonb_build_object(
              'key', 'fda_decision_calendar',
              'text', 'INSUFFICIENT_EVIDENCE: Forward FDA decision calendar / upcoming PDUFA outcomes are not in Drugs@FDA compact facts; E4 provides historical application/brand inventory only.'
            )
          WHEN elem->>'key' = 'regulatory_designations' THEN
            jsonb_build_object(
              'key', 'regulatory_designations',
              'text', 'INSUFFICIENT_EVIDENCE: Breakthrough, orphan, Fast Track, RMAT, and similar designations are not present in compact Drugs@FDA application metadata (E4).'
            )
          ELSE elem
        END
      )
      FROM jsonb_array_elements(
        COALESCE(gates_json -> 'analysis' -> 'regulatory' -> 'insufficient_topics', '[]'::jsonb)
      ) AS elem
    ),
    true
  ),
  description = COALESCE(description, '') || ' | analysis.regulatory: E4 insufficient topic copy',
  updated_at = NOW()
WHERE is_active = TRUE
  AND gates_json -> 'analysis' -> 'regulatory' -> 'insufficient_topics' IS NOT NULL;
