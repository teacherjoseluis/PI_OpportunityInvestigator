/**
 * Helper: print a single workflow update payload to stdout as JSON.
 * Usage: node scripts/tmp-e7-apply-via-stdin.cjs pii-04
 */
const fs = require('fs');
const path = require('path');
const name = process.argv[2];
if (!name) {
  console.error('usage: node tmp-e7-apply-via-stdin.cjs <pii-03|pii-04|pii-08|pii-09>');
  process.exit(1);
}
const file = path.join(__dirname, 'tmp-e7-ops', `${name}.json`);
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
process.stdout.write(JSON.stringify(payload));
