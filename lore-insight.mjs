// Lore Insight: bounded, session-only capture from existing visible RP hooks.
// No AI request, polling, storage, or lorebook reload.
const MAX_ROWS = 256;
const MAX_CHARS = 524288;
const MAX_MEASURE = 64;
const MAX_CACHE_CHARS = 1048576;
const normalize = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const validCount = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function createInsightCapture(serial, chatId, observed) {
    let chars = 0;
    const capture = {
        serial, chatId, observed, rows: [], parts: null, prompt: null, truncated: false,
        setPrompt(parts, normalized) {
            if (!Array.isArray(parts) || parts.length > 4096 ||
                parts.reduce((n,p)=>n+p.length+1,0)>MAX_CHARS || normalized.length>MAX_CHARS) return;
            capture.parts = parts.slice();
            capture.prompt = normalized || null;
        },
        add(entry, rendered) {
            if (capture.rows.length >= MAX_ROWS || chars + rendered.length > MAX_CHARS) {
                capture.truncated = true; return;
            }
            chars += rendered.length;
            capture.rows.push({entry,text:rendered});
        },
    };
    return capture;
}

// A string match is evidence only; duplicate or overlapping text is ambiguous.
export function inspectInsight(capture) {
    const rows=[], spans=[], ids=new Set(), prompt=capture.prompt;
    for (const {entry,text} of capture.rows) {
        const id=JSON.stringify([entry.world,entry.uid]);
        if (ids.has(id)) continue;
        ids.add(id);
        const needle=normalize(text), row={entry,text,status:'unknown',tokens:null};
        rows.push(row);
        if (!prompt || !needle) continue;
        const start=prompt.indexOf(needle);
        if (start<0) {row.status='unmatched';continue;}
        const again=prompt.indexOf(needle,start+1);
        row.status=again<0?'matched':'ambiguous';
        spans.push({start,end:start+needle.length,row});
        if (again>=0) spans.push({start:again,end:again+needle.length,row});
    }
    spans.sort((a,b)=>a.start-b.start||b.end-a.end);
    for(let i=0;i<spans.length;i++) {
        for(let j=i+1;j<spans.length&&spans[j].start<spans[i].end;j++) {
            spans[i].row.status='ambiguous';spans[j].row.status='ambiguous';
        }
    }
    // When a repeated longer string contains a shorter candidate, the shorter
    // candidate cannot be attributed even if it matches only once.
    const repeated=rows.filter(r=>r.status==='ambiguous').map(r=>normalize(r.text));
    for(const row of rows) {
        if(row.status==='matched' && repeated.some(s=>s.includes(normalize(row.text)))) row.status='ambiguous';
    }
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
    let cache=new Map(),identity=null,chars=0;
    function clear(){cache=new Map();identity=null;chars=0;}
    async function countText(text) {
        if(typeof text!=='string')return null;
        if(!text)return 0;
        let scope=null;try{scope=getScope();}catch{}
        if(scope!==identity){clear();identity=scope;}
        const call=async()=>{
            try{const n=await count(text);return validCount(n)&&n>0?Math.round(n):null;}catch{return null;}
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

export async function estimateInsight(rows,capture,countText,stillCurrent,allVisible){
    const matched=rows.filter(r=>r.status==='matched');
    const result={total:null,prompt:null,limited:matched.length>MAX_MEASURE};
    if(!stillCurrent())return null;
    const combined=matched.map(r=>r.text).join('\n');
    if(combined.length<=MAX_CHARS&&!capture.truncated){
        result.total=await countText(combined);
        if(!stillCurrent())return null;
    }else result.limited=true;
    // These individual estimates use the same trailing newline as STLO's
    // existing budget counter. They are NOT the combined estimate.
    for(const row of matched.slice(0,MAX_MEASURE)){
        if(!stillCurrent())return null;
        row.tokens=await countText(row.text+'\n');
    }
    if(!stillCurrent())return null;
    if(allVisible&&capture.parts&&!capture.truncated)result.prompt=await countText(capture.parts.join('\n'));
    return stillCurrent()?result:null;
}

export function createLoreInsight({t,countText,getScope,getChatId,getReason,titleFor,isVisible,reasonLabel}){
    let latest=null,available=false,waiting=false,current=null;
    function close(){
        const old=current;if(!old)return;
        current=null;old.overlay.close();old.overlay.remove();
        if(old.previousFocus?.isConnected)old.previousFocus.focus?.();
    }
    function clear(){close();latest=null;available=false;waiting=false;}
    function start(){clear();waiting=true;}
    function finish(capture,complete){
        if(!capture||capture.chatId!==getChatId())return;
        if(capture.observed===null&&!complete)return;
        latest=capture;
    }
    function ready(){waiting=false;available=!!latest;if(current)open();}
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
        const capture=latest,view=current;
        const allRows=inspectInsight(capture),rows=allRows.filter(r=>isVisible(r.entry.world));
        const allVisible=rows.length===allRows.length;
        for(const row of rows)row.reason=getReason(row.entry);
        const tokenButton=element('button','menu_button stwii--insight-measure',t('insight.measure'));
        tokenButton.type='button';
        let measurement=null,busy=false,attempted=false;
        const report=element('div','stwii--insight-report');
        body.append(element('p','stwii--insight-note',t('insight.note')),tokenButton,report);
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
            if(capture.truncated||measurement?.limited)report.append(element('p','stwii--insight-note',t('insight.limit')));
            report.append(groupSection(t('insight.books'),r=>String(r.entry.world??''),s=>s),
                groupSection(t('insight.reasons'),r=>r.reason,reasonLabel));
            const detail=element('section','stwii--insight-section');
            detail.append(element('h4','',t('insight.entries')));
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
        paint();
        tokenButton.addEventListener('click',async()=>{
            if(busy||attempted||!rows.length)return;
            busy=true;attempted=true;tokenButton.disabled=true;tokenButton.textContent=t('insight.counting');
            let scope=null;try{scope=getScope();}catch{}
            const stillCurrent=()=>current===view&&latest===capture&&getChatId()===capture.chatId&&!waiting&&getScope()===scope;
            try{
                measurement=await estimateInsight(rows,capture,countText,stillCurrent,allVisible);
                if(!measurement){for(const row of rows)row.tokens=null;attempted=false;}
            }catch{for(const row of rows)row.tokens=null;attempted=false;}
            finally{
                if(current===view){
                    busy=false;if(measurement?.total===null&&rows.some(r=>r.status==='matched'))attempted=false;
                    tokenButton.disabled=attempted;tokenButton.textContent=t(attempted?'insight.measured':'insight.measure');paint();
                }
            }
        });
        tokenButton.disabled=!rows.some(r=>r.status==='matched');
    }
    return {start,clear,ready,close,open,finish,beginCapture:createInsightCapture};
}
