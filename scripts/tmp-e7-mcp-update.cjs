const fs = require('fs');
const path = require('path');

const MCP_URL = 'https://teacherjoseluis.app.n8n.cloud/mcp-server/http';
const token = JSON.parse(
  fs.readFileSync(path.join(process.env.USERPROFILE, '.cursor', 'mcp.json'), 'utf8'),
).mcpServers['n8n-mcp'].headers.Authorization;

async function mcpCall(name, args, id = 1) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const which = process.argv[2];
  if (!which) {
    console.error('usage: node tmp-e7-mcp-update.cjs <pii-03|pii-04|pii-08|pii-09|publish|all>');
    process.exit(1);
  }

  if (which === 'publish') {
    const ids = [
      'IqoALspzvN3PL5Cq',
      'RvIlyuDV0MEsXezL',
      '1PuOVYf0O3GThRwq',
      'mioSWLKBMLAaBGzs',
    ];
    for (let i = 0; i < ids.length; i += 1) {
      const r = await mcpCall('publish_workflow', { workflowId: ids[i] }, i + 1);
      console.log('publish', ids[i], r.status);
      console.log(r.text.slice(0, 2000));
    }
    return;
  }

  const names =
    which === 'all' ? ['pii-04', 'pii-08', 'pii-09', 'pii-03'] : [which];

  for (let i = 0; i < names.length; i += 1) {
    const payload = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'tmp-e7-ops', `${names[i]}.json`), 'utf8'),
    );
    console.log('updating', names[i], 'ops', payload.operations.length);
    const r = await mcpCall('update_workflow', payload, i + 10);
    console.log('status', r.status);
    console.log(r.text.slice(0, 4000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
