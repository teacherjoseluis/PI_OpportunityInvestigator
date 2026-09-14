-- Eligibility: Finnhub-friendly industries + higher mcap ceiling for large biopharma research.
-- TwelveData /profile and /statistics require Grow+/Pro+; Finnhub profile2 is the fallback.

UPDATE configuration_versions
SET
  eligibility_json =
    jsonb_set(
      jsonb_set(
        eligibility_json,
        '{market_cap_max_usd}',
        '150000000000'::jsonb,
        true
      ),
      '{industries}',
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(eligibility_json->'industries', '[]'::jsonb)) AS ind(val)
          WHERE ind.val = 'Pharmaceuticals'
        )
          THEN COALESCE(eligibility_json->'industries', '[]'::jsonb)
        ELSE COALESCE(eligibility_json->'industries', '[]'::jsonb) || '["Pharmaceuticals"]'::jsonb
      END,
      true
    ),
  description = COALESCE(description, '') || ' | eligibility: mcap max 150B + Pharmaceuticals; Finnhub fallback for profile/stats.',
  updated_at = NOW()
WHERE is_active = TRUE;
