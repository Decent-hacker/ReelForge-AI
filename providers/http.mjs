import {setTimeout as sleep} from 'node:timers/promises';
export class ProviderError extends Error{
  constructor(provider,message,status=0){super(`${provider}: ${message}`);this.provider=provider;this.status=status;}
}
export async function limitedJSON(response,limit=4000000){
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('Provider JSON exceeded the size limit.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Provider returned malformed JSON.');}
}
export async function providerRequest(provider,url,{apiKey,fetchImpl=fetch,signal,timeout=45000,retries=2,delay=sleep,...options}={}){
  let last;
  for(let attempt=0;attempt<=retries;attempt++){
    if(signal?.aborted)throw new Error('Cancelled.');
    try{
      const response=await fetchImpl(url,{...options,signal:AbortSignal.any([AbortSignal.timeout(timeout),...(signal?[signal]:[])])});
      if(response.ok)return response;
      const retryable=response.status===429||response.status>=500;
      last=new ProviderError(provider,`HTTP ${response.status}${response.status===401||response.status===403?' — check provider credentials and access.':''}`,response.status);
      if(!retryable||attempt===retries)throw last;
      const wait=Number(response.headers.get('retry-after'));await response.body?.cancel();await delay(Math.min(5000,Number.isFinite(wait)&&wait>0?wait*1000:500*2**attempt),undefined,{signal});
    }catch(error){
      if(signal?.aborted)throw new Error('Cancelled.');
      if(error instanceof ProviderError)throw error;
      last=new ProviderError(provider,String(error.message||error).replaceAll(apiKey||'__no_key__','[redacted]'));
      if(attempt===retries)throw last;await delay(500*2**attempt,undefined,{signal});
    }
  }
  throw last;
}
