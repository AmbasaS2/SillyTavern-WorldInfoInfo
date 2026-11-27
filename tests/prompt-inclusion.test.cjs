const {test}=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../prompt-inclusion.mjs');
const entry=(uid,position,order=100,extra={})=>({world:'Book',uid,position,order,...extra});
const row=(uid,position,text,extra={})=>({entry:entry(uid,position,100,extra),text,outlet:position===7});
const node=(id,content,parent=id,role='system')=>({id,parent,role,content,name:'',tools:false});
const req=(content,role='system')=>({content,role});
function fixture(rows,nodes,messages,extra={}){
 const capture={rows,observed:rows.length};
 const info={messages,beforePosition:0,afterPosition:1,depthPosition:4,anTopPosition:2,anBottomPosition:3,formatWorldInfo:s=>s,squashed:false,...extra.info};
 const trace={nodes,extensions:new Map(),prompts:[],history:new Map(),squashed:false,type:'normal',...extra.trace};
 return {capture,info,trace};
}
test('native before/after and squash are proven from actual dedicated message, disabled duplicate is excluded',async()=>{
 const {buildTraceEvidence}=await mod();
 const first=req('intro\nA\nB'),{capture,info,trace}=fixture([row(1,0,'A'),row(2,1,'B'),row(3,0,'unused')],[node('main','intro'),node('worldInfoAfter','B'),node('chatHistory-1','A','chatHistory')],[req('intro\nB\nA')],{info:{squashed:true},trace:{squashed:true,disabledBefore:true}});
 const result=buildTraceEvidence(capture,info,trace);
 assert.deepEqual(result.blocks.flatMap(x=>x.entries.map(e=>e.key)),['["Book",2]']);
 assert.deepEqual([...result.excluded],[['["Book",1]','preset'],['["Book",3]','preset']]);
 info.messages=[first];assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,0);
});
test('depth proof uses native slot and exact actual prepared history; a similar old chat never substitutes',async()=>{
 const {buildTraceEvidence}=await mod();
 const rows=[row(1,4,'depth memory',{depth:1,role:0}),row(2,4,'too deep',{depth:3,role:0})];
 // reverse pool: original, depth1, original, depth3, original.
 const {capture,info,trace}=fixture(rows,[node('chatHistory-4','depth memory','chatHistory'),node('chatHistory-5','old chat','chatHistory','user')],[req('depth memory'),req('old chat','user')],{trace:{
 extensions:new Map([['customDepthWI_1_0',{value:'depth memory',position:1,depth:1,role:0}],['customDepthWI_3_0',{value:'too deep',position:1,depth:3,role:0}]]),
 history:new Map([['chatHistory-5',{raw:'old chat',content:'old chat',role:'user'}],['chatHistory-4',{raw:'depth memory',content:'depth memory',role:'system'}],['chatHistory-3',{raw:'other',content:'other',role:'assistant'}]])
 }});
 const result=buildTraceEvidence(capture,info,trace);
 assert.deepEqual(result.blocks.flatMap(b=>b.entries.map(e=>e.key)),['["Book",1]']);
 assert.equal(result.excluded.get('["Book",2]'),'context');
 trace.history.get('chatHistory-4').raw='not injection';
 assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,0);
});
test('direct outlet macro in an actual preset is proof; matching user history without macro is not',async()=>{
 const {buildTraceEvidence}=await mod();
 const rows=[row(1,7,'Outlet text',{outletName:'memory'})];
 const {capture,info,trace}=fixture(rows,[node('main','Before\nOutlet text')],[req('Before\nOutlet text')],{trace:{
 extensions:new Map([['customWIOutlet_memory',{value:'Outlet text',position:-1}]]),prompts:[{id:'main',role:'system',raw:'Before\n{{outlet::memory}}',content:'Before\nOutlet text'}]
 }});
 assert.equal(buildTraceEvidence(capture,info,trace).blocks[0].entries[0].key,'["Book",1]');
 trace.prompts[0].raw='Before\nOutlet text';assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,0);
 trace.prompts[0].raw='Before\n{{outlet::memory}}';info.messages[0].content='changed';assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,0);
});
test('observing native assembly preserves returns and restores inherited methods',async()=>{
 const {observePromptAssembly,buildTraceEvidence}=await mod();
 const original={
 getPromptCollection(){return {collection:[this.preparePrompt({identifier:'main',role:'system',content:'{{outlet::memory}}'})]};},
 preparePrompt(p){return {...p,content:p.content.replace('{{outlet::memory}}','value')};},
 setChatCompletion(c){this.messages=c.getMessages();return 42;},
 isPromptDisabledForActiveCharacter(){return false;}
 };
 const manager=Object.create(original);manager.serviceSettings={squash_system_messages:false};
 const observer=observePromptAssembly(manager,()=>({customWIOutlet_memory:{position:-1,value:'value'}}),'normal');
 const prompts=manager.getPromptCollection('normal');
 const root={getCollection:()=>[{identifier:'main',getCollection:()=>[{identifier:'main',role:'system',content:prompts.collection[0].content}]}]};
 assert.equal(manager.setChatCompletion({getMessages:()=>root}),42);
 const trace=observer.take();
 assert.equal(manager.preparePrompt,original.preparePrompt);assert.equal(Object.hasOwn(manager,'preparePrompt'),false);
 const {capture,info}=fixture([row(1,7,'value',{outletName:'memory'})],[],[req('value')]);
 assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,1);
});
test('nonactivated entries carry only bounded metadata and actual logged reasons',async()=>{
 const {collectNonactivated,scanSkipReason}=await mod();
 const a=entry(1,0),b={...entry(2,0),content:'sensitive text',comment:'skipped',key:['x']};
 const result=collectNonactivated({globalLore:[a,b],characterLore:[b]},[a],new Map([['["Book",2]','cooldown']]));
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].reason,'cooldown');assert.equal('content' in result.rows[0].entry,false);
 assert.equal(scanSkipReason('suppressed by cooldown'),'cooldown');assert.equal(scanSkipReason('activated because of constant'),null);
 assert.equal(collectNonactivated({globalLore:[a,b]},[],null,1).limited,true);
});
