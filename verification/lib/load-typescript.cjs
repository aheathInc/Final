'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
if (!process.env.AHP_SOURCE_ROOT) throw new Error('Set AHP_SOURCE_ROOT to the candidate root containing .');
const root = fs.realpathSync(process.env.AHP_SOURCE_ROOT);
const projectRequire = createRequire(path.join(root, 'package.json'));
let ts;
try { ts = projectRequire('typescript'); } catch { ts = require('typescript'); }
function load(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true, fileName: filename,
  });
  if ((diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error)) throw new Error('TypeScript syntax error: ' + relativePath);
  const module = { exports: {} };
  const factory = new vm.Script(`(function(require,module,exports){${outputText}\n})`, { filename }).runInThisContext();
  factory((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error('Unprovided dependency ' + name + ' in ' + relativePath);
  }, module, module.exports);
  return module.exports;
}
module.exports = { load, root };
