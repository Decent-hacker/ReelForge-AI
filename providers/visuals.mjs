export class VisualProviderRegistry{
  constructor(){this.adapters=new Map();}
  register(id,adapter){if(!/^[a-z0-9-]+$/.test(id)||typeof adapter?.status!=='function'||typeof adapter?.generate!=='function')throw new Error('Visual provider must implement status() and generate(request, context).');this.adapters.set(id,adapter);}
  status(){return [...this.adapters].map(([id,adapter])=>({id,...adapter.status()}));}
  async generate(id,request,context){const provider=this.adapters.get(id);if(!provider||!provider.status().configured)throw new Error(`Visual provider ${id||'(none)'} is unavailable. Use approved local or stock assets; no generated visual was substituted.`);if(!['image','video'].includes(request?.kind)||typeof request.prompt!=='string'||!request.prompt.trim()||request.prompt.length>4000)throw new Error('Invalid visual-generation request.');return provider.generate(request,context);}
}
export const visualProviders=new VisualProviderRegistry();
