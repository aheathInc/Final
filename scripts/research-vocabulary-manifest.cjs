'use strict';
/** Hash a licensed Athena TSV directory without reading it into memory or modifying its contents. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vocabularyNames = ['concept','vocabulary','domain','concept_class','concept_relationship','relationship','concept_synonym','concept_ancestor','source_to_concept_map','drug_strength'];
async function run(args) {
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const directory = option('--directory'), version = option('--version');
  if (!directory || !version || !/^[A-Za-z0-9._-]{1,20}$/.test(version)) throw Error('Use --directory PATH --version SHORT_VERSION [--synthetic]. Version: 1–20 letters, digits, dot, underscore or hyphen.');
  if (args.some((x,i) => x.startsWith('--') && !['--directory','--version','--synthetic'].includes(x))) throw Error('Unknown argument.');
  const root = path.resolve(directory), stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('A regular local directory is required.');
  const destination = path.join(root, 'manifest.json');
  if (fs.existsSync(destination)) throw Error('manifest.json already exists; no overwrite was performed.');
  const files = {};
  for (const table of vocabularyNames) {
    const name = table.toUpperCase() + '.csv', file = path.join(root, name), st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) throw Error('Required vocabulary file is missing or not a regular file: ' + name);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    files[name] = hash.digest('hex');
  }
  fs.writeFileSync(destination, JSON.stringify({ version, synthetic: args.includes('--synthetic'), files }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Manifest created for 10 vocabulary files. No vocabulary rows or credentials were printed.');
}
if (require.main === module) run(process.argv.slice(2)).catch(() => { console.error('Vocabulary manifest was not completed. Check required files, arguments and existing manifest. No files were overwritten.'); process.exitCode = 1; });
module.exports = { run };
