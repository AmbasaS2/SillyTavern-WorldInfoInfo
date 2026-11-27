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

test('outlet fallback counts exact found text, not the transformed text or name',async()=>{
 const {createInsightCapture,inspectInsight,estimateInsight}=await mod();
 const cap=createInsightCapture(1,'chat',3);
 cap.setPrompt(['Raw outlet fact. An ordinary fact.'],null,'request');
 cap.add({...entry(1),content:'Raw outlet fact.',outletName:'alpha'},'Transformed outlet fact.',true);
 cap.add({...entry(2),content:'alpha',outletName:'alpha'},'Missing outlet.',true);
 cap.add({...entry(3),content:'An ordinary fact.'},'Changed ordinary.',false);
 const rows=inspectInsight(cap);
 assert.deepEqual(rows.map(r=>r.status),['matched','unmatched','unmatched']);
 assert.equal(rows[0].text,'Raw outlet fact.');
 const calls=[];await estimateInsight(rows,cap,async s=>{calls.push(s);return s.length},()=>true,true);
 assert.ok(calls.includes('Raw outlet fact.\n'));assert.ok(!calls.some(s=>s.includes('Transformed outlet fact.')));
});
test('outlet fallback retains ambiguity for repeated and overlapping text',async()=>{
 const {createInsightCapture,inspectInsight}=await mod();
 const cap=createInsightCapture(1,'chat',2);cap.setPrompt(['Raw outlet fact. Raw outlet fact.'],null);
 cap.add({...entry(1),content:'Raw outlet fact.'},'Changed',true);cap.add(entry(2),'outlet fact.');
 assert.deepEqual(inspectInsight(cap).map(r=>r.status),['ambiguous','ambiguous']);
});
function fakeDocument(){
 class El{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.handlers={};this._text='';this.className='';this.open=false;this.isConnected=true;}
  set textContent(v){this._text=String(v);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}
  get childElementCount(){return this.children.length;}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.isConnected=false;}
  setAttribute(){}
  addEventListener(type,fn){this.handlers[type]=fn;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){}
  querySelectorAll(sel){const all=[];for(const c of this.children){if(sel==='details[open]'&&c.tagName==='details'&&c.open)all.push(c);all.push(...c.querySelectorAll(sel));}return all;}
  walk(){return [this,...this.children.flatMap(c=>c.walk())];}
 }
 const body=new El('body');return {body,activeElement:null,createElement:tag=>new El(tag)};
}
const tick=()=>new Promise(r=>setTimeout(r,15));
test('live dialog updates before completion, counts only on open, and reuses results',async()=>{
 const {createLoreInsight}=await mod();const old=global.document;global.document=fakeDocument();
 try{
  let listener=null,calls=[],chat='chat';
  const insight=createLoreInsight({t:(k,n)=>k+(n===undefined?'':' '+n),countText:async s=>{calls.push(s);return s.length},getScope:()=> 'same',getChatId:()=>chat,getReason:()=> 'constant',titleFor:e=>e.comment,isVisible:()=>true,reasonLabel:r=>r,watchRequest:fn=>{listener=fn;return()=>{listener=null;}}});
  insight.start();insight.open();assert.match(document.body.textContent,/insight.waiting/);
  const msg={content:'Present. Absent.'};const cap=insight.beginCapture(1,'chat',3);cap.setPrompt([msg.content],null);
  cap.add({...entry(1),comment:'Present entry'},'Present.');cap.add({...entry(2),comment:'Removed entry'},'Absent.');
  cap.add({...entry(3),comment:'Outlet entry',outletName:'outlet'},'Never present.',true);
  insight.finish(cap,true,{messages:[msg],type:'normal'});
  assert.match(document.body.textContent,/insight.matched/);assert.doesNotMatch(document.body.textContent,/insight.waiting/);
  msg.content='Present.';listener({type:'normal',messages:[msg]});assert.equal(listener,null);
  await tick();assert.ok(calls.length>0);assert.ok(!calls.some(x=>x.includes('Absent')));
  let sections=document.body.walk().filter(x=>x.dataset.insightSection==='matched'||x.dataset.insightSection==='unresolved');
  assert.equal(sections.length,2);assert.match(sections[0].textContent,/Present entry/);assert.doesNotMatch(sections[0].textContent,/Removed entry/);
  assert.match(sections[1].textContent,/Removed entry/);assert.match(sections[1].textContent,/reader.route.outlet/);assert.match(document.body.textContent,/insight.source.request/);
  const count=calls.length;insight.ready();await tick();assert.equal(calls.length,count);
  insight.close();insight.open();await tick();assert.equal(calls.length,count);
  insight.close();insight.start();const next=insight.beginCapture(2,'chat',1);next.setPrompt(['Next.'],null);next.add(entry(9),'Next.');
  insight.finish(next,true,null);await tick();assert.equal(calls.length,count);insight.clear();
 }finally{global.document=old;}
});
test('closing the dialog or changing chat cancels scheduled automatic measurement',async()=>{
 const {createLoreInsight}=await mod();const old=global.document;global.document=fakeDocument();
 try{
  let calls=0,chat='chat';const insight=createLoreInsight({t:k=>k,countText:async s=>{calls++;return s.length},getScope:()=> 'scope',getChatId:()=>chat,getReason:()=> 'constant',titleFor:e=>e.comment,isVisible:()=>true,reasonLabel:r=>r});
  insight.start();const cap=insight.beginCapture(1,'chat',1);cap.setPrompt(['Text.'],null);cap.add(entry(1),'Text.');
  insight.finish(cap,true,null);insight.open();insight.close();await tick();assert.equal(calls,0);
  insight.open();chat='other';await tick();assert.equal(calls,0);insight.clear();
 }finally{global.document=old;}
});

test('STLO consumer publishes structural evidence when closed and counts only when opened',async()=>{
 const {createLoreInsight}=await mod();const old=global.document;global.document=fakeDocument();
 try{
  let listener=null,calls=[],publications=[],local=0;
  const generation={},context={generation,tokenizer:'st-1:test'};
  const ledger=new Map();
  const bridge={version:1,context:()=>context,
   selection:()=>({decision:'include',source:'adaptive-role',score:0.91,budget:'accepted',activated:true}),
   lookup:d=>ledger.get(d.text)??null,
   measure:async d=>{calls.push(d);ledger.set(d.text,17);return 17},
   publishInjection:d=>{publications.push(d);return true}};
  const insight=createLoreInsight({t:(k,v)=>k+(v===undefined?'':' '+v),countText:async s=>{local++;return s.length},getScope:()=> 'scope',getChatId:()=> 'chat',getReason:()=> 'jev',titleFor:e=>e.comment,isVisible:()=>true,reasonLabel:r=>r,getMetricsBridge:()=>bridge,watchRequest:fn=>{listener=fn;return()=>{listener=null}}});
  insight.start();const a={...entry(1),position:0,order:1,stwiiJevRecall:true,comment:'Jev scene'},b={...entry(2),position:4,order:2,stwiiJevRecall:true,comment:'Depth scene'};
  const cap=insight.beginCapture(1,'chat',2);cap.add(a,'A scene.');cap.add(b,'B scene.');cap.setPrompt(['A scene.','B scene.'],null);
  const first={role:'system',content:'A scene.'},second={role:'system',content:'B scene.'};
  const structure={getCollection:()=>[{identifier:'worldInfoBefore',getCollection:()=>[{...first,identifier:'worldInfoBefore'}]},{identifier:'chatHistory',getCollection:()=>[{...second,identifier:'chatHistory-1'}]}]};
  insight.finish(cap,true,{messages:[first,second],type:'normal',structure,beforePosition:0,afterPosition:1,formatWorldInfo:s=>s});
  listener({type:'normal',messages:[first,second]});
  assert.equal(publications.length,1);assert.equal(calls.length,0);assert.equal(local,0);
  assert.deepEqual(publications[0].records,[{key:'["Book",1]',status:'confirmed',text:'A scene.\n'},{key:'["Book",2]',status:'unknown'}]);
  assert.equal(publications[0].complete,true);
  insight.open();await tick();
  assert.equal(calls.length,2);assert.equal(local,2);assert.equal(publications.length,2);
  assert.match(insight.selectionFor(a),/adaptive-role/);assert.match(document.body.textContent,/insight.jev.score/);
  assert.equal(publications[1].records[1].status,'unknown');insight.clear();
 }finally{global.document=old;}
});
