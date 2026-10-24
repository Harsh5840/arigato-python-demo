import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const frozenPaths = ['verification/verify.mjs', 'verification/business.py'];
export const allowedPaths = ['requirements.txt', 'service/client.py'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
export function verifierDigest(folder = root) { return hash(JSON.stringify(frozenPaths.map((path) => [path, hash(readFileSync(resolve(folder, path)))]))); }
function git(folder, args) {
  const result = spawnSync('git', ['-C', folder, ...args], { encoding: 'utf8', shell: false, timeout: 20_000, maxBuffer: 1_000_000 });
  if (result.error || result.status !== 0) throw new Error('Could not establish exact Git candidate identities.');
  return result.stdout.trim();
}
function sha(value) { assert.match(value ?? '', /^[a-f0-9]{40}$/, 'A full commit SHA is required.'); return value; }
export function requirementVersion(content) {
  const match = /^requests==(2\.\d+\.\d+)\r?\n?$/.exec(content);
  assert.ok(match, 'Candidate requirements must contain exactly one stable major-2 Requests pin, without flags, URLs, comments or extra dependencies.');
  return match[1];
}
async function remoteJson(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json', 'user-agent': 'ProofPatch-Frozen-Python-Oracle', ...options.headers } });
  assert.ok(response.ok, `Authoritative dependency source returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.ok(bytes.byteLength < 6_000_000, 'Authoritative response exceeded the source bound.');
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function cleanDependencies(dependencies) {
  assert.ok(dependencies.length > 0 && dependencies.length <= 10, 'Actual dependency inventory is missing or too large.');
  const response = await remoteJson('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: dependencies.map(({ name, version }) => ({ package: { name, ecosystem: 'PyPI' }, version })) }) });
  assert.ok(Array.isArray(response.results) && response.results.length === dependencies.length, 'OSV must return every exact dependency result.');
  return response.results.every((value) => !value.next_page_token && (!value.vulns || Array.isArray(value.vulns) && value.vulns.length === 0));
}
function persist(path, evidence) { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n'); }
function check(evidence, id, label, pass, detail) {
  const value = { id, label, pass, detail };
  const index = evidence.checks.findIndex((entry) => entry.id === id);
  if (index < 0) evidence.checks.push(value); else evidence.checks[index] = value;
  return pass;
}

async function prepare(candidateFolder, baseSha, candidateSha, evidencePath) {
  sha(baseSha); sha(candidateSha);
  assert.match(process.env.PROOFPATCH_RUN_ID ?? '', /^[a-zA-Z0-9_-]{4,100}$/);
  assert.equal(process.env.WORKFLOW_SHA, baseSha, 'Workflow must run from the frozen default-branch baseline.');
  assert.equal(git(root, ['rev-parse', 'HEAD']), baseSha);
  assert.equal(git(candidateFolder, ['rev-parse', 'HEAD']), candidateSha);
  assert.equal(git(candidateFolder, ['rev-parse', 'HEAD^']), baseSha, 'Candidate must directly descend from the frozen baseline.');
  assert.equal(git(candidateFolder, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length, 2, 'Candidate must have exactly one parent.');
  const evidence = { run_id: process.env.PROOFPATCH_RUN_ID, base_sha: baseSha, candidate_sha: candidateSha, verifier_sha256: verifierDigest(), workflow_sha: process.env.WORKFLOW_SHA, github_run_id: process.env.GITHUB_RUN_ID, checks: [] };
  const changed = git(candidateFolder, ['diff', '--name-only', baseSha, candidateSha]).split('\n').filter(Boolean);
  const statuses = git(candidateFolder, ['diff', '--name-status', baseSha, candidateSha]).split('\n').filter(Boolean);
  const scope = changed.length >= 1 && changed.length <= 2 && changed.includes('requirements.txt') && changed.every((path) => allowedPaths.includes(path)) && statuses.every((line) => line.startsWith('M\t'));
  check(evidence, 'scope', 'Only approved manifest and application source changed', scope, changed.join(', ') || 'No changed files.');
  const sameVerifier = verifierDigest(candidateFolder) === evidence.verifier_sha256;
  check(evidence, 'verifier', 'Frozen baseline business verifier is unchanged', sameVerifier, evidence.verifier_sha256);
  persist(evidencePath, evidence);
  assert.ok(scope && sameVerifier, 'Candidate changed a protected path, verifier or unapproved file.');
  const version = requirementVersion(readFileSync(resolve(candidateFolder, 'requirements.txt'), 'utf8'));
  assert.notEqual(version, '2.31.0', 'Affected baseline must never be built or executed.');
  const metadata = await remoteJson(`https://pypi.org/pypi/requests/${version}/json`);
  const published = metadata.info?.version === version && Array.isArray(metadata.urls) && metadata.urls.some((file) => file.yanked === false && file.packagetype === 'bdist_wheel');
  assert.ok(published, 'Candidate must be an unyanked published binary-wheel release.');
  const clean = await cleanDependencies([{ name: 'requests', version }]);
  check(evidence, 'no_known_advisories', 'Candidate exact package has no OSV matches', clean, `requests ${version}; actual transitive runtime packages are checked again after execution.`);
  check(evidence, 'package_version', 'Published candidate version matches actual runtime', false, `Published pin ${version}; runtime not yet executed.`);
  check(evidence, 'business_suite', 'Frozen Japanese business assertions pass', false, 'Candidate runtime has not yet executed.');
  evidence.expected_version = version;
  persist(evidencePath, evidence);
  assert.ok(clean, 'OSV still reports a known advisory for the proposed Requests version.');
  console.log(`Policy-approved candidate requests ${version}; baseline was not executed.`);
}
async function finish(evidencePath, runtimePath) {
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
  const correctVersion = runtime.requests_version === evidence.expected_version && runtime.expected_version === evidence.expected_version && /^3\.12\./.test(runtime.python_version);
  check(evidence, 'package_version', 'Actual Python and Requests versions match the candidate', correctVersion, `Python ${runtime.python_version}; Requests ${runtime.requests_version}; expected ${evidence.expected_version}.`);
  const businessPass = Array.isArray(runtime.checks) && runtime.checks.length === 12 && new Set(runtime.checks).size === 12 && runtime.checks.every((label) => typeof label === 'string');
  check(evidence, 'business_suite', 'All 12 frozen Japanese business assertions passed', businessPass, `${runtime.checks?.length ?? 0} assertions observed; expected exactly 12.`);
  const names = ['certifi', 'charset-normalizer', 'idna', 'requests', 'urllib3'];
  assert.ok(Array.isArray(runtime.dependencies) && runtime.dependencies.length === names.length && JSON.stringify(runtime.dependencies.map((value) => value.name).sort()) === JSON.stringify(names) && runtime.dependencies.every((value) => typeof value.version === 'string' && /^\d+(?:\.\d+){1,3}$/.test(value.version)), 'Observed application dependency inventory is invalid.');
  const clean = await cleanDependencies(runtime.dependencies);
  check(evidence, 'no_known_advisories', 'Actual installed application dependencies have no OSV matches', clean, runtime.dependencies.map(({ name, version }) => `${name}==${version}`).join(', '));
  evidence.runtime = runtime;
  evidence.businessLog = runtime.checks.map((label) => `PASS: ${label}`).join('\n') + '\n12 business checks passed.\n';
  delete evidence.expected_version;
  persist(evidencePath, evidence);
  assert.ok(evidence.checks.every((value) => value.pass), 'Candidate evidence contains failing checks; human review PR must remain blocked.');
  console.log('All five trusted gates and 12 business assertions passed. No exploit, deployment or merge was performed.');
}
function baseline() {
  assert.equal(requirementVersion(readFileSync(resolve(root, 'requirements.txt'), 'utf8')), '2.31.0');
  assert.equal(frozenPaths.length, 2);
  assert.match(verifierDigest(), /^[a-f0-9]{64}$/);
  for (const value of ['requests>=2.34.2\n', 'requests==2.31.0\nmalicious==1.0.0\n', '--index-url https://evil.test\nrequests==2.34.2\n', 'requests==3.0.0\n', 'requests==2.99.0rc1\n']) assert.throws(() => requirementVersion(value));
  assert.equal(requirementVersion('requests==2.34.2\n'), '2.34.2');
  console.log('PASS: affected baseline is requests 2.31.0; candidate parser rejects ranges, URLs, additional packages, prereleases and major changes.');
  console.log(`Frozen verifier: ${verifierDigest()}`);
  console.log('Affected baseline was classified statically; it was not installed, built, imported or executed.');
}
const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === '--baseline') baseline();
  else if (mode === 'prepare' && args.length === 4) await prepare(resolve(args[0]), args[1], args[2], args[3]);
  else if (mode === 'finish' && args.length === 2) await finish(args[0], args[1]);
  else throw new Error('Use --baseline, prepare <candidate> <base> <head> <evidence>, or finish <evidence> <runtime>.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Frozen verification failed.'); process.exitCode = 1; }
