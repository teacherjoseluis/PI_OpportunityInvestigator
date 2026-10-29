const fs = require('fs');
const path = require('path');

const MCP_URL = 'https://teacherjoseluis.app.n8n.cloud/mcp-server/http';
const token = JSON.parse(
  fs.readFileSync(path.join(process.env.USERPROFILE, '.cursor', 'mcp.json'), 'utf8'),
).mcpServers['n8n-mcp'].headers.Authorization;
const code = fs.readFileSync(path.join(__dirname, 'tmp-e8-smoke-pii10.ts'), 'utf8');

async function call(name, args) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const json = JSON.parse((text.split('data: ').pop() || '{}').trim());
  const t =
    json.result && json.result.content && json.result.content[0] && json.result.content[0].text;
  return t || text.slice(0, 4000);
}

(async () => {
  const validated = await call('validate_workflow', { code });
  console.log('validate', validated);
  if (!String(validated).includes('"valid": true')) process.exit(1);
  const created = await call('create_workflow_from_code', {
    code,
    name: 'TMP E8 Smoke PII-10 REGN',
    description: 'Temporary slim PII-10 smoke after combined E8 wrapper OOM. Archive after success.',
    projectId: 'FaU28ckb88bAPAfT',
    versionName: 'E8 PII-10 smoke',
    versionDescription: 'Run published PII-10 on REGN case then query business_quality_score.',
  });
  console.log('create', created);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
