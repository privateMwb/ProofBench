// Keeps .github/rulesets/ honest: every required status check must be the
// name of a job in .github/workflows/, otherwise the check never reports and
// pull requests can never be merged.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const rulesetDir = '.github/rulesets';
const workflowDir = '.github/workflows';

// Collect every job `name:` (a key indented four spaces under `jobs:`' child).
const jobNames = new Set();
for (const file of readdirSync(workflowDir).filter((f) => f.endsWith('.yml'))) {
  for (const line of readFileSync(`${workflowDir}/${file}`, 'utf8').split('\n')) {
    const m = /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (m) jobNames.add(m[1].replace(/^["']|["']$/g, ''));
  }
}
assert.ok(jobNames.size > 0, 'found no job names in .github/workflows/');

let checked = 0;
for (const file of readdirSync(rulesetDir).filter((f) => f.endsWith('.json'))) {
  const ruleset = JSON.parse(readFileSync(`${rulesetDir}/${file}`, 'utf8'));
  assert.equal(ruleset.source, 'privateMwb/ProofBench', `${file}: source repository`);
  assert.equal(ruleset.enforcement, 'active', `${file}: enforcement`);

  for (const rule of ruleset.rules) {
    if (rule.type !== 'required_status_checks') continue;
    for (const { context } of rule.parameters.required_status_checks) {
      assert.ok(
        jobNames.has(context),
        `${file}: required check "${context}" is not a job name in ${workflowDir}/ (have: ${[...jobNames].join(', ')})`,
      );
      checked++;
    }
  }
}
assert.ok(checked > 0, 'main-protection.json should require at least one status check');
console.log(`rulesets test passed (${checked} required checks match workflow job names)`);
