import {mkdir,stat,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from '../server/index.mjs';
import {run} from '../engine/process.mjs';

// Real browser screenshots only. Never substitute an illustration or server-rendered mock.
const root=path.resolve('artifacts/graphite-qa'),report={at:new Date().toISOString(),status:'not-run',browser:null,screenshots:[],checks:[],blockers:[]};
await mkdir(root,{recursive:true});
const browser=process.env.REELFORGE_BROWSER||path.join(process.env.LOCALAPPDATA||'','BraveSoftware/Brave-Browser/Application/brave.exe');
let application;
try{
  if(!(await stat(browser)).isFile())throw new Error('Set REELFORGE_BROWSER to an installed Chromium browser executable.');
  report.browser=browser;
  application=await createServer({root:path.join(root,`data-${Date.now()}`),port:0});
  const p=await application.service.store.create('Graphite UI review');
  report.checks.push({name:'Actual application server startup',passed:true,projectId:p.id});
  for(const [width,height] of [[1366,768],[1920,1080],[1280,800]]){
    const file=path.join(root,`workspace-${width}x${height}.png`),profile=path.join(root,`browser-${Date.now()}`);
    const result=await run(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${width},${height}`,`--screenshot=${file}`,application.url],{timeout:20000});
    let screenshot;try{screenshot=await readFile(file);}catch{throw new Error(`Browser produced no screenshot. ${result.stderr.slice(-4500)}`);}
    if(!screenshot.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Browser output is not a PNG screenshot.');
    report.screenshots.push({width,height,file});
  }
  report.status='screenshots-captured-review-required';
  report.blockers.push('Inspect captured images and execute keyboard/mouse acceptance before declaring visual QA complete.');
}catch(e){report.status='blocked';report.blockers.push(e.message);}
finally{if(application)await application.close();}
await writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.status==='blocked')process.exitCode=1;
