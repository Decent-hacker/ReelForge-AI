import {createRequire} from 'node:module';
import {doctor} from './process.mjs';
import {speechDiagnostics} from './speech.mjs';
import {GeminiProvider} from '../providers/gemini.mjs';
import {PexelsProvider} from '../providers/pexels.mjs';
import {visualProviders} from '../providers/visuals.mjs';
export async function runtimeDiagnostics(settings={}){
  const [media,speech]=await Promise.all([doctor(settings),speechDiagnostics(settings)]);const require=createRequire(new URL('../composition/package.json',import.meta.url));
  const moduleAvailable=name=>{try{require.resolve(name);return true;}catch{return false;}};
  const remotion={available:moduleAvailable('@remotion/renderer')&&moduleAvailable('@remotion/bundler'),liveVerified:false};
  if(!remotion.available)remotion.error='Remotion packages are not installed. No composition output has been verified.';
  return {...media,tools:{...media.tools,speech,remotion,electron:{available:moduleAvailable('electron'),liveVerified:false},packager:{available:moduleAvailable('electron-builder'),liveVerified:false}},
    providers:{gemini:new GeminiProvider({model:settings.geminiModel||process.env.GEMINI_MODEL}).status(),pexels:new PexelsProvider().status(),visuals:visualProviders.status()},
    selected:{renderer:settings.renderer||'ffmpeg',speech:settings.speechEngine||'faster-whisper',planning:settings.planningEngine||'local',stock:settings.stockProvider||'local'}};
}
