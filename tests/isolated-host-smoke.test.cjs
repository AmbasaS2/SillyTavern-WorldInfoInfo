// Disposable GitHub-runner host test. Synthetic data and loopback only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('ST 1.19.1 real request: strict book/insight membership and lazy rendering', {timeout:300000},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wi-host-ci-')),host=path.join(tmp,'host'),data=path.join(tmp,'data');
 let server,browser,log,page,failed=true;const errors=[],consoleTail=[];
 const run=(file,args,cwd=tmp)=>execFileSync(file,args,{cwd,stdio:'inherit',timeout:150000});
 try{
  run('git',['clone','--depth','1','--branch','1.19.1','https://github.com/SillyTavern/SillyTavern.git',host]);
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:host,encoding:'utf8'}).trim(),'82b64a45c34facbc98ff4b9f33c067d3ccab6a17');
  run('npm',['ci','--omit=dev','--no-audit','--no-fund','--ignore-scripts'],host);
  run('npm',['install','--prefix',path.join(tmp,'qa'),'--no-audit','--no-fund','--ignore-scripts','playwright-core@1.55.0']);
  const dest=path.join(host,'public/scripts/extensions/third-party/SillyTavern-WorldInfoInfo');
  fs.mkdirSync(dest,{recursive:true});
  for(const name of fs.readdirSync(root)){
   if(/\.(?:js|mjs|css)$/.test(name)&&!name.endsWith('.test.mjs')||name==='manifest.json')fs.copyFileSync(path.join(root,name),path.join(dest,name));
  }
  fs.cpSync(path.join(root,'i18n'),path.join(dest,'i18n'),{recursive:true});
  const config=path.join(tmp,'config.yaml');fs.copyFileSync(path.join(host,'default/config.yaml'),config);
  const port=18749,url='http://127.0.0.1:'+port;
  // Bypass only the synthetic profile's first-run username dialog.
  const settingsPath=path.join(host,'default/content/settings.json'),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));
  settings.firstRun=false;settings.main_api='openai';settings.extension_settings.notifyUpdates=false;
  settings.extension_settings.autoConnect=false;
  Object.assign(settings.oai_settings??=( {}),{chat_completion_source:'custom',custom_model:'qa-model',custom_url:url+'/mock/v1',stream_openai:false});
  fs.writeFileSync(settingsPath,JSON.stringify(settings));
  log=fs.openSync(path.join(tmp,'server.log'),'w');
  server=spawn(process.execPath,['server.js','--configPath',config,'--dataRoot',data,'--port',String(port),'--listen','false','--browserLaunchEnabled','false'],{cwd:host,stdio:['ignore',log,log]});
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('host exited');try{if((await fetch(url)).ok)break;}catch{}await sleep(500);if(i===99)throw Error('host startup timeout');}
  const {chromium}=require(path.join(tmp,'qa/node_modules/playwright-core'));
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  page=await browser.newPage({viewport:{width:1280,height:900}});const requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error'||/\[WI\].*(Adding|DONE)/.test(m.text())){consoleTail.push(m.text().slice(0,240));if(consoleTail.length>30)consoleTail.shift();}});
  let releaseResponse=null;
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin!==url){await route.abort();return;}
   if(u.pathname==='/api/backends/chat-completions/status'){await route.fulfill({json:{data:[{id:'qa-model',object:'model'}]}});return;}
   if(u.pathname==='/api/backends/chat-completions/generate'){
    requests.push(req.postDataJSON());
    await new Promise(resolve=>{releaseResponse=resolve;});
    await route.fulfill({json:{choices:[{index:0,message:{role:'assistant',content:'Synthetic QA reply.'},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:5,total_tokens:1005}}});
    return;
   }
   await route.continue();
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.STWII?.loreInsight&&window.SillyTavern?.getContext?.().characters?.length>0,null,{timeout:30000});
  const setup=await page.evaluate(async()=>{
   const host=await import('/script.js'),wi=await import('/scripts/world-info.js'),o=await import('/scripts/openai.js');
   await host.selectCharacterById(0,{switchMenu:false});
   host.changeMainAPI('openai');
   Object.assign(o.oai_settings,{chat_completion_source:'custom',custom_model:'qa-model',custom_url:'http://127.0.0.1:18749/mock/v1',stream_openai:false,openai_max_context:16000,openai_max_tokens:100,squash_system_messages:false,wi_format:'{0}'});
   host.setOnlineStatus('qa-model');
   const ctx=window.SillyTavern.getContext();
   const char=ctx.characters[ctx.characterId];
   if(char?.data?.extensions)char.data.extensions.world='';
   const name='Synthetic_Inclusion_QA',book={entries:{}};
   const add=(comment,content,position,extra={})=>Object.assign(wi.createWorldInfoEntry(name,book),{comment,content,position,constant:true,disable:false,order:100,depth:0,role:0,probability:100,useProbability:false,...extra});
   add('Disabled preset lore','QA_DECOY_DISABLED_45F',0);
   add('After lore','QA_REAL_AFTER_45F',1);
   add('Depth lore','QA_REAL_DEPTH_45F',4);
   add('Used outlet','QA_REAL_OUTLET_45F',7,{outletName:'qa-used'});
   add('Unused outlet','QA_DECOY_OUTLET_45F',7,{outletName:'qa-unused'});
   add('Inactive lore','QA_INACTIVE_45F',1,{constant:false,key:['NEVER_MATCH_45F']});
   await wi.saveWorldInfo(name,book,true);await wi.updateWorldInfoList();
   wi.updateWorldInfoSettings({world_info_budget:100,world_info_budget_cap:0,world_info_recursive:false,world_info_depth:2,world_info_min_activations:0},[name]);
   const pm=o.promptManager;
   const before=pm.getPromptOrderEntry(pm.activeCharacter,'worldInfoBefore'),after=pm.getPromptOrderEntry(pm.activeCharacter,'worldInfoAfter'),main=pm.getPromptOrderEntry(pm.activeCharacter,'main');
   if(!before||!after||!main)throw Error('missing default prompt order');
   before.enabled=false;after.enabled=true;main.enabled=true;
   Object.assign(pm.getPromptById('main'),{content:'Synthetic main prompt.\n{{outlet::qa-used}}',injection_position:0,injection_trigger:[]});
   window.QA={host,o,pm,done:false,error:null,nativeFrom:o.Message.fromPromptAsync,original:{preparePrompt:pm.preparePrompt,getPromptCollection:pm.getPromptCollection,setChatCompletion:pm.setChatCompletion}};
   return {chatId:ctx.getCurrentChatId(),api:ctx.mainApi,character:char?.name,entries:Object.values(book.entries).map(e=>[e.uid,e.comment])};
  });
  console.log('Synthetic fixture',JSON.stringify(setup));
  assert.equal(setup.api,'openai');assert.ok(setup.chatId);
  async function generate(squashed){
   releaseResponse=null;
   const previous=requests.length;
   await page.evaluate(squashed=>{
    const q=window.QA;q.done=false;q.error=null;q.o.oai_settings.squash_system_messages=squashed;
    document.getElementById('send_textarea').value='Decoy chat text: QA_DECOY_DISABLED_45F and QA_DECOY_OUTLET_45F.';
    void q.host.Generate('normal').then(()=>q.done=true).catch(e=>{q.error=String(e);q.done=true;});
   },squashed);
   for(let i=0;i<300&&requests.length===previous;i++){await sleep(100);const q=await page.evaluate(()=>({done:window.QA.done,error:window.QA.error}));if(q.done&&requests.length===previous)throw Error('generation ended before request: '+JSON.stringify(q));}
   assert.equal(requests.length,previous+1,'expected exactly one mocked RP request');
   const req=requests.at(-1);
   const joined=req.messages.map(m=>typeof m.content==='string'?m.content:'').join('\n');
   for(const s of ['QA_REAL_AFTER_45F','QA_REAL_DEPTH_45F','QA_REAL_OUTLET_45F'])assert.ok(joined.includes(s),'host must actually send '+s);
   assert.ok(!joined.includes('QA_INACTIVE_45F'));
   assert.ok(req.messages.some(m=>m.role==='user'&&m.content.includes('QA_DECOY_DISABLED_45F')));
   const result=await page.evaluate(async()=>{
    const ctx=window.SillyTavern.getContext(),q=window.QA;
    const slash=await ctx.executeSlashCommandsWithOptions('/wi-triggered');
    const displayed=JSON.parse(slash.pipe).filter(e=>e.world==='Synthetic_Inclusion_QA').map(e=>e.comment);
    const restored=Object.entries(q.original).every(([k,v])=>q.pm[k]===v)&&q.o.Message.fromPromptAsync===q.nativeFrom;
    window.STWII.loreInsight.open();
    const dialog=document.querySelector('.stwii--insight-overlay');
    const detail=key=>dialog.querySelector('details[data-insight-section="'+key+'"]');
    const before=[...dialog.querySelectorAll('.stwii--insight-entry')].length;
    const section=detail('matched');
    section.open=true;
    await new Promise(r=>setTimeout(r,60));
    const titles=[...section.querySelectorAll('.stwii--insight-entry-name')].map(e=>e.textContent);
    const row=section.querySelector('.stwii--insight-entry');
    const term=row?.querySelector('.stwii--insight-term:not(.stwii--insight-reason-icon)');
    term?.click();
    const help=row?.querySelector('.stwii--insight-term-help');
    const diagnosticCounts=Object.fromEntries(['excluded','unresolved','nonactivated'].map(k=>[k,detail(k)?.querySelector('summary')?.textContent??null]));
    window.QA.row=row;window.QA.help=help;window.QA.section=section;
    return {displayed,titles,restored,before,helpVisible:!!help&&!help.hidden,diagnosticCounts,dialogWidth:dialog.getBoundingClientRect().width};
   });
   console.log('Host inclusion',JSON.stringify({squashed,result,messages:req.messages.map(m=>({role:m.role,qa:(typeof m.content==='string'?m.content:'').match(/QA_[A-Z_]+45F/g)}))}));
   const expected=['After lore','Depth lore','Used outlet'];
   for(const title of expected){assert.ok(result.displayed.includes(title),'book list missing '+title);assert.ok(result.titles.includes(title),'insight missing '+title);}
   assert.deepEqual(result.displayed.sort(),expected.sort());
   assert.ok(!result.titles.includes('Disabled preset lore')&&!result.titles.includes('Unused outlet')&&!result.titles.includes('Inactive lore'));
   assert.equal(result.restored,true);assert.equal(result.before,0);assert.equal(result.helpVisible,true);
   await page.waitForFunction(()=>!document.querySelector('.stwii--insight-status')?.textContent?.includes('Estimating'),null,{timeout:20000});
   assert.equal(await page.evaluate(()=>window.QA.section.contains(window.QA.row)&&!window.QA.help.hidden),true,'token update preserves row and help');
   await page.evaluate(()=>window.STWII.loreInsight.close());
   releaseResponse();
   await page.waitForFunction(()=>window.QA.done,null,{timeout:20000});
   assert.equal(await page.evaluate(()=>window.QA.error),null);
  }
  await generate(false);
  await page.setViewportSize({width:390,height:844});
  await generate(true);
  // Real host with a custom absolute main, plus a conditional macro-bearing
  // extension in another native depth group. Same lore must be proven;
  // inactive or unused-outlet decoys must still stay out.
  await page.evaluate(()=>{
   const q=window.QA;
   Object.assign(q.pm.getPromptById('main'),{injection_position:1,injection_depth:1,injection_order:100});
   q.host.setExtensionPrompt('qa_opaque_other','Other prompt for {{user}}',1,3,false,2,()=>true);
  });
  await generate(false);
  await generate(true);
  console.log('Host QA browser errors',JSON.stringify(errors));
  assert.equal(errors.length,0);
  failed=false;
 }catch(e){
  console.log('Browser diagnostic',JSON.stringify({errors,consoleTail,view:page?await page.evaluate(()=>({ready:document.readyState,context:!!window.SillyTavern?.getContext,chars:window.SillyTavern?.getContext?.().characters?.length,wii:!!window.STWII?.loreInsight,body:document.body.innerText.slice(0,700)})).catch(()=>null):null}));
  if(fs.existsSync(path.join(tmp,'server.log')))console.log('Server log tail',fs.readFileSync(path.join(tmp,'server.log'),'utf8').split('\n').slice(-30).join('\n'));
  throw e;
 }
 finally{if(browser)await browser.close().catch(()=>{});if(server)server.kill();if(log!==undefined)fs.closeSync(log);if(!failed)fs.rmSync(tmp,{recursive:true,force:true});}
});
