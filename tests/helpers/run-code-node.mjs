import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Execute an n8n Code node script locally with mocked $input / $execution.
 */
export function runCodeNode(scriptPath, { items = [], executionId = 'test-exec-1' } = {}) {
  const code = fs.readFileSync(scriptPath, 'utf8');
  const normalized = items.map((item) =>
    item && item.json !== undefined ? item : { json: item },
  );

  const $input = {
    all: () => normalized,
    first: () => normalized[0] ?? { json: {} },
  };
  const $execution = { id: executionId };

  const sandbox = {
    $input,
    $execution,
    console,
    Math,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Date,
    RegExp,
    Error,
  };

  const wrapped = `(function() {\n${code}\n})()`;
  return vm.runInNewContext(wrapped, sandbox, { filename: scriptPath });
}

export const VALIDATE_SCRIPT = path.join(
  repoRoot,
  'workflows/shared/code/validate-investigation-request.js',
);

export const BUILD_ACK_SCRIPT = path.join(
  repoRoot,
  'workflows/shared/code/build-ack-response.js',
);
