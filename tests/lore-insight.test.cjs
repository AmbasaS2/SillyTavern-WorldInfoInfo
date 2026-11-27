const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const mod=()=>import('../lore-insight.mjs');
const entry=(uid,world='Book')=>({uid,world});
test('rendered activation evidence, repeated and overlapping text are distinct',async()=>{
 const {createInsightCapture,inspectInsight}=await mod();
 const cap=createInsightCapture(1,'chat',5);
 const prompt='Unique fact. Same repeated. Same repeated. Overlap fragment. Other.';
 cap.setPrompt([prompt],prompt);
 for(const [i,text] of ['Unique fact.','Same repeated.','Overlap fragment.','fragment.','Not in request'].entries())cap.add(entry(i),text);
 assert.deepEqual(inspectInsight(cap).map(r=>r.status),['matched','ambiguous','ambiguous','ambiguous','unmatched']);
});
test('missing prompt, duplicates and oversized prompt never create false matches',async()=>{
 const {createInsightCapture,inspectInsight}=await mod();
 const cap=createInsightCapture(1,'chat',null);
 cap.setPrompt(['x'.repeat(530000)],'x');
 cap.add(entry(1),'x');cap.add(entry(1),'x');cap.add(entry(1,'Other'),'x');
 assert.equal(cap.parts,null);
 assert.deepEqual(inspectInsight(cap).map(r=>r.status),['unknown','unknown']);
});
test('recorded activation reasons are not configured flags or double counted',async()=>{
 const {insightReason}=await mod();
 assert.equal(insightReason({constant:true},null),'unknown');
 assert.equal(insightReason({}, {primary:'key',vectorConfirmed:true}),'multiple');
 assert.equal(insightReason({stwiiJevRecall:true},{logic:'CONSTANT'}),'jev');
 assert.equal(insightReason({}, {logic:'CONSTANT'}),'constant');
});
test('hidden-book visibility',async()=>{
 const {canShowInsightWorld}=await mod();
 assert.equal(canShowInsightWorld('Z-alice-private',false,'bob'),false);
 assert.equal(canShowInsightWorld('Z-alice-private',false,'alice'),true);
 assert.equal(canShowInsightWorld('9Z-private',false,'alice'),false);
 assert.equal(canShowInsightWorld('9Z Universal Commands',false,'alice'),true);
 assert.equal(canShowInsightWorld('Z-alice-private',true,'bob'),true);
});
test('identical text coalesces, scope changes and failures invalidate',async()=>{
 const {createInsightTokenCache}=await mod();
 let scope='a',calls=0;
 const cache=createInsightTokenCache(async s=>{calls++;return s==='bad'?0:s.length},()=>scope);
 assert.deepEqual(await Promise.all([cache.countText('a'),cache.countText('a')]),[1,1]);
 assert.equal(calls,1);await cache.countText('a\n');assert.equal(calls,2);
 scope='b';await cache.countText('a');assert.equal(calls,3);
 assert.equal(await cache.countText('bad'),null);assert.equal(await cache.countText('bad'),null);assert.equal(calls,5);
 cache.clear();await cache.countText('a');assert.equal(calls,6);
});
test('only explicit estimates count matched text; missing and cancelled values are not zero',async()=>{
 const {createInsightCapture,inspectInsight,estimateInsight}=await mod();
 const cap=createInsightCapture(1,'chat',3);
 cap.setPrompt(['First fact. Second fact.'],'First fact. Second fact.');
 cap.add(entry(1),'First fact.');cap.add(entry(2),'Second fact.');cap.add(entry(3),'Absent.');
 let rows=inspectInsight(cap),calls=[];
 const count=async s=>{calls.push(s);return s==='Second fact.\n'?null:s.length};
 assert.equal(calls.length,0);
 const result=await estimateInsight(rows,cap,count,()=>true,true);
 assert.equal(result.total,'First fact.\nSecond fact.'.length);
 assert.equal(rows[1].tokens,null);assert.equal(rows[2].tokens,null);
 assert.ok(!calls.some(s=>s.includes('Absent')));
 rows=inspectInsight(cap);calls=[];
 const cancelled=await estimateInsight(rows,cap,async s=>{calls.push(s);return 1},()=>calls.length===0,true);
 assert.equal(cancelled,null);assert.equal(calls.length,1);
});
test('capture/measurement caps do not invent complete totals',async()=>{
 const {createInsightCapture,inspectInsight,estimateInsight}=await mod();
 const cap=createInsightCapture(1,'chat',300);
 cap.setPrompt(['one'], 'one');
 for(let i=0;i<300;i++)cap.add(entry(i),'one');
 assert.equal(cap.rows.length,256);assert.equal(cap.truncated,true);
 const rows=inspectInsight(cap);
 const r=await estimateInsight(rows,cap,async()=>1,()=>true,false);
 assert.equal(r.total,null);assert.equal(r.prompt,null);assert.equal(r.limited,true);
});
test('actual menu button, preserved reset command and lifecycle cleanup',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
 const ko=JSON.parse(fs.readFileSync(path.join(__dirname,'../i18n/ko-kr.json'),'utf8'));
 assert.match(source,/const insightButton = document\.createElement\('button'\)/);
 assert.match(source,/STWII\.loreInsight\?\.open\(\)/);
 assert.doesNotMatch(source,/configPanel\.append\(resetRow\)/);
 assert.match(source,/name: 'wi-position-reset'/);
 assert.equal(ko['worldInfoInfo.settings.insight.label'],'로어 인사이트 보기');
 assert.match(source,/insight\.clear\(\);\s*insightTokens\.clear\(\)/);
});

test('request correlation excludes quiet, cloned and reordered requests',async()=>{
 const {createRequestMatcher,requestTextParts}=await mod();
 const a={role:'system',content:'A'},b={role:'user',content:'B'},c={role:'assistant',content:'C'};
 const match=createRequestMatcher([a,b,c],'normal');
 assert.equal(match({type:'quiet',messages:[a,b,c]}),false);
 assert.equal(match({type:'normal',messages:[{...a},{...b},{...c}]}),false);
 assert.equal(match({type:'normal',messages:[c,b,a]}),false);
 assert.equal(match({type:'normal',messages:[a,{...b,content:'Changed'},c]}),true);
 assert.equal(match({type:'normal',messages:[a]}),false);
 assert.deepEqual(requestTextParts([a,{content:[{type:'text',text:'D'},{type:'image_url',image_url:{url:'ignore'}}]}]),['A','D']);
});
test('message boundaries, duplicate IDs and changed request contents',async()=>{
 const {createInsightCapture,inspectInsight}=await mod();
 const cap=createInsightCapture(1,'chat',4);
 cap.setPrompt(['One','Two and Three'],null);
 cap.add(entry(1),'One Two');cap.add(entry(2),'One');
 cap.add(entry(3),'Three');cap.add(entry(3),'Different text');
 assert.deepEqual(inspectInsight(cap).map(r=>r.status),['unmatched','matched','ambiguous']);
 cap.setPrompt(['Other'],null,'request');
 assert.equal(cap.source,'request');
 assert.equal(inspectInsight(cap)[1].status,'unmatched');
});
test('oversized request invalidates assembled text evidence rather than falling back silently',async()=>{
 const {createInsightCapture,inspectInsight,requestTextParts}=await mod();
 const cap=createInsightCapture(1,'chat',1);
 cap.add(entry(1),'Earlier');cap.setPrompt(['Earlier'],null);
 cap.setPrompt(requestTextParts([{content:'x'.repeat(524289)}]),null,'request');
 assert.equal(cap.promptLimited,true);assert.equal(cap.source,'request');
 assert.equal(inspectInsight(cap)[0].status,'unknown');
});
test('in-flight count is discarded on scope change or clear',async()=>{
 const {createInsightTokenCache}=await mod();
 let resolve,scope='a';
 const cache=createInsightTokenCache(()=>new Promise(r=>{resolve=r}),()=>scope);
 let pending=cache.countText('entry');cache.clear();resolve(3);assert.equal(await pending,null);
 pending=cache.countText('entry');scope='b';resolve(3);assert.equal(await pending,null);
});
test('retry only missing counts and preserve successful estimates',async()=>{
 const {createInsightCapture,inspectInsight,estimateInsight}=await mod();
 const cap=createInsightCapture(1,'chat',2);
 cap.setPrompt(['A text and B text'],null);
 cap.add(entry(1),'A text');cap.add(entry(2),'B text');
 const rows=inspectInsight(cap);let calls=[];
 const first=await estimateInsight(rows,cap,async s=>{calls.push(s);return s==='B text\n'?null:s.length},()=>true,true);
 assert.equal(first.failed,true);assert.equal(rows[0].tokens,7);
 calls=[];
 const second=await estimateInsight(rows,cap,async s=>{calls.push(s);return s.length},()=>true,true,first);
 assert.equal(second.failed,false);assert.deepEqual(calls,['B text\n']);
});
