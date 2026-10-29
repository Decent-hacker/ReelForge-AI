const path=require('node:path');
function dataDirectory({isPackaged,userData,developmentRoot,override}){return path.resolve(override||(isPackaged?path.join(userData,'projects'):path.join(developmentRoot,'data')));}
function providerLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['pexels.com','www.pexels.com'].includes(u.hostname);}catch{return false;}}
function toolDialog(key){if(['asrModel','alignModel'].includes(key))return {properties:['openDirectory']};if(!['ffmpeg','ffprobe','whisper','model','python','browser'].includes(key))throw new Error('Unknown tool.');return {properties:['openFile'],filters:[{name:key==='model'?'Multilingual model':'Executable',extensions:key==='model'?['bin']:['exe']}]};}
module.exports={dataDirectory,providerLink,toolDialog};
