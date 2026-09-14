// Attach score_id from Upsert Scores onto Evaluate Scoring Quality payload for component expand.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Scoring Quality') || {};
const upserted = $input.first().json || {};

return [
  {
    json: {
      ...evaluated,
      score_id: upserted.score_id || evaluated.score_id || null,
    },
  },
];
