import {createRequire} from 'node:module';
import {access,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {run} from '../engine/process.mjs';
const require=createRequire(import.meta.url),result={at:new Date().toISOString(),status:'blocked',blockers:[],artifacts:[]};
const missing=name=>{try{return require(name);}catch{result.blockers.push(`${name} is not installed.`);return null;}};
const builder=missing('electron-builder'),electron=missing('electron');
if(process.platform!=='win32'||process.arch!=='x64')result.blockers.push('This packaging configuration is for a Windows x64 build host.');
for(const name of ['dist/index.html','package-lock.json'])try{await access(path.resolve(name));}catch{result.blockers.push(`${name} is required; dependencies must be resolved and locked before packaging.`);}
const versions=[];
for(const name of ['remotion','@remotion/bundler','@remotion/renderer'])try{const filename=require.resolve(`${name}/package.json`);versions.push(JSON.parse(await readFile(filename,'utf8')).version);}catch{result.blockers.push(`${name} is not installed at the application root.`);}
if(versions.length===3&&new Set(versions).size!==1)result.blockers.push('All Remotion packages must use the same resolved version.');
if(electron)try{const probe=await run(electron,['-e',"const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE probe(id INTEGER)');d.close();console.log(process.versions.node)"],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:20000});result.electronNode=probe.stdout.trim();}catch(e){result.blockers.push(`Electron embedded Node/SQLite preflight failed: ${e.message}`);}
if(!result.blockers.length)try{result.artifacts=await builder.build({config:require('../electron/builder-config.cjs'),publish:'never'});result.status='built-unverified';result.note='Installer created. Native install/start/render/export acceptance and code signing have not been established by packaging.';}catch(e){result.status='failed';result.error=e.message;}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/windows-package-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.status!=='built-unverified')process.exitCode=1;
