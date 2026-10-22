'use strict';
// Source/syntax checks only: not a Next.js build, type-check, accessibility
// certification or backend integration test. No network or database writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const app = path.join(root, 'apps/staff-web');
let ts;
try { ts = require(require.resolve('typescript', { paths: [app, root] })); }
catch { if (!process.env.AHP_TYPESCRIPT_PATH) throw new Error('Install the locked Staff Web TypeScript dependency before this check.'); ts = require(process.env.AHP_TYPESCRIPT_PATH); }
const results = [];
function check(name, work) { try { work(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', message: error.message }); } }
const read = relative => fs.readFileSync(path.join(app, relative), 'utf8');
const exported = { exports: {} };
const js = ts.transpileModule(read('lib/premium/navigation.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(js, { exports: exported.exports, module: exported });
const { navigationFor, activeHref, heroFor } = exported.exports;
check('Unknown/unauthenticated role adds no navigation privileges', () => {
  assert.equal(navigationFor(undefined).length, 0); assert.equal(navigationFor('unrecognized').length, 0);
});
check('Clinician navigation keeps clinical destinations only', () => {
  const links = navigationFor('clinician').flatMap(g => g.items); assert(links.length > 10); assert(links.every(l => l.href.startsWith('/doctor/')));
  assert(links.some(l => l.href === '/doctor/follow-up')); assert(links.some(l => l.href === '/doctor/front-desk'));
});
check('Pharmacist navigation stays within the pharmacist workspace', () => {
  const links = navigationFor('pharmacist').flatMap(g => g.items); assert.equal(links.length, 1); assert.equal(links[0].href, '/pharmacy');
});
check('Admin/facility/research/dispatch role presentation remains separate', () => {
  assert(navigationFor('platform_admin').flatMap(g => g.items).every(l => !l.href.startsWith('/doctor/')));
  assert(navigationFor('researcher').flatMap(g => g.items).every(l => l.href.startsWith('/analytics/')));
  assert(navigationFor('facility_admin').flatMap(g => g.items).every(l => ['/admin/facilities','/admin/incidents','/admin/settings'].includes(l.href)));
  assert(navigationFor('dispatcher').flatMap(g => g.items).every(l => ['/admin/devices','/admin/emergency'].includes(l.href)));
});
check('Every exposed navigation destination has an existing app page', () => {
  for (const role of ['clinician','platform_admin','pharmacist','researcher','facility_admin','dispatcher']) {
    for (const link of navigationFor(role).flatMap(g => g.items)) assert(fs.existsSync(path.join(app, 'app', link.href, 'page.tsx')), link.href);
  }
});
check('Active route uses path boundaries, not substring matching', () => {
  assert(activeHref('/doctor/follow-up/medication-times','/doctor/follow-up'));
  assert(!activeHref('/doctor/follow-up-other','/doctor/follow-up'));
});
check('Decorative assets are local source assets, not external patient images', () => {
  for (const p of ['/doctor/queue','/doctor/follow-up','/doctor/referrals','/doctor/diagnostics','/doctor/patients/sample','/admin/dashboard','/pharmacy','/admin/interoperability']) {
    const kind = heroFor(p).kind; assert(fs.existsSync(path.join(app, 'public/design/clinical', kind + (kind === 'followup' ? '.webp' : '.svg'))));
  }
  assert(!read('lib/premium/artwork.ts').includes('https://'));
});
check('Shared motion and transparency fallbacks are present', () => {
  const css = read('app/premium-clinical.css'); assert(css.includes('prefers-reduced-motion:reduce')); assert(css.includes('prefers-reduced-transparency:reduce')); assert(css.includes('@supports not (backdrop-filter:blur(1px))'));
});
check('Design preserves original ink/paper/petrol/amber/clay values', () => {
  const css = read('app/premium-clinical.css').toLowerCase(); const tokens = read('tailwind.config.ts').toLowerCase();
  for (const value of ['#10241f','#f4f6f2','#0f4c43','#c2700b','#a63d2f']) { assert(tokens.includes(value)); assert(css.includes(value)); }
});
check('Opaque clinical content and non-color statuses remain explicit', () => {
  assert(read('components/premium/HealthTimeline.tsx').includes('verification_state'));
  assert(read('components/premium/DiagnosticsTable.tsx').includes('o.status'));
  assert(read('components/PharmacistWorkspace.tsx').includes('does not reserve stock'));
});
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === '.next' ? [] : e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
const sources = files(app).filter(p => /\.tsx?$/.test(p) && !/\.d\.ts$/.test(p));
check('Staff Web TypeScript/TSX syntax parsing', () => {
  for (const file of sources) {
    const source = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(source.parseDiagnostics.length, 0, path.relative(root,file));
  }
});
console.log(JSON.stringify({ scope: 'source and syntax only; full build/type-check NOT performed', typescript: ts.version, tsTsxFiles: sources.length, checks: results }, null, 2));
process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
