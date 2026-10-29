const fs = require('fs');
const path = require('path');

const MCP_URL = 'https://teacherjoseluis.app.n8n.cloud/mcp-server/http';
const token = JSON.parse(
  fs.readFileSync(path.join(process.env.USERPROFILE, '.cursor', 'mcp.json'), 'utf8'),
).mcpServers['n8n-mcp'].headers.Authorization;
const code = fs.readFileSync(path.join(__dirname, 'tmp-e8-smoke.ts'), 'utf8');

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
  if (!String(validated).includes('"valid": true')) {
    process.exit(1);
  }
  const created = await call('create_workflow_from_code', {
    code,
    name: 'TMP E8 Smoke REGN Collect Analysts',
    description:
      'Temporary E8 smoke: REGN PII-03 collect then PII-04/06/09/10. Archive after success.',
    projectId: 'FaU28ckb88bAPAfT',
    versionName: 'E8 REGN smoke',
    versionDescription:
      'Reset REGN case to COLLECTING, run PII-03 plus E8 analysts, query courtlistener metrics claims.',
  });
  console.log('create', created);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
