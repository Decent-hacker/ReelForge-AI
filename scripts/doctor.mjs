import {readFile} from 'node:fs/promises';
import {runtimeDiagnostics} from '../engine/diagnostics.mjs';
import path from 'node:path';
let settings={};try{settings=JSON.parse(await readFile(path.resolve('data/settings.json'),'utf8'));}catch{}
const health=await runtimeDiagnostics(settings);console.log(JSON.stringify(health,null,2));
if(!health.tools.ffmpeg.available||!health.tools.ffprobe.available)process.exitCode=1;
