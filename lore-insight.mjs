// Lore Insight: bounded, session-only capture from existing visible RP hooks.
// No AI request, polling, storage, or lorebook reload.
const MAX_ROWS = 256;
const MAX_CHARS = 524288;
const MAX_MEASURE = 64;
const MAX_CACHE_CHARS = 1048576;
const normalize = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const validCount = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function boundedParts(parts) {
    if (!Array.isArray(parts) || parts.length > 4096) return null;
    let size=0;
    for (const part of parts) {
        if (typeof part!=='string' || (size+=part.length+1)>MAX_CHARS) return null;
    }
    return parts.slice();
}

export function createInsightCapture(serial,chatId,observed,scope=null) {
    let chars=0;
    const capture={
        serial,chatId,observed,scope,rows:[],parts:null,source:'assembled',promptLimited:false,truncated:false,measurement:null,
        setPrompt(parts,_normalized,source='assembled') {
            capture.source=source;
            capture.parts=boundedParts(parts);
            capture.promptLimited=capture.parts===null;
            capture.measurement=null;
        },
        add(entry,rendered) {
            if(typeof rendered!=='string')rendered='';
            if(capture.rows.length>=MAX_ROWS||chars+rendered.length>MAX_CHARS){capture.truncated=true;return;}
            chars+=rendered.length;
            capture.rows.push({entry,text:rendered});
        },
    };
    return capture;
}

// ST 1.19.1 preserves message identities when it filters the assembled array.
// Require type and ordered identity evidence, not the next arbitrary AI call.
export function createRequestMatcher(messages,type) {
    const known=new WeakMap();
    let count=0;
    if(Array.isArray(messages)&&messages.length<=4096&&typeof type==='string'){
        for(const msg of messages)if(msg&&typeof msg==='object'&&!known.has(msg))known.set(msg,count++);
    }
    return data=>{
        if(!count||data?.type!==type||!Array.isArray(data.messages)||data.messages.length>4096)return false;
        let last=-1,matches=0;
        for(const msg of data.messages){
            if(!msg||typeof msg!=='object'||!known.has(msg))continue;
            const index=known.get(msg);
            if(index<=last)return false;
            last=index;matches++;
        }
        return matches>=Math.ceil(count/2);
    };
}

// Never capture request parameters, credentials or binary attachments.
export function requestTextParts(messages) {
    if(!Array.isArray(messages)||messages.length>4096)return null;
    const parts=[];let size=0;
    function add(s){
        if(typeof s!=='string')return true;
        if(parts.length>=4096||(size+=s.length+1)>MAX_CHARS)return false;
        parts.push(s);return true;
    }
    for(const message of messages){
        const content=message?.content;
        if(typeof content==='string'){if(!add(content))return null;}
        else if(Array.isArray(content)){
            if(content.length>4096)return null;
            for(const block of content)if((block?.type==='text'||block?.type==='input_text')&&!add(block.text))return null;
        }
    }
    return parts;
}

// Do not manufacture matches across message boundaries or double-count overlaps.
export function inspectInsight(capture) {
    const rows=[],spans=[],ids=new Map(),parts=(capture.parts??[]).map(normalize).filter(Boolean);
    for(const {entry,text} of capture.rows){
        const id=JSON.stringify([entry.world,entry.uid]);
        if(ids.has(id)){
            const existing=ids.get(id);
            if(existing.text!==text)existing.status='ambiguous';
            continue;
        }
        const needle=normalize(text),row={entry,text,status:'unknown',tokens:null};
        ids.set(id,row);rows.push(row);
        if(!parts.length||!needle)continue;
        let hits=0;
        for(let partIndex=0;partIndex<parts.length;partIndex++){
            const part=parts[partIndex],start=part.indexOf(needle);
            if(start<0)continue;
            hits++;spans.push({partIndex,start,end:start+needle.length,row});
            const again=part.indexOf(needle,start+1);
            if(again>=0){hits++;spans.push({partIndex,start:again,end:again+needle.length,row});}
            if(hits>=2)break;
        }
        row.status=hits===0?'unmatched':hits===1?'matched':'ambiguous';
    }
    spans.sort((a,b)=>a.partIndex-b.partIndex||a.start-b.start||b.end-a.end);
    for(let i=0;i<spans.length;i++)for(let j=i+1;j<spans.length&&spans[j].partIndex===spans[i].partIndex&&spans[j].start<spans[i].end;j++){
        spans[i].row.status='ambiguous';spans[j].row.status='ambiguous';
    }
    const repeated=rows.filter(r=>r.status==='ambiguous').map(r=>normalize(r.text));
    for(const row of rows)if(row.status==='matched'&&repeated.some(s=>s.includes(normalize(row.text))))row.status='ambiguous';
    return rows;
}

export function insightReason(entry,ev) {
    if(entry.stwiiJevRecall===true) return 'jev';
    const reasons=[];
    if(ev?.primary?.trim?.()||['AND_ANY','AND_ALL','NOT_ANY','NOT_ALL'].includes(ev?.logic)) reasons.push('keyword');
    if(ev?.vectorConfirmed===true) reasons.push('vector');
    if(ev?.logic==='CONSTANT') reasons.push('constant');
    if(ev?.logic==='STICKY') reasons.push('sticky');
    if(ev?.logic==='DECORATOR') reasons.push('decorator');
    if(['FORCE_ACTIVATE','EXTERNAL'].includes(ev?.logic)&&!ev?.vectorConfirmed) reasons.push('external');
    return reasons.length>1?'multiple':reasons[0]??'unknown';
}

export function canShowInsightWorld(world,admin,handle) {
    if(admin) return true;
    const name=typeof world==='string'?world.trim():'';
    if(name==='9Z Universal Commands') return true;
    const owner=name.match(/^Z-([^\s-]+)(?:-|$)/)?.[1];
    if(owner) return owner===String(handle??'').trim();
    return !name.startsWith('9Z');
}

// A single bounded cache for identical string/tokenizer/chat/generation inputs.
// Unknown tokenizer identity bypasses cache; failures do not persist.
export function createInsightTokenCache(count,getScope) {
    let cache=new Map(),identity=null,chars=0,epoch=0;
    function clear(){cache=new Map();identity=null;chars=0;epoch++;}
    async function countText(text) {
        if(typeof text!=='string')return null;
        if(!text)return 0;
        let scope=null;try{scope=getScope();}catch{}
        if(scope!==identity){clear();identity=scope;}
        const run=epoch;
        const call=async()=>{
            try{const n=await count(text);return run===epoch&&scope===getScope()&&validCount(n)&&n>0?Math.round(n):null;}catch{return null;}
        };
        if(!scope||text.length>MAX_CACHE_CHARS)return call();
        if(cache.has(text))return cache.get(text);
        while(cache.size&&(cache.size>=MAX_ROWS+8||chars+text.length>MAX_CACHE_CHARS)){
            const oldest=cache.keys().next().value;chars-=oldest.length;cache.delete(oldest);
        }
        const target=cache, pending=call();
        target.set(text,pending);chars+=text.length;
        const n=await pending;
        if(target===cache&&target.get(text)===pending&&n===null){target.delete(text);chars-=text.length;}
        return n;
    }
    return {clear,countText};
}

export async function estimateInsight(rows,capture,countText,stillCurrent,allVisible,previous=null){
    const matched=rows.filter(r=>r.status==='matched');
    const result={total:previous?.total??null,prompt:previous?.prompt??null,limited:matched.length>MAX_MEASURE,failed:false};
    if(!stillCurrent())return null;
    const combined=matched.map(r=>r.text).join('\n');
    if(matched.length&&combined.length<=MAX_CHARS&&!capture.truncated&&!capture.promptLimited){
        if(!validCount(result.total))result.total=await countText(combined);
        if(!stillCurrent())return null;
        if(!validCount(result.total))result.failed=true;
    }else result.limited ||= capture.truncated||capture.promptLimited||combined.length>MAX_CHARS;
    for(const row of matched.slice(0,MAX_MEASURE)){
        if(!stillCurrent())return null;
        if(!validCount(row.tokens))row.tokens=await countText(row.text+'\n');
        if(!validCount(row.tokens))result.failed=true;
    }
    if(!stillCurrent())return null;
    if(allVisible&&capture.parts?.length&&!capture.truncated&&!capture.promptLimited){
        if(!validCount(result.prompt))result.prompt=await countText(capture.parts.join('\n'));
        if(!validCount(result.prompt))result.failed=true;
    }
    return stillCurrent()?result:null;
}

export function createLoreInsight({t,countText,getScope,getChatId,getReason,titleFor,isVisible,reasonLabel,watchRequest}){
    let latest=null,available=false,waiting=false,current=null,releaseRequest=null;
    const readScope=()=>{try{return getScope();}catch{return null;}};
    function stopWatching(){const release=releaseRequest;releaseRequest=null;try{release?.();}catch{}}
    function beginCapture(serial,chatId,observed){return createInsightCapture(serial,chatId,observed,readScope());}
    function close(){
        const old=current;if(!old)return;
        current=null;old.overlay.close();old.overlay.remove();
        if(old.previousFocus?.isConnected)old.previousFocus.focus?.();
    }
    function clear(){stopWatching();close();latest=null;available=false;waiting=false;}
    function start(){clear();waiting=true;}
    function finish(capture,complete,requestInfo){
        if(!capture||capture.chatId!==getChatId())return;
        if(capture.observed===null&&!complete)return;
        latest=capture;
        if(!requestInfo||typeof watchRequest!=='function')return;
        const matches=createRequestMatcher(requestInfo.messages,requestInfo.type);
        try{
            releaseRequest=watchRequest(data=>{
                if(!waiting||latest!==capture||capture.chatId!==getChatId())return;
                try{
                    if(!matches(data))return;
                    capture.setPrompt(requestTextParts(data.messages),null,'request');
                    capture.scope=readScope();
                    stopWatching();
                }catch{stopWatching();}
            });
        }catch{stopWatching();}
    }
    function ready(){stopWatching();waiting=false;available=!!latest;if(current){try{open();}catch{close();}}}
    function element(tag,cls,text){
        const node=document.createElement(tag);
        if(cls)node.className=cls;
        if(text!==undefined)node.textContent=text;
        return node;
    }
    const formatted=n=>validCount(n)?'~'+n.toLocaleString()+' T':t('insight.unmeasured');
    function open(){
        close();
        const previousFocus=document.activeElement;
        const overlay=element('dialog','stwii--reader-overlay stwii--insight-overlay');
        overlay.setAttribute('aria-label',t('insight.title'));
        const dialog=element('section','stwii--reader-dialog stwii--insight-dialog');
        const header=element('header','stwii--reader-header stwii--insight-header');
        const title=element('h3','stwii--insight-title',t('insight.title'));
        const x=element('button','stwii--reader-close','×');x.type='button';x.setAttribute('aria-label',t('reader.close'));
        header.append(title,x);
        const body=element('div','stwii--insight-body');
        dialog.append(header,body);overlay.append(dialog);current={overlay,previousFocus};
        x.addEventListener('click',close);
        overlay.addEventListener('cancel',e=>{e.preventDefault();close();});
        overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
        document.body.append(overlay);overlay.showModal();x.focus();
        if(waiting||!available||!latest||latest.chatId!==getChatId()){
            body.append(element('p','stwii--insight-note',t(waiting?'insight.waiting':'insight.empty')));return;
        }
        const capture=latest,view=current,scope=readScope();
        const allRows=inspectInsight(capture),rows=allRows.filter(r=>isVisible(r.entry.world));
        const allVisible=rows.length===allRows.length,sameScope=scope!==null&&capture.scope===scope;
        const visibility=JSON.stringify(rows.map(r=>[r.entry.world,r.entry.uid]));
        const saved=sameScope&&capture.measurement?.scope===scope&&capture.measurement?.visibility===visibility?capture.measurement:null;
        for(const row of rows){
            row.reason=getReason(row.entry);
            row.tokens=saved?.tokens.get(JSON.stringify([row.entry.world,row.entry.uid]))??null;
        }
        const tokenButton=element('button','menu_button stwii--insight-measure',t('insight.measure'));
        tokenButton.type='button';
        let measurement=saved?.result??null,busy=false;
        const report=element('div','stwii--insight-report');
        body.append(element('div','stwii--insight-source',t('insight.source.'+capture.source)),element('p','stwii--insight-note',t('insight.note')),tokenButton,report);
        if(!sameScope)body.append(element('p','stwii--insight-note',t('insight.scopeChanged')));
        function card(label,value){
            const node=element('div','stwii--insight-card');
            node.append(element('small','',label),element('strong','',value));return node;
        }
        function groupSection(label,key,display){
            const section=element('section','stwii--insight-section');
            section.append(element('h4','',label));
            const groups=new Map();
            for(const row of rows){
                const k=key(row);
                if(!groups.has(k))groups.set(k,{count:0,matched:0,measured:0,tokens:0});
                const g=groups.get(k);g.count++;
                if(row.status==='matched'){
                    g.matched++;if(validCount(row.tokens)){g.tokens+=row.tokens;g.measured++;}
                }
            }
            for(const [k,g] of groups){
                const value=g.matched===0?'—':g.matched===g.measured?formatted(g.tokens):t('insight.unmeasured');
                const line=element('div','stwii--insight-line');
                line.append(element('span','',display(k)),element('small','',g.matched+' / '+g.count),element('strong','',value));
                section.append(line);
            }
            return section;
        }
        function paint(){
            const expanded=report.querySelector('details')?.open??false;
            report.replaceChildren();
            const grid=element('div','stwii--insight-grid');
            const matched=rows.filter(r=>r.status==='matched').length;
            grid.append(card(t('insight.activated'),String(rows.length)+(capture.truncated?'+':'')),
                card(t('insight.matched'),String(matched)),card(t('insight.unresolved'),String(rows.length-matched)),
                card(t('insight.total'),formatted(measurement?.total)));
            report.append(grid);
            const ratio=measurement?.prompt>0&&validCount(measurement.total)&&measurement.total<=measurement.prompt
                ?'~'+(100*measurement.total/measurement.prompt).toFixed(1)+'%':t('insight.unmeasured');
            report.append(card(t('insight.share'),ratio));
            if(!allVisible)report.append(element('p','stwii--insight-note',t('insight.visible')));
            if(capture.truncated||capture.promptLimited||measurement?.limited)report.append(element('p','stwii--insight-note',t('insight.limit')));
            report.append(groupSection(t('insight.books'),r=>String(r.entry.world??''),s=>s),
                groupSection(t('insight.reasons'),r=>r.reason,reasonLabel));
            const detail=element('details','stwii--insight-section stwii--insight-details');
            detail.open=expanded;
            detail.append(element('summary','',t('insight.entries')+' · '+rows.length));
            for(const row of rows){
                const line=element('div','stwii--insight-entry');
                let name=String(row.entry.uid??'');try{name=titleFor(row.entry)||name;}catch{}
                line.append(element('strong','',name),
                    element('small','',String(row.entry.world??'')+' · '+reasonLabel(row.reason)+' · '+t('insight.'+row.status)),
                    element('span','',formatted(row.tokens)));
                detail.append(line);
            }
            report.append(detail);
        }
        function updateButton(){
            const hasMatch=rows.some(r=>r.status==='matched'),complete=measurement&&!measurement.failed;
            tokenButton.disabled=busy||!sameScope||!hasMatch||!!complete;
            tokenButton.textContent=t(busy?'insight.counting':complete?'insight.measured':measurement?.failed?'insight.retry':'insight.measure');
        }
        paint();updateButton();
        tokenButton.addEventListener('click',async()=>{
            if(busy||!sameScope||!rows.some(r=>r.status==='matched'))return;
            busy=true;updateButton();
            const stillCurrent=()=>current===view&&latest===capture&&getChatId()===capture.chatId&&!waiting&&readScope()===scope;
            try{
                const result=await estimateInsight(rows,capture,countText,stillCurrent,allVisible,measurement);
                if(result&&stillCurrent()){
                    measurement=result;
                    capture.measurement={scope,visibility,result,tokens:new Map(rows.map(r=>[JSON.stringify([r.entry.world,r.entry.uid]),r.tokens]))};
                }else if(current===view){
                    measurement=null;capture.measurement=null;for(const row of rows)row.tokens=null;
                }
            }catch{
                if(current===view){measurement={total:null,prompt:null,failed:true};for(const row of rows)row.tokens=null;}
            }finally{if(current===view){busy=false;updateButton();paint();}}
        });
    }
    return {start,clear,ready,close,open,finish,beginCapture};
}
