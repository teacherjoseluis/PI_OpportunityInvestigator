// After regulatory claim inserts, expand claim_evidence_links rows.

function nodeAll(name) {
  try {
    return $(name).all();
  } catch {
    return [];
  }
}

const inserted = $input.all().filter((row) => row.json && row.json.claim_id);
const expanded = nodeAll('Expand Regulatory Claims').filter(
  (row) => row.json && row.json.skip_upsert !== true,
);

const links = [];

for (let i = 0; i < inserted.length; i += 1) {
  const claimId = inserted[i].json.claim_id;
  const source =
    expanded.find((row) => row.json.claim_text === inserted[i].json.claim_text) ||
    expanded[i] ||
    null;
  const evidenceIds = source
    ? Array.isArray(source.json.evidence_ids)
      ? source.json.evidence_ids
      : String(source.json.evidence_ids_csv || '')
          .split('|')
          .filter(Boolean)
    : [];

  for (const evidenceId of evidenceIds) {
    links.push({
      json: {
        claim_id: claimId,
        evidence_id: evidenceId,
        link_role: 'SUPPORTS',
        skip_link: false,
      },
    });
  }
}

if (!links.length) {
  const evalRow = (() => {
    try {
      return $('Evaluate Regulatory Catalyst').first().json;
    } catch {
      return $input.first().json || {};
    }
  })();
  return [
    {
      json: {
        skip_link: true,
        case_id: evalRow.case_id,
        claim_count: Number(evalRow.claim_count || inserted.length || 0),
        outcome: evalRow.outcome,
        next_state: evalRow.next_state,
        reason: evalRow.reason,
        insufficient_topics: evalRow.insufficient_topics || [],
        counts: evalRow.counts || {},
        metadata_b64: evalRow.metadata_b64 || '',
        ticker: evalRow.ticker,
        exchange: evalRow.exchange,
        company_id: evalRow.company_id,
        n8n_execution_id: evalRow.n8n_execution_id,
      },
    },
  ];
}

return links;
