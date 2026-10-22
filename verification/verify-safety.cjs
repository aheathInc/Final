'use strict';
/**
 * Review tool. --check performs only local file/dependency checks.
 * --run adds read-only DB verification, type-checks and DB-mutating test suites.
 * NEVER installs, migrates, starts/stops a DB, resets data, stages or commits.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const lfHash = value => crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n')).digest('hex');
function parseOptions(args) {
  let root, run = false, modeSeen = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && !root && args[i + 1] && !args[i + 1].startsWith('--')) root = args[++i];
    else if ((args[i] === '--run' || args[i] === '--check') && !modeSeen) { run = args[i] === '--run'; modeSeen = true; }
    else throw new Error('Usage: node verify-safety.cjs --root <review-checkout> [--check|--run]');
  }
  if (!root) throw new Error('A source checkout path is required.');
  return { root: path.resolve(root), run };
}
function redact(text, env = process.env) {
  let result = String(text ?? '');
  const secretKeys = /(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|API_KEY)/i;
  const values = Object.entries(env).filter(([key, value]) => secretKeys.test(key) && value && value.length >= 6).map(([, value]) => value);
  try { const u = new URL(env.DATABASE_URL); if (u.password) values.push(decodeURIComponent(u.password)); } catch { /* no URL */ }
  for (const value of values.sort((a, b) => b.length - a.length)) {
    if (value.length >= 6) result = result.split(value).join('[REDACTED]');
  }
  return result
    .replace(/\bpostgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[DATABASE_URL_REDACTED]')
    .replace(/\bBearer\s+[^\s'"<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT_REDACTED]');
}
function tapCounts(text) {
  const out = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...String(text).matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, 'gm'))];
    if (!matches.length) return null;
    out[key] = Number(matches[matches.length - 1][1]);
  }
  return out;
}
function testPassed(status, output) {
  const counts = tapCounts(output);
  return status === 0 && !!counts && counts.tests > 0 && counts.pass === counts.tests &&
    counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0;
}
function contained(root, filename) {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(filename));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function preflight(root, requirements) {
  const problems = [], tools = {};
  for (const [relative, expected] of Object.entries(requirements.source_lf_sha256)) {
    const filename = path.join(root, relative);
    try {
      if (!contained(root, filename) || lfHash(fs.readFileSync(filename, 'utf8')) !== expected) problems.push(`SOURCE_MISMATCH: ${relative}`);
    } catch { problems.push(`SOURCE_MISSING: ${relative}`); }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.packageManager !== requirements.package_manager) problems.push('PACKAGE_MANAGER_MISMATCH');
    const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
    if (lfHash(lock) !== requirements.lockfile_lf_sha256) problems.push('LOCKFILE_MISMATCH');
  } catch { problems.push('WORKSPACE_MANIFEST_MISSING'); }
  // Only resolve from the supplied workspace, never global Node/TypeScript.
  for (const [name, spec] of Object.entries(requirements.tools)) {
    try {
      const req = createRequire(path.join(root, spec.context));
      const pkgPath = req.resolve(`${name}/package.json`);
      if (!contained(path.join(root, 'node_modules'), pkgPath)) throw new Error('outside workspace');
      if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version !== spec.version) throw new Error('wrong version');
      tools[name] = spec.entry ? req.resolve(spec.entry) : pkgPath;
    } catch { problems.push(`LOCAL_PINNED_DEPENDENCY_UNAVAILABLE: ${name}`); }
  }
  if (Number(process.versions.node.split('.')[0]) < 22) problems.push('NODE_22_OR_NEWER_REQUIRED_FOR_THIS_RUNNER');
  return { problems, tools };
}

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const requirements = JSON.parse(fs.readFileSync(path.join(__dirname, 'requirements.json'), 'utf8'));
  const check = preflight(options.root, requirements);
  const report = {
    kind: 'AHP Candidate 006 scoped safety and care-continuity integration verification', mode: options.run ? 'RUN_REQUESTED' : 'STATIC_CHECK_ONLY',
    generated_at: new Date().toISOString(), node: process.versions.node,
    preflight: check.problems.length ? 'BLOCKED' : 'PASS', blockers: check.problems,
    database: 'NOT_RUN', tasks: [], ledger: 'NOT_RUN',
    status: check.problems.length ? 'BLOCKED' : 'STATIC_PREFLIGHT_PASS_DB_TESTS_NOT_RUN',
  };
  // A local report, not a tracked source edit; repository .gitignore ignores .local/.
  const localRoot = path.join(options.root, '.local');
  if (!contained(options.root, path.join(options.root, 'Web')) ||
      (fs.existsSync(localRoot) && !contained(options.root, localRoot))) {
    throw new Error('Evidence parent must be inside the review checkout.');
  }
  fs.mkdirSync(localRoot, { recursive: true, mode: 0o700 });
  if (!contained(options.root, localRoot)) throw new Error('Local evidence path points outside review checkout.');
  const out = path.join(localRoot, `safety-verification-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(out, { mode: 0o700 });
  const save = (code) => {
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    console.log(`Local evidence: ${out}`);
    return code;
  };
  if (check.problems.length) return save(2);
  if (!options.run) return save(0);
  if (process.env.NODE_ENV !== 'test' || process.env.SMS_PROVIDER !== 'console' ||
      process.env.AHP_SAFETY_TEST_DB_ACK !== 'ISOLATED_DISPOSABLE_AHEALTH_TEST' ||
      !process.env.DATABASE_URL || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    report.status = 'BLOCKED';
    report.blockers.push('EXPLICIT_TEST_ENV_CONSOLE_PROVIDER_DATABASE_ACK_DATABASE_URL_AND_TEST_JWT_SECRET_REQUIRED');
    return save(2);
  }
  const childEnv = { ...process.env, AHP_SOURCE_ROOT: options.root, NODE_PATH: '', NODE_OPTIONS: '', TZ: 'UTC' };
  const loader = pathToFileURL(check.tools.tsx).href;
  function execute(name, args, cwd, timeout, isTest = false) {
    const result = spawnSync(process.execPath, args, { cwd, env: childEnv, encoding: 'utf8', timeout,
      maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const stdout = redact(result.stdout, childEnv), stderr = redact(result.stderr, childEnv);
    fs.writeFileSync(path.join(out, `${name}.stdout.txt`), stdout, { mode: 0o600 });
    fs.writeFileSync(path.join(out, `${name}.stderr.txt`), stderr, { mode: 0o600 });
    const passed = !result.error && (isTest ? testPassed(result.status, result.stdout) : result.status === 0);
    report.tasks.push({ name, result: passed ? 'PASS' : 'FAIL', exit_code: result.status,
      signal: result.signal ?? null, timeout: result.error?.code === 'ETIMEDOUT',
      ...(isTest ? { counts: tapCounts(result.stdout) } : {}) });
    return passed;
  }
  const web = path.join(options.root, 'Web');
  if (!execute('database-preflight', ['--import', loader, path.join(__dirname, 'probe-database.mjs'), '--prepare-check'], web, 30_000)) {
    report.database = 'BLOCKED'; report.status = 'BLOCKED';
    report.blockers.push('DATABASE_READ_ONLY_PREFLIGHT_FAILED_NO_TEST_SUITE_STARTED'); return save(2);
  }
  report.database = 'VERIFIED_DISPOSABLE_TARGET';
  for (const service of ['consultation', 'followup', 'notification']) {
    if (!execute(`typecheck-${service}`, [check.tools.typescript, '--noEmit', '-p', 'tsconfig.json'], path.join(web, 'services', service), 120_000)) {
      report.status = 'FAILED'; return save(1);
    }
  }
  const testFiles = [
    ['consultation', 'engine.test.ts'],
    ['consultation', 'offer-lifecycle.test.ts'],
    ['consultation', 'prescriptions.test.ts'],
    ['followup', 'followup.test.ts'],
    ['notification', 'dispatch.test.ts'],
    // Last: this suite deliberately retains synthetic records and audit evidence.
    ['consultation', 'thread-integrity.test.ts'],
  ];
  for (const [service, filename] of testFiles) {
    // A new process per suite, sequentially; do not run global scheduler tests concurrently.
    if (!execute(`${service}-${filename}`, ['--import', loader, '--test', '--test-reporter=tap', '--test-concurrency=1', `src/tests/${filename}`],
      path.join(web, 'services', service), 180_000, true)) {
      report.status = 'FAILED'; return save(1);
    }
  }
  if (!execute('ledger-verification', ['--import', loader, path.join(__dirname, 'probe-database.mjs'), '--ledger'], web, 30_000)) {
    report.ledger = 'FAIL'; report.status = 'FAILED'; return save(1);
  }
  report.ledger = 'VALID'; report.status = 'SCOPED_DB_INTEGRATION_PASS_NOT_HTTP_E2E_OR_RELEASE_APPROVAL';
  return save(0);
}

module.exports = { lfHash, parseOptions, redact, tapCounts, testPassed, preflight, main };
if (require.main === module) {
  try { process.exitCode = main(); }
  catch { console.error('Safety runner stopped before completion. Check paths/configuration privately; no success is claimed.'); process.exitCode = 2; }
}
