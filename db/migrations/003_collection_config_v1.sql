-- Merge Phase 1 collection settings into active configuration_versions.gates_json.

UPDATE configuration_versions
SET
  gates_json = gates_json || '{
    "collection": {
      "sec_recent_filings_limit": 10,
      "ctgov_page_size": 20,
      "min_sec_documents": 1,
      "partial_requires_human_review": false,
      "collectors": {
        "sec_edgar": {
          "enabled": true,
          "description": "SEC EDGAR submissions index + recent filing metadata"
        },
        "clinicaltrials_gov": {
          "enabled": true,
          "description": "ClinicalTrials.gov API v2 studies by sponsor/lead"
        },
        "fda_openfda": {
          "enabled": false,
          "description": "Deferred — FDA / openFDA labels and approvals"
        },
        "company_ir": {
          "enabled": false,
          "description": "Deferred — company investor-relations releases"
        },
        "uspto_patents": {
          "enabled": false,
          "description": "Deferred — USPTO / patent sources"
        },
        "sec_filing_bodies": {
          "enabled": false,
          "description": "Deferred — full SEC filing body / XBRL fact extraction"
        }
      }
    }
  }'::jsonb,
  description = COALESCE(description, '') || ' Collection v1: SEC + ClinicalTrials.gov collectors enabled.',
  updated_at = NOW()
WHERE is_active = TRUE;
