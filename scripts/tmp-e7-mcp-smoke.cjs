const fs = require('fs');
const path = require('path');

const MCP_URL = 'https://teacherjoseluis.app.n8n.cloud/mcp-server/http';
const token = JSON.parse(
  fs.readFileSync(path.join(process.env.USERPROFILE, '.cursor', 'mcp.json'), 'utf8'),
).mcpServers['n8n-mcp'].headers.Authorization;

function parseSseJson(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

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
  const parsed = parseSseJson(text);
  return { status: res.status, parsed, text };
}

async function main() {
  const cmd = process.argv[2];
  const file = process.argv[3];

  if (cmd === 'validate-create') {
    const code = fs.readFileSync(file, 'utf8');
    const name = process.argv[4] || undefined;
    const v = await mcpCall('validate_workflow', { code }, 1);
    console.log('validate', JSON.stringify(v.parsed, null, 2).slice(0, 3000));
    const ok =
      v.parsed?.result?.structuredContent?.valid === true ||
      (typeof v.parsed?.result?.content?.[0]?.text === 'string' &&
        v.parsed.result.content[0].text.includes('"valid": true'));
    if (!ok) {
      process.exit(2);
    }
    const c = await mcpCall(
      'create_workflow_from_code',
      {
        code,
        projectId: 'FaU28ckb88bAPAfT',
        name,
        description: 'Temporary E7 smoke/migrate wrapper; archive after use.',
        versionName: 'E7 temp wrapper',
      },
      2,
    );
    console.log('create', JSON.stringify(c.parsed, null, 2).slice(0, 4000));
    return;
  }

  if (cmd === 'execute') {
    const workflowId = process.argv[3];
    const r = await mcpCall(
      'execute_workflow',
      { workflowId, executionMode: 'manual' },
      3,
    );
    console.log('execute', JSON.stringify(r.parsed, null, 2).slice(0, 3000));
    return;
  }

  if (cmd === 'exec-status') {
    const workflowId = process.argv[3];
    const executionId = process.argv[4];
    const includeData = process.argv[5] !== 'false';
    const nodeNames = process.argv.slice(6);
    const args = {
      workflowId,
      executionId,
      includeData,
    };
    if (nodeNames.length) args.nodeNames = nodeNames;
    const r = await mcpCall('get_workflow_execution', args, 4);
    console.log(JSON.stringify(r.parsed, null, 2).slice(0, 12000));
    return;
  }

  if (cmd === 'archive') {
    const workflowId = process.argv[3];
    const r = await mcpCall('archive_workflow', { workflowId }, 5);
    console.log('archive', JSON.stringify(r.parsed, null, 2).slice(0, 2000));
    return;
  }

  console.error(
    'usage: validate-create <file> [name] | execute <id> | exec-status <wf> <exec> [false] [nodes...] | archive <id>',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
