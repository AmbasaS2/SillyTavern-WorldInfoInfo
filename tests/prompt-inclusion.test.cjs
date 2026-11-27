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
test('unrelated opaque macro or conditional group cannot erase exact depth proof',async()=>{
 const {buildTraceEvidence}=await mod();
 const rows=[row(1,4,'depth memory',{depth:1,role:0})];
 const nodes=[node('chatHistory-3','depth memory','chatHistory'),node('chatHistory-4','old chat','chatHistory','user'),node('chatHistory-1','expanded value','chatHistory','assistant'),node('chatHistory-2','older','chatHistory','user')];
 const ordered=[nodes[2],nodes[3],nodes[0],nodes[1]];
 const {capture,info,trace}=fixture(rows,ordered,ordered.map(n=>req(n.content,n.role)),{trace:{
  extensions:new Map([['customDepthWI_1_0',{value:'depth memory',position:1,depth:1,role:0}],['other',{value:'{{getvar::example}}',position:1,depth:3,role:2,dynamic:true}]]),
  history:new Map([['chatHistory-4',{raw:'old chat',content:'old chat',role:'user'}],['chatHistory-3',{raw:'depth memory',content:'depth memory',role:'system'}],['chatHistory-2',{raw:'older',content:'older',role:'user'}],['chatHistory-1',{raw:'expanded value',content:'expanded value',role:'assistant'}]])
 }});
 assert.deepEqual(buildTraceEvidence(capture,info,trace).blocks.flatMap(b=>b.entries.map(e=>e.key)),['["Book",1]']);
 trace.history.get('chatHistory-3').raw='different';
 assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,0);
});
test('uncertain earlier slot and identical chat text do not become proof',async()=>{
 const {buildTraceEvidence}=await mod();
 const rows=[row(1,4,'depth memory',{depth:1,role:0})];
 const nodes=[node('chatHistory-1','older','chatHistory','user'),node('chatHistory-2','depth memory','chatHistory'),node('chatHistory-3','depth memory','chatHistory'),node('chatHistory-4','maybe macro','chatHistory')];
 const {capture,info,trace}=fixture(rows,nodes,nodes.map(n=>req(n.content,n.role)),{trace:{
  extensions:new Map([['unknown',{value:'{{getvar::example}}',position:1,depth:0,role:0}],['customDepthWI_1_0',{value:'depth memory',position:1,depth:1,role:0}]]),
  history:new Map(nodes.map(n=>[n.id,{raw:n.content,content:n.content,role:n.role}]))
 }});
 assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,0);
});
test('absolute main and relative prompt moved into its native bucket preserve separate depth lore',async()=>{
 const {buildTraceEvidence}=await mod();
 const rows=[row(1,4,'memory',{depth:1,role:0})];
 const nodes=[node('chatHistory-1','older','chatHistory','user'),node('chatHistory-2','memory','chatHistory'),node('chatHistory-3','recent','chatHistory','user'),node('chatHistory-4','main\nnote','chatHistory')];
 const {capture,info,trace}=fixture(rows,nodes,nodes.map(n=>req(n.content,n.role)),{trace:{
  prompts:[{id:'main',position:1,depth:0,role:'system',order:100,content:'main'},{id:'authorsNote',position:0,relativePosition:'end',role:'system',content:'note'}],
  extensions:new Map([['customDepthWI_1_0',{value:'memory',position:1,depth:1,role:0}]]),
  history:new Map(nodes.map(n=>[n.id,{raw:n.content,content:n.content,role:n.role}]))
 }});
 assert.deepEqual(buildTraceEvidence(capture,info,trace).blocks.flatMap(b=>b.entries.map(e=>e.key)),['["Book",1]']);
});
test('whole-prompt diagnostic limit does not erase actual dedicated source proof',async()=>{
 const {buildTraceEvidence}=await mod();
 const nodes=[node('worldInfoAfter','Real'),node('chatHistory-1','x'.repeat(530000),'chatHistory','user')];
 const {capture,info,trace}=fixture([row(1,1,'Real')],nodes,nodes.map(n=>req(n.content,n.role)));
 capture.promptLimited=true;
 assert.equal(buildTraceEvidence(capture,info,trace).blocks.length,1);
});

test('concurrent native assemblies reuse history IDs without stealing the live request trace',async()=>{
 const {observePromptAssembly,buildTraceEvidence}=await mod();
 class NativeMessage{
  static fromPromptAsync(p){return Promise.resolve({identifier:p.identifier,role:p.role,content:p.content});}
 }
 const originalFrom=NativeMessage.fromPromptAsync;
 const manager={
  serviceSettings:{squash_system_messages:true},
  getPromptCollection(){return {collection:[this.preparePrompt({identifier:'main',role:'system',content:'main'})]};},
  preparePrompt(p){return {...p};},
  setChatCompletion(c){this.messages=c.getMessages();}
 };
 const original=manager.preparePrompt,ext={customDepthWI_0_0:{value:'live memory',position:1,depth:0,role:0}};
 const obs=observePromptAssembly(manager,()=>ext,'normal',null,NativeMessage);
 const live=manager.getPromptCollection('normal'),dry=manager.getPromptCollection('normal');
 const dryPrompt=manager.preparePrompt({identifier:'chatHistory-2',role:'user',content:'dry old text'});
 const livePrompt=manager.preparePrompt({identifier:'chatHistory-2',role:'system',content:'live memory'});
 const [dryMain,liveMain,dryMessage,liveMessage,liveOld]=await Promise.all([
  NativeMessage.fromPromptAsync(dry.collection[0]),NativeMessage.fromPromptAsync(live.collection[0]),
  NativeMessage.fromPromptAsync(dryPrompt),NativeMessage.fromPromptAsync(livePrompt),
  NativeMessage.fromPromptAsync(manager.preparePrompt({identifier:'chatHistory-1',role:'user',content:'old'}))
 ]);
 const make=(main,history)=>({getMessages:()=>({getCollection:()=>[
  {identifier:'main',getCollection:()=>[main]},{identifier:'chatHistory',getCollection:()=>history}
 ]}),getChat:()=>[req(main.content),...history.map(n=>req(n.content,n.role))]});
 const dryCompletion=make(dryMain,[dryMessage]),liveCompletion=make(liveMain,[liveOld,liveMessage]);
 manager.setChatCompletion(dryCompletion);const dryArray=dryCompletion.getChat();
 manager.setChatCompletion(liveCompletion);const liveArray=liveCompletion.getChat();
 assert.equal(dryArray[1].content,'dry old text');
 const trace=obs.take(liveArray);
 assert.equal(trace.history.get('chatHistory-2').raw,'live memory');
 assert.equal(trace.collectionKnown,true);
 assert.equal(trace.structure.getCollection()[1].getCollection()[1],liveMessage);
 assert.equal(manager.preparePrompt,original);assert.equal(NativeMessage.fromPromptAsync,originalFrom);
 const {capture,info}=fixture([row(1,4,'live memory',{depth:0,role:0})],[],liveArray,{info:{squashed:true}});
 assert.deepEqual(buildTraceEvidence(capture,info,trace).blocks.flatMap(b=>b.entries.map(e=>e.key)),['["Book",1]']);
});

test('squashing preserves the native break caused by an empty non-system message',async()=>{
 const {buildTraceEvidence}=await mod();
 const rows=[row(1,1,'Real')],nodes=[node('main','main'),node('chatHistory-1','','chatHistory','assistant'),node('worldInfoAfter','Real')];
 const {capture,info,trace}=fixture(rows,nodes,[req('main'),req('Real')],{info:{squashed:true},trace:{squashed:true}});
 assert.deepEqual(buildTraceEvidence(capture,info,trace).blocks.flatMap(b=>b.entries.map(e=>e.key)),['["Book",1]']);
});

test('sparse native preset indices do not erase verified evidence for other prompts',async()=>{
 const {observePromptAssembly,buildTraceEvidence}=await mod();
 const manager={serviceSettings:{squash_system_messages:false},getPromptCollection(){return {collection:[]}},preparePrompt(p){return p},setChatCompletion(c){this.messages=c.getMessages();}};
 const observer=observePromptAssembly(manager,()=>({}),'normal');
 manager.getPromptCollection('normal');
 const items=[];
 items[2]={identifier:'worldInfoAfter',getCollection:()=>[{identifier:'worldInfoAfter',role:'system',content:'Real'}]};
 const c={getMessages:()=>({getCollection:()=>items}),getChat:()=>[req('Real')]};
 manager.setChatCompletion(c);
 const messages=c.getChat(),trace=observer.take(messages);
 const {capture,info}=fixture([row(1,1,'Real')],[],messages);
 assert.equal(trace.nodes.length,1);
 assert.deepEqual(buildTraceEvidence(capture,info,trace).blocks.flatMap(b=>b.entries.map(e=>e.key)),['["Book",1]']);
});
