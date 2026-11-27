const {test}=require('node:test');
const assert=require('node:assert/strict');
const mod=()=>import('../stlo-metrics-link.mjs');
const entry=(uid,position=0,order=0)=>({world:'Book',uid,position,order,stwiiJevRecall:true});
test('companion lookup, measure, exact key type, unpadded count and independent fallback',async()=>{
 const {connectStloMetrics}=await mod();const handle={},ctx={generation:handle,tokenizer:'tok'};let lookup,measure,fallback=0;
 const bridge={version:1,context:()=>ctx,lookup:d=>{lookup=d;return d.text==='same\n'?13:null},measure:async d=>{measure=d;return 17}};
 const link=connectStloMetrics(()=>bridge),local=async()=>{fallback++;return 23};
 assert.equal(await link.count(entry('1'),'same\n',local,()=>true),13);
 assert.equal(await link.count(entry(1),'excerpt\n',local,()=>true),17);
 assert.equal(lookup.target,'["Book",1]');assert.equal(measure.target,'["Book",1]');assert.equal(measure.text,'excerpt\n');assert.equal(measure.padding,undefined);assert.equal(fallback,0);
 bridge.measure=async()=>null;
 assert.equal(await link.count(entry(1),'other\n',local,()=>true),23);
 assert.equal(connectStloMetrics(()=>null),null);assert.equal(connectStloMetrics(()=>({version:2})),null);
});
test('stale companion handles never revive, selection data remains positive observed and bounded',async()=>{
 const {connectStloMetrics}=await mod();const handle={},ctx={generation:handle,tokenizer:'tok'};let current=ctx,resolve,called=0;
 const bridge={version:1,context:()=>current,selection:()=>({decision:'include',source:'adaptive-role',score:0.7,budget:'accepted',activated:true,body:'private'}),measure:()=>new Promise(r=>{resolve=r}),publishInjection:()=>{called++;return true}};
 const link=connectStloMetrics(()=>bridge);
 assert.deepEqual(link.selection(entry(1)),{source:'adaptive-role',score:0.7,accepted:true});
 assert.equal(link.selection({...entry(1),stwiiJevRecall:false}),null);
 const pending=link.count(entry(1),'text\n',async()=>99,()=>true);
 current={generation:{},tokenizer:'tok'};assert.equal(link.live(),false);current=ctx;
 resolve(17);assert.equal(await pending,99);assert.equal(link.live(),false);assert.equal(link.publish([],true),false);assert.equal(called,0);
});
function fixture(){
 const rows=[{entry:entry(1,0,100),text:'first'},{entry:entry(2,0,10),text:'second'},{entry:entry(3,4,10),text:'third'}];
 const first={role:'system',content:'<wi>second\nfirst</wi>'},second={role:'system',content:'third'};
 const structure={getCollection:()=>[{identifier:'worldInfoBefore',getCollection:()=>[{...first,identifier:'worldInfoBefore'}]},{identifier:'chatHistory',getCollection:()=>[{...second,identifier:'chatHistory-1'}]}]};
 return {capture:{rows,observed:3},info:{messages:[first,second],structure,beforePosition:0,afterPosition:1,formatWorldInfo:s=>'<wi>'+s+'</wi>'},first,second};
}
test('exact structured group confirms ordered full and partial text, not arbitrary substring or depth',async()=>{
 const {buildStructuredProof,confirmStructuredProof,buildInjectionRecords}=await mod();const {capture,info,first,second}=fixture();
 const blocks=buildStructuredProof(capture,info);
 assert.equal(blocks.length,1);
 capture.proven=confirmStructuredProof(blocks,[first,second]);
 assert.deepEqual([...capture.proven],[['["Book",2]','second\n'],['["Book",1]','first\n']]);
 assert.deepEqual(buildInjectionRecords(capture,()=>true,true),{records:[{key:'["Book",1]',status:'confirmed',text:'first\n'},{key:'["Book",2]',status:'confirmed',text:'second\n'},{key:'["Book",3]',status:'unknown'}],complete:true});
 assert.equal(confirmStructuredProof(blocks,[{...first},second]).size,0);
 first.content='changed';assert.equal(confirmStructuredProof(blocks,[first,second]).size,0);
});
test('mismatched or squashed prompt, duplicate keys, truncation, hidden entries stay unverified',async()=>{
 const {buildStructuredProof,buildInjectionRecords}=await mod();const {capture,info}=fixture();
 assert.equal(buildStructuredProof(capture,{...info,squashed:true}).length,0);
 assert.equal(buildStructuredProof(capture,{...info,messages:[...info.messages].reverse()}).length,0);
 capture.rows[1].entry.uid=1;assert.equal(buildStructuredProof(capture,info).length,0);
 assert.equal(buildInjectionRecords(capture,()=>true,true).complete,false);
 capture.rows[1].entry.uid=2;capture.rows[2].entry.world='Hidden';
 assert.equal(buildInjectionRecords(capture,w=>w!=='Hidden',true).complete,false);
 capture.truncated=true;assert.equal(buildStructuredProof(capture,info).length,0);
});
