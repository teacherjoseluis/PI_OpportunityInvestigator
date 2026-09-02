#!/usr/bin/env node
/**
 * Embeds shared Code node sources into workflow.template.ts -> workflow.ts
 * Usage: node workflows/scripts/bundle-workflow.mjs pii-00-orchestrator
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const workflowKey = process.argv[2];

if (!workflowKey) {
  console.error('Usage: node workflows/scripts/bundle-workflow.mjs <workflow-dir-name>');
  process.exit(1);
}

const workflowDir = path.join(repoRoot, 'workflows', workflowKey);
const templatePath = path.join(workflowDir, 'workflow.template.ts');
const outputPath = path.join(workflowDir, 'workflow.ts');

if (!fs.existsSync(templatePath)) {
  console.error(`Missing template: ${templatePath}`);
  process.exit(1);
}

const embedMap = {
  VALIDATE_INVESTIGATION_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-investigation-request.js',
  ),
  BUILD_ACK_RESPONSE: path.join(repoRoot, 'workflows/shared/code/build-ack-response.js'),
};

let content = fs.readFileSync(templatePath, 'utf8');

for (const [token, filePath] of Object.entries(embedMap)) {
  if (!content.includes(`__${token}__`)) continue;
  if (!fs.existsSync(filePath)) {
    console.error(`Missing embed source: ${filePath}`);
    process.exit(1);
  }
  const code = fs.readFileSync(filePath, 'utf8');
  const escaped = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  content = content.replace(`__${token}__`, escaped);
}

const remaining = content.match(/__[A-Z0-9_]+__/g);
if (remaining) {
  console.error(`Unresolved placeholders: ${remaining.join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(outputPath, content, 'utf8');
console.log(`Wrote ${outputPath}`);
