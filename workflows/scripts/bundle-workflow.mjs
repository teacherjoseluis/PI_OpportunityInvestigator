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
  VALIDATE_IDENTITY_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-identity-request.js',
  ),
  PREPARE_CACHED_IDENTITY: path.join(repoRoot, 'workflows/shared/code/prepare-cached-identity.js'),
  RESOLVE_EDGAR_IDENTITY: path.join(repoRoot, 'workflows/shared/code/resolve-edgar-identity.js'),
  BUILD_IDENTITY_RESULT: path.join(repoRoot, 'workflows/shared/code/build-identity-result.js'),
  VALIDATE_ELIGIBILITY_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-eligibility-request.js',
  ),
  EVALUATE_ELIGIBILITY: path.join(repoRoot, 'workflows/shared/code/evaluate-eligibility.js'),
  BUILD_ELIGIBILITY_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-eligibility-result.js',
  ),
  VALIDATE_COLLECTION_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-collection-request.js',
  ),
  NORMALIZE_SEC_EVIDENCE: path.join(repoRoot, 'workflows/shared/code/normalize-sec-evidence.js'),
  NORMALIZE_CTGOV_EVIDENCE: path.join(
    repoRoot,
    'workflows/shared/code/normalize-ctgov-evidence.js',
  ),
  EXPAND_EVIDENCE_DOCUMENTS: path.join(
    repoRoot,
    'workflows/shared/code/expand-evidence-documents.js',
  ),
  COUNT_SEC_UPSERTS: path.join(repoRoot, 'workflows/shared/code/count-sec-upserts.js'),
  COUNT_CTGOV_UPSERTS: path.join(repoRoot, 'workflows/shared/code/count-ctgov-upserts.js'),
  PREPARE_CTGOV_ZERO_COUNT: path.join(
    repoRoot,
    'workflows/shared/code/prepare-ctgov-zero-count.js',
  ),
  EVALUATE_COLLECTION_COVERAGE: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-collection-coverage.js',
  ),
  BUILD_COLLECTION_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-collection-result.js',
  ),
  VALIDATE_FINANCIAL_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-financial-request.js',
  ),
  EVALUATE_FINANCIAL_BUSINESS: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-financial-business.js',
  ),
  EXPAND_FINANCIAL_CLAIMS: path.join(
    repoRoot,
    'workflows/shared/code/expand-financial-claims.js',
  ),
  EXPAND_CLAIM_EVIDENCE_LINKS: path.join(
    repoRoot,
    'workflows/shared/code/expand-claim-evidence-links.js',
  ),
  PREPARE_FINANCIAL_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-financial-aggregate.js',
  ),
  BUILD_FINANCIAL_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-financial-result.js',
  ),
  VALIDATE_GROWTH_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-growth-request.js',
  ),
  EVALUATE_GROWTH_PROSPECTS: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-growth-prospects.js',
  ),
  EXPAND_GROWTH_CLAIMS: path.join(repoRoot, 'workflows/shared/code/expand-growth-claims.js'),
  EXPAND_GROWTH_CLAIM_LINKS: path.join(
    repoRoot,
    'workflows/shared/code/expand-growth-claim-links.js',
  ),
  PREPARE_GROWTH_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-growth-aggregate.js',
  ),
  BUILD_GROWTH_RESULT: path.join(repoRoot, 'workflows/shared/code/build-growth-result.js'),
  VALIDATE_PIPELINE_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-pipeline-request.js',
  ),
  EVALUATE_PIPELINE_CLINICAL: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-pipeline-clinical.js',
  ),
  EXPAND_PIPELINE_CLAIMS: path.join(
    repoRoot,
    'workflows/shared/code/expand-pipeline-claims.js',
  ),
  EXPAND_PIPELINE_CLAIM_LINKS: path.join(
    repoRoot,
    'workflows/shared/code/expand-pipeline-claim-links.js',
  ),
  PREPARE_PIPELINE_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-pipeline-aggregate.js',
  ),
  BUILD_PIPELINE_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-pipeline-result.js',
  ),
  VALIDATE_REGULATORY_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-regulatory-request.js',
  ),
  EVALUATE_REGULATORY_CATALYST: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-regulatory-catalyst.js',
  ),
  EXPAND_REGULATORY_CLAIMS: path.join(
    repoRoot,
    'workflows/shared/code/expand-regulatory-claims.js',
  ),
  EXPAND_REGULATORY_CLAIM_LINKS: path.join(
    repoRoot,
    'workflows/shared/code/expand-regulatory-claim-links.js',
  ),
  PREPARE_REGULATORY_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-regulatory-aggregate.js',
  ),
  BUILD_REGULATORY_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-regulatory-result.js',
  ),
  VALIDATE_VALUATION_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-valuation-request.js',
  ),
  EVALUATE_VALUATION_MARKET: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-valuation-market.js',
  ),
  EXPAND_VALUATION_CLAIMS: path.join(
    repoRoot,
    'workflows/shared/code/expand-valuation-claims.js',
  ),
  EXPAND_VALUATION_CLAIM_LINKS: path.join(
    repoRoot,
    'workflows/shared/code/expand-valuation-claim-links.js',
  ),
  PREPARE_VALUATION_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-valuation-aggregate.js',
  ),
  BUILD_VALUATION_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-valuation-result.js',
  ),
  VALIDATE_RISK_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-risk-request.js',
  ),
  EVALUATE_RISK_REDTEAM: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-risk-redteam.js',
  ),
  EXPAND_RISK_CLAIMS: path.join(repoRoot, 'workflows/shared/code/expand-risk-claims.js'),
  EXPAND_RISK_CLAIM_LINKS: path.join(
    repoRoot,
    'workflows/shared/code/expand-risk-claim-links.js',
  ),
  PREPARE_RISK_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-risk-aggregate.js',
  ),
  BUILD_RISK_RESULT: path.join(repoRoot, 'workflows/shared/code/build-risk-result.js'),
  VALIDATE_SCORING_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-scoring-request.js',
  ),
  EVALUATE_SCORING_QUALITY: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-scoring-quality.js',
  ),
  ATTACH_SCORE_ID: path.join(repoRoot, 'workflows/shared/code/attach-score-id.js'),
  EXPAND_SCORE_COMPONENTS: path.join(
    repoRoot,
    'workflows/shared/code/expand-score-components.js',
  ),
  PREPARE_SCORING_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-scoring-aggregate.js',
  ),
  BUILD_SCORING_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-scoring-result.js',
  ),
  VALIDATE_REPORT_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-report-request.js',
  ),
  BUILD_RESEARCH_REPORT: path.join(
    repoRoot,
    'workflows/shared/code/build-research-report.js',
  ),
  RESTORE_REPORT_PAYLOAD: path.join(
    repoRoot,
    'workflows/shared/code/restore-report-payload.js',
  ),
  RESTORE_AFTER_CLEAR_RULES: path.join(
    repoRoot,
    'workflows/shared/code/restore-after-clear-rules.js',
  ),
  PREPARE_REPORT_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-report-aggregate.js',
  ),
  BUILD_REPORT_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-report-result.js',
  ),
  VALIDATE_MONITORING_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-monitoring-request.js',
  ),
  EVALUATE_MONITORING_SIGNALS: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-monitoring-signals.js',
  ),
  PREPARE_MONITORING_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-monitoring-aggregate.js',
  ),
  BUILD_MONITORING_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-monitoring-result.js',
  ),
  VALIDATE_OPS_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-ops-request.js',
  ),
  EVALUATE_OPS_ALERTS: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-ops-alerts.js',
  ),
  PREPARE_OPS_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-ops-aggregate.js',
  ),
  BUILD_OPS_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-ops-result.js',
  ),
  VALIDATE_EMAIL_REQUEST: path.join(
    repoRoot,
    'workflows/shared/code/validate-email-request.js',
  ),
  EVALUATE_EMAIL_DELIVERY: path.join(
    repoRoot,
    'workflows/shared/code/evaluate-email-delivery.js',
  ),
  PREPARE_EMAIL_AGGREGATE: path.join(
    repoRoot,
    'workflows/shared/code/prepare-email-aggregate.js',
  ),
  BUILD_EMAIL_RESULT: path.join(
    repoRoot,
    'workflows/shared/code/build-email-result.js',
  ),
};

let content = fs.readFileSync(templatePath, 'utf8');

for (const [token, filePath] of Object.entries(embedMap)) {
  if (!content.includes(`__${token}__`)) continue;
  if (!fs.existsSync(filePath)) {
    console.error(`Missing embed source: ${filePath}`);
    process.exit(1);
  }
  const code = fs.readFileSync(filePath, 'utf8');
  // Escape for embedding inside a TypeScript template literal.
  const escaped = code
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  content = content.replace(`__${token}__`, escaped);
}

const remaining = content.match(/__[A-Z0-9_]+__/g);
if (remaining) {
  console.error(`Unresolved placeholders: ${remaining.join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(outputPath, content, 'utf8');
console.log(`Wrote ${outputPath}`);
