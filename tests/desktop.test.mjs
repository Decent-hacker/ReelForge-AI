// Pure desktop policy tests; no claim that Electron native windows/dialogs were exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../electron/policy.cjs';
import path from 'node:path';
test('packaged app stores data in userData while development preserves existing local projects',()=>{
  assert.equal(policy.dataDirectory({isPackaged:false,userData:'/user',developmentRoot:'/dev'}),path.resolve('/dev/data'));
  assert.equal(policy.dataDirectory({isPackaged:true,userData:'/user',developmentRoot:'/dev'}),path.resolve('/user/projects'));
});
test('native operations accept only named tool pickers and approved attribution links',()=>{
  assert.deepEqual(policy.toolDialog('alignModel').properties,['openDirectory']);assert.deepEqual(policy.toolDialog('python').filters[0].extensions,['exe']);assert.throws(()=>policy.toolDialog('arbitrary-code'));
  assert.equal(policy.providerLink('https://www.pexels.com/license/'),true);for(const url of ['file:///etc/passwd','https://evil.example/','https://user:pass@www.pexels.com/','javascript:alert(1)'])assert.equal(policy.providerLink(url),false);
});
