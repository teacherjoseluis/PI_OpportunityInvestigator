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

function extractText(sse) {
  const lines = sse.split('\n').filter((l) => l.startsWith('data: '));
  const parts = [];
  for (const line of lines) {
    try {
      const payload = JSON.parse(line.slice(6));
      if (payload.result && payload.result.content) {
        for (const c of payload.result.content) {
          if (c.type === 'text') parts.push(c.text);
        }
      } else if (payload.error) {
        parts.push(JSON.stringify(payload.error));
      }
    } catch {
      parts.push(line.slice(6));
    }
  }
  return parts.join('\n') || sse.slice(0, 4000);
}

async function main() {
  const which = process.argv[2];
  if (!which) {
    console.error('usage: node tmp-e8-mcp-update.cjs <pii-03|pii-04|pii-06|pii-09|pii-10|publish|all>');
    process.exit(1);
  }

  if (which === 'publish') {
    const ids = [
      'IqoALspzvN3PL5Cq',
      'RvIlyuDV0MEsXezL',
      'b8CxYW8T8FrGl62x',
      'mioSWLKBMLAaBGzs',
      'lIjKOZS7qDizvynm',
    ];
    for (let i = 0; i < ids.length; i += 1) {
      const r = await mcpCall('publish_workflow', { workflowId: ids[i] }, i + 1);
      console.log('publish', ids[i], r.status);
      console.log(extractText(r.text).slice(0, 2500));
    }
    return;
  }

  const names =
    which === 'all' ? ['pii-04', 'pii-06', 'pii-09', 'pii-10', 'pii-03'] : [which];

  for (let i = 0; i < names.length; i += 1) {
    const payload = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'tmp-e8-ops', `${names[i]}.json`), 'utf8'),
    );
    console.log('updating', names[i], 'ops', payload.operations.length);
    const r = await mcpCall('update_workflow', payload, i + 10);
    console.log('status', r.status);
    console.log(extractText(r.text).slice(0, 5000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
