-- Enrich active configuration eligibility_json for PII-02 (TwelveData-aligned).

UPDATE configuration_versions
SET
  eligibility_json = '{
    "allowed_exchanges": ["NYSE", "NASDAQ", "AMEX"],
    "sectors": ["Healthcare"],
    "industries": [
      "Biotechnology",
      "Drug Manufacturers—General",
      "Drug Manufacturers—Specialty & Generic",
      "Drug Manufacturers - General",
      "Drug Manufacturers - Specialty & Generic",
      "Pharmaceutical Preparations",
      "Biological Products",
      "Diagnostics & Research",
      "Medical Care Facilities",
      "Health Information Services"
    ],
    "industry_keywords": [
      "PHARMA",
      "BIOTECH",
      "BIOLOG",
      "THERAPEUTIC",
      "ONCOLOG",
      "GENOM"
    ],
    "industry_mismatch_outcome": "PASS_WITH_EXCEPTION",
    "prefer_mid_small_cap": true,
    "market_cap_enabled": true,
    "market_cap_min_usd": 100000000,
    "market_cap_max_usd": 50000000000,
    "adv_enabled": true,
    "min_avg_daily_dollar_volume_usd": 1000000,
    "duplicate_lookback_days": 30,
    "disallowed_security_types": [
      "ETF",
      "Exchange-Traded Note",
      "Mutual Fund",
      "Closed-end Fund",
      "Bond Fund",
      "REIT",
      "Unit",
      "Right",
      "Warrant",
      "Structured Product",
      "Trust",
      "Preferred Stock"
    ],
    "shell_name_patterns": [
      "SPAC",
      "BLANK CHECK",
      "ACQUISITION CORP",
      "ACQUISITION CORPORATION",
      "ACQUISITION CO",
      "SHELL COMPANY"
    ],
    "shell_match_outcome": "FAIL"
  }'::jsonb,
  description = 'Eligibility v1: TwelveData profile/statistics/quote gates enabled.',
  updated_at = NOW()
WHERE is_active = TRUE;
