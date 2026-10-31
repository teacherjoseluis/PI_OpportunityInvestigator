import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Execute an n8n Code node script locally with mocked $input / $execution / $.
 */
export function runCodeNode(
  scriptPath,
  { items = [], executionId = 'test-exec-1', nodes = {}, prepend = [] } = {},
) {
  const parts = (prepend || []).map((file) => fs.readFileSync(file, 'utf8'));
  parts.push(fs.readFileSync(scriptPath, 'utf8'));
  const code = parts.join('\n');
  const normalized = items.map((item) =>
    item && item.json !== undefined ? item : { json: item },
  );

  const $input = {
    all: () => normalized,
    first: () => normalized[0] ?? { json: {} },
  };
  const $execution = { id: executionId };
  const $ = (name) => {
    const nodeItems = nodes[name];
    if (!nodeItems) {
      throw new Error('Node not found: ' + name);
    }
    const list = nodeItems.map((item) =>
      item && item.json !== undefined ? item : { json: item },
    );
    return {
      first: () => list[0] ?? { json: {} },
      all: () => list,
    };
  };

  const sandbox = {
    $input,
    $execution,
    $,
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
    Buffer,
    require: (name) => {
      if (name === 'crypto') return crypto;
      if (name === 'zlib') return zlib;
      throw new Error('Cannot require: ' + name);
    },
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

export const PARSE_SLACK_SCRIPT = path.join(
  repoRoot,
  'workflows/shared/code/parse-slack-slash-command.js',
);

export const BUILD_SLACK_FOLLOWUP_SCRIPT = path.join(
  repoRoot,
  'workflows/shared/code/build-slack-followup.js',
);
