// Canonical source for PII-00 "Build Ack Response" Code node.

const item = $input.first().json;

const payload = {
  case_id: item.case_id,
  request_id: item.request_id,
  ticker: item.ticker,
  state: item.state || 'REQUESTED',
  created: item.created === true || item.created === 'true',
  message: item.created
    ? 'Investigation case created. Processing continues asynchronously.'
    : 'Existing case returned for idempotent request_id.',
  as_of: new Date().toISOString(),
};

return [{ json: payload }];
