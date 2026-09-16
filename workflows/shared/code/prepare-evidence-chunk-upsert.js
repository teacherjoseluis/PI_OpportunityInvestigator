// After Upsert * Evidence: pair returned evidence_id with Expand * Documents chunk_text.
// Slice E7 — write evidence_chunks for SEC/CT/FDA/news/USPTO (XBRL already has its own path).

function nodeAll(name) {
  try {
    return $(name).all().map((row) => row.json);
  } catch {
    return [];
  }
}

const EXPAND_CANDIDATES = [
  'Expand SEC Documents',
  'Expand CT.gov Documents',
  'Expand FDA Documents',
  'Expand Company News Documents',
  'Expand USPTO Documents',
];

const upserted = $input
  .all()
  .map((row) => row.json)
  .filter((row) => row && row.evidence_id);

let expanded = [];
for (const name of EXPAND_CANDIDATES) {
  const rows = nodeAll(name).filter((row) => row && row.skip_upsert !== true);
  if (!rows.length) continue;
  // Prefer the expand set that overlaps stable_source_id with upserted rows.
  const upsertIds = new Set(upserted.map((u) => String(u.stable_source_id || '')));
  const overlap = rows.filter((r) => upsertIds.has(String(r.stable_source_id || ''))).length;
  if (overlap > 0 || rows.length === upserted.length) {
    expanded = rows;
    break;
  }
  if (!expanded.length) expanded = rows;
}

function toBase64(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

const out = [];
for (let i = 0; i < upserted.length; i += 1) {
  const u = upserted[i];
  const ex =
    expanded.find((e) => String(e.stable_source_id || '') === String(u.stable_source_id || '')) ||
    expanded[i] ||
    {};
  const chunkText = String(ex.chunk_text || '')
    .replaceAll(',', ';')
    .replace(/\s+/g, ' ')
    .trim();
  if (!chunkText) continue;
  const meta = {
    collector: ex.collector || null,
    source_type: u.source_type || ex.source_type || null,
    stable_source_id: u.stable_source_id || ex.stable_source_id || null,
  };
  out.push({
    json: {
      evidence_id: u.evidence_id,
      chunk_index: 0,
      chunk_text: chunkText,
      chunk_token_estimate: Math.max(1, Math.ceil(chunkText.length / 4)),
      chunk_metadata_b64: toBase64(meta),
    },
  });
}

if (!out.length) {
  return [
    {
      json: {
        skip_chunk: true,
        evidence_id: null,
        chunk_index: 0,
        chunk_text: '',
        chunk_token_estimate: null,
        chunk_metadata_b64: '',
      },
    },
  ];
}

return out;
