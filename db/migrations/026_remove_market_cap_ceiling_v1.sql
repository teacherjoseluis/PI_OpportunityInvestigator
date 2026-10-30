-- Drop the eligibility ceiling that failed names above $150B.
-- The $100M floor stays. A missing market_cap_max_usd means no upper bound.

UPDATE configuration_versions
SET
  eligibility_json = eligibility_json - 'market_cap_max_usd',
  description = CASE
    WHEN COALESCE(description, '') LIKE '%removed market-cap ceiling%' THEN description
    ELSE COALESCE(description, '') || ' | eligibility: removed market-cap ceiling; floor remains $100M.'
  END,
  updated_at = NOW()
WHERE is_active = TRUE
  AND eligibility_json -> 'market_cap_max_usd' IS NOT NULL;
