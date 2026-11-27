const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
test('all manifest Lore Insight locales cover all English keys and preserve placeholders',()=>{
 const index=fs.readFileSync(path.join(root,'index.js'),'utf8');
 const en=Object.fromEntries([...index.matchAll(/^\s*("(?:settings\.insight|insight\.)[^"]*"):\s*("(?:[^"\\]|\\.)*")[,]?$/gm)].map(x=>[JSON.parse(x[1]),JSON.parse(x[2])]));
 assert.ok(Object.keys(en).length>=43);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 const files=[...new Set(Object.values(manifest.i18n))];
 assert.equal(files.length,6);
 for(const file of files){
  const locale=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  for(const [key,value] of Object.entries(en)){
   const translated=locale['worldInfoInfo.'+key];
   assert.ok(typeof translated==='string'&&translated.trim(),file+': '+key);
   assert.deepEqual((translated.match(/\{\d+\}/g)||[]).sort(),(value.match(/\{\d+\}/g)||[]).sort(),file+': '+key);
  }
 }
});
