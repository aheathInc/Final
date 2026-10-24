'use strict';
// Explicit files avoid shell-dependent glob expansion on Windows.
const {spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
const files=fs.readdirSync(__dirname).filter(x=>x.endsWith('.test.cjs')).sort().map(x=>path.join(__dirname,x));
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',env:process.env});
if(result.error){console.error('Research source tests could not start:',result.error.code);process.exitCode=1;}else process.exitCode=result.status??1;
