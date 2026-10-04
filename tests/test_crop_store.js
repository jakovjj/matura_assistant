const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createCropStore} = require('../crop-store');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matura-crops-'));
try {
  fs.mkdirSync(path.join(root, 'data'));
  const original = {url:'./files/interactive/test/page-1.png',width:1000,height:1500,crop:{x:10,y:20,width:600,height:400},segments:[{x:10,y:20,width:600,height:100}]};
  const text = `window.TEST=${JSON.stringify({questions:[{source:original}]})};\n`;
  fs.writeFileSync(path.join(root,'data/test.js'), text);
  let store = createCropStore(root);
  const source = [...store.parse(text,'test.js').sources.values()][0];
  const id = source.adminCropId;
  const crop = {x:20,y:30,width:650,height:450};
  assert.throws(() => store.save('../server.js',crop,original.crop,'admin'));
  assert.throws(() => store.save(id,{...crop,width:2000},original.crop,'admin'));
  assert.throws(() => store.save(id,{...crop,x:'20'},original.crop,'admin'));
  store.save(id,crop,original.crop,'admin');
  store = createCropStore(root);
  assert.deepEqual(store.resolve(id).crop,crop);
  assert.equal(store.resolve(id).segments,undefined);
  assert.throws(() => store.save(id,original.crop,original.crop,'other'), {status:409});
  assert.equal(fs.readFileSync(path.join(root,'data/test.js'),'utf8'),text);
  assert.equal([...store.parse(text,'test.js').sources.values()][0].adminCropId,id);
  const changed = text.replace('"x":10','"x":11');
  assert.deepEqual([...store.parse(changed,'test.js').sources.values()][0].crop,{...original.crop,x:11});
  console.log('Crop persistence, bounds, stale edits and regeneration checks passed');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
