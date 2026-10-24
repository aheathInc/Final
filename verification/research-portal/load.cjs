'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');const repoRequire=createRequire(path.join(root,'package.json'));let ts;try{ts=repoRequire('typescript');}catch{ts=require('typescript');}
const cache=new Map();
function load(relative,overrides={}){
 const file=path.resolve(root,relative);if(cache.has(file)&&!Object.keys(overrides).length)return cache.get(file);
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}});
 if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('TypeScript syntax error: '+relative);
 const m={exports:{}};const req=n=>{if(Object.hasOwn(overrides,n))return overrides[n];if(n.startsWith('node:'))return require(n);if(n.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),n.replace(/\.js$/,'.ts'))),overrides);throw Error('Unprovided external dependency: '+n);};
 new vm.Script(`(function(require,module,exports){${compiled.outputText}\n})`,{filename:file}).runInThisContext()(req,m,m.exports);if(!Object.keys(overrides).length)cache.set(file,m.exports);return m.exports;
}
module.exports={load,root};
