const token=location.hash.slice(1)||sessionStorage.getItem('reelforge-token')||'';
if(token)sessionStorage.setItem('reelforge-token',token);
// Keep session URLs out of history/referrers after the app has captured the token.
if(location.hash)history.replaceState(null,'',location.pathname);
export async function api<T>(route:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
  const response=await fetch(`/api/${route}`,{method,headers:{'X-ReelForge-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||`Request failed (${response.status})`);return value;
}
export function media(id:string,action:string){return `/api/projects/${id}/${action}?token=${encodeURIComponent(token)}`;}
export async function upload(id:string,role:string,file:File):Promise<import('./types').Project>{
  const response=await fetch(`/api/projects/${id}/import?role=${encodeURIComponent(role)}&name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'X-ReelForge-Token':token,'Content-Type':'application/octet-stream'},body:file});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Import failed.');return data;
}
