import { connectStloMetrics, metricsKey, buildStructuredProof, confirmStructuredProof, buildInjectionRecords } from './stlo-metrics-link.mjs';
import { buildTraceEvidence } from './prompt-inclusion.mjs';

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
        proven:new Map(),excluded:new Map(),inspection:null,requestProofChecked:false,
        setPrompt(parts,_normalized,source='assembled') {
            capture.source=source;
            capture.parts=boundedParts(parts);
            capture.promptLimited=capture.parts===null;
            capture.measurement=null;capture.inspection=null;capture.proven=new Map();capture.excluded=new Map();capture.requestProofChecked=false;
        },
        add(entry,rendered,outlet=false) {
            if(typeof rendered!=='string')rendered='';
            if(capture.rows.length>=MAX_ROWS||chars+rendered.length>MAX_CHARS){capture.truncated=true;return;}
            chars+=rendered.length;
            capture.rows.push({entry,text:rendered,outlet});
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

// Match within a message; duplicate or overlapping strings are ambiguous.
// For outlets only, try the exact captured raw body if rendered text is absent.
export function inspectInsight(capture) {
    const rows=[],spans=[],ids=new Map(),parts=(capture.parts??[]).map(normalize).filter(Boolean);
    function locate(needle,row){
        let hits=0;
        for(let partIndex=0;partIndex<parts.length;partIndex++){
            const part=parts[partIndex],start=part.indexOf(needle);
            if(start<0)continue;
            hits++;spans.push({partIndex,start,end:start+needle.length,row});
            const again=part.indexOf(needle,start+1);
            if(again>=0){hits++;spans.push({partIndex,start:again,end:again+needle.length,row});}
            if(hits>=2)break;
        }
        return hits;
    }
    for(const {entry,text,outlet=false} of capture.rows){
        const id=JSON.stringify([entry.world,entry.uid]);
        if(ids.has(id)){
            const existing=ids.get(id);
            if(existing.originalText!==text)existing.status='ambiguous';
            continue;
        }
        const needle=normalize(text),row={entry,text,originalText:text,outlet,status:'unknown',tokens:null};
        ids.set(id,row);rows.push(row);
        if(!parts.length||!needle)continue;
        let hits=locate(needle,row);
        if(!hits&&outlet&&typeof entry.content==='string'){
            const raw=entry.content.trim(),rawNeedle=normalize(raw);
            if(rawNeedle&&rawNeedle!==needle){
                hits=locate(rawNeedle,row);
                if(hits)row.text=raw;
            }
        }
        row.status=hits===0?'unmatched':hits===1?'matched':'ambiguous';
    }
    spans.sort((a,b)=>a.partIndex-b.partIndex||a.start-b.start||b.end-a.end);
    for(let i=0;i<spans.length;i++)for(let j=i+1;j<spans.length&&spans[j].partIndex===spans[i].partIndex&&spans[j].start<spans[i].end;j++){
        spans[i].row.status='ambiguous';spans[j].row.status='ambiguous';
    }
    const repeated=rows.filter(r=>r.status==='ambiguous').map(r=>normalize(r.text));
    for(const row of rows)if(row.status==='matched'&&repeated.some(s=>s.includes(normalize(row.text))))row.status='ambiguous';
    // Dedicated host blocks establish provenance even if identical text occurs
    // elsewhere. The evidence publisher never uses ordinary substring matches.
    for(const row of rows){
        const id=metricsKey(row.entry),proven=capture.proven?.get(id);
        const original=normalize(row.originalText);
        row.sourceVerified=capture.source==='request'&&!!original&&
            typeof proven==='string'&&proven===row.originalText+'\n'&&
            (capture.promptLimited?capture.requestProofChecked===true:parts.some(part=>part.includes(original)));
        if(row.sourceVerified){row.status='matched';row.text=row.originalText;}
        else if(capture.excluded?.has(id)){row.status='excluded';row.exclusion=capture.excluded.get(id);}
    }
    return rows;
}

export function getInsightRows(capture){
    if(!capture)return [];
    return capture.inspection??(capture.inspection=inspectInsight(capture));
}
export function verifiedInsightRows(capture){
    if(capture?.source!=='request'||capture.promptLimited&&capture.requestProofChecked!==true)return [];
    if(capture.inspection)return capture.inspection.filter(row=>row.sourceVerified);
    const result=[],seen=new Set();
    // Check only structurally proven rows, never run diagnostic searches here.
    // One normalization of the final request, bounded by the existing capture.
    const parts=(capture.parts??[]).map(normalize).filter(Boolean);
    for(const row of capture.rows){
        const id=metricsKey(row.entry);
        if(seen.has(id))continue;
        seen.add(id);
        if(capture.proven?.get(id)!==row.text+'\n')continue;
        const body=normalize(row.text);
        if(body&&(capture.promptLimited?capture.requestProofChecked===true:parts.some(part=>part.includes(body))))
            result.push({...row,sourceVerified:true,status:'matched',tokens:null});
    }
    return result;
}
export function hasCompleteEvidence(capture){
    if(capture?.source!=='request'||capture.truncated||capture.promptLimited&&capture.requestProofChecked!==true)return false;
    const ids=new Set(),verified=new Set(verifiedInsightRows(capture).map(row=>metricsKey(row.entry)));
    for(const row of capture.rows){
        const id=metricsKey(row.entry);
        if(ids.has(id))return false;ids.add(id);
        if(!verified.has(id)&&!capture.excluded?.has(id))return false;
    }
    return true;
}

export function insightReasonCodes(entry,ev) {
    if(entry.stwiiJevRecall===true) return ['jev'];
    const reasons=[];
    if(ev?.primary?.trim?.()||['AND_ANY','AND_ALL','NOT_ANY','NOT_ALL'].includes(ev?.logic)) reasons.push('keyword');
    if(ev?.vectorConfirmed===true) reasons.push('vector');
    if(ev?.logic==='CONSTANT') reasons.push('constant');
    if(ev?.logic==='STICKY') reasons.push('sticky');
    if(ev?.logic==='DECORATOR') reasons.push('decorator');
    if(['FORCE_ACTIVATE','EXTERNAL'].includes(ev?.logic)&&!ev?.vectorConfirmed) reasons.push('external');
    return reasons.length?reasons:['unknown'];
}
export function insightReason(entry,ev){
    const reasons=insightReasonCodes(entry,ev);
    return reasons.length>1?'multiple':reasons[0];
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

export async function estimateInsight(rows,capture,countText,stillCurrent,allVisible,previous=null,countEntry=null){
    const matched=rows.filter(r=>r.sourceVerified===true);
    const result={total:previous?.total??null,prompt:previous?.prompt??null,limited:matched.length>MAX_MEASURE||capture.truncated||capture.promptLimited,failed:false};
    if(!stillCurrent())return null;
    const combined=matched.map(r=>r.text).join('\n');
    if(matched.length&&combined.length<=MAX_CHARS&&!capture.truncated&&(!capture.promptLimited||capture.requestProofChecked===true)){
        if(!validCount(result.total))result.total=await countText(combined);
        if(!stillCurrent())return null;
        if(!validCount(result.total))result.failed=true;
    }else result.limited ||= capture.truncated||capture.promptLimited||combined.length>MAX_CHARS;
    for(const row of matched.slice(0,MAX_MEASURE)){
        if(!stillCurrent())return null;
        if(!validCount(row.tokens))row.tokens=await (countEntry?countEntry(row.entry,row.text+'\n',stillCurrent):countText(row.text+'\n'));
        if(!validCount(row.tokens))result.failed=true;
    }
    if(!stillCurrent())return null;
    if(allVisible&&capture.parts?.length&&!capture.truncated&&!capture.promptLimited){
        if(!validCount(result.prompt))result.prompt=await countText(capture.parts.join('\n'));
        if(!validCount(result.prompt))result.failed=true;
    }
    return stillCurrent()?result:null;
}

export function createLoreInsight({t,countText,getScope,getChatId,getReason,titleFor,isVisible,reasonLabel,reasonIcons=()=>[],watchRequest,getMetricsBridge}){
    let latest=null,waiting=false,current=null,releaseRequest=null,finalizeCapture=null;
    const readScope=()=>{try{return getScope();}catch{return null;}};
    function stopWatching(){const release=releaseRequest;releaseRequest=null;try{release?.();}catch{}}
    function beginCapture(serial,chatId,observed){return createInsightCapture(serial,chatId,observed,readScope());}
    function publish(capture){
        if(latest!==capture||capture.source!=='request'||capture.chatId!==getChatId()||
            readScope()!==capture.scope||!capture.stlo?.live())return;
        const {records,complete}=buildInjectionRecords(capture,isVisible,capture.scanComplete);
        capture.stlo.publish(records,complete);
    }
    function selectionLabels(entry){
        if(!entry?.stwiiJevRecall||!latest||latest.chatId!==getChatId()||
            readScope()!==latest.scope||!isVisible(entry.world)||
            !latest.rows.some(row=>row.entry===entry))return [];
        const selected=latest.stlo?.selection(entry);
        if(!selected)return [];
        const labels=[];
        if(selected.source){
            const key='insight.jev.source.'+selected.source;labels.push({key,label:t(key)});
        }
        if(selected.score!==null)labels.push({key:'insight.jev.score',label:t('insight.jev.score',selected.score.toLocaleString(undefined,{maximumFractionDigits:3}))});
        if(selected.accepted)labels.push({key:'insight.jev.accepted',label:t('insight.jev.accepted')});
        return labels;
    }
    function selectionFor(entry){return selectionLabels(entry).map(item=>item.label).join(' · ');}
    function invalidate(view){
        if(!view)return;
        view.revision++;
        if(view.timer!==null){clearTimeout(view.timer);view.timer=null;}
    }
    function close(){
        const old=current;if(!old)return;
        current=null;invalidate(old);old.overlay.close();old.overlay.remove();
        if(old.previousFocus?.isConnected)old.previousFocus.focus?.();
    }
    function refresh(){
        if(current){try{render(current);}catch{close();}}
    }
    function clear(){stopWatching();finalizeCapture=null;close();latest=null;waiting=false;}
    function start(){stopWatching();finalizeCapture=null;latest=null;waiting=true;refresh();}
    function accept(capture){
        if(latest!==capture||capture.chatId!==getChatId())return;
        waiting=false;capture.inspection=null;
        const callback=finalizeCapture;finalizeCapture=null;
        try{callback?.(capture);}catch{}
        publish(capture);refresh();
    }
    function finish(capture,complete,requestInfo,onFinalized){
        stopWatching();finalizeCapture=null;
        if(!capture||capture.chatId!==getChatId()){waiting=false;refresh();return;}
        latest=capture;waiting=true;finalizeCapture=onFinalized;
        capture.scanComplete=complete;
        capture.stlo=connectStloMetrics(getMetricsBridge);
        if(capture.observed===null&&!complete){accept(capture);return;}
        if(requestInfo&&typeof watchRequest==='function'){
            const matches=createRequestMatcher(requestInfo.messages,requestInfo.type);
            const native=requestInfo.trace;
            const proofInfo=native?.messages?{...requestInfo,messages:native.messages}:requestInfo;
            const traced=buildTraceEvidence(capture,proofInfo,native);
            // The native trace and dedicated collections are independent evidence.
            // A partial trace must not suppress exact dedicated-block proof.
            const structural=[...traced.blocks,...buildStructuredProof(capture,proofInfo)];
            if(native?.messages){
                const origins=new Map(native.messages.map((message,i)=>[message,native.originals[i]]));
                for(const block of structural)block.message=origins.get(block.message);
            }
            const assembled=Array.isArray(requestInfo.messages)&&requestInfo.messages.length<=4096?
                requestInfo.messages.map(message=>({content:message?.content,role:message?.role,name:message?.name||''})):null;
            const correlated=new WeakSet();
            const remember=data=>{if(matches(data))correlated.add(data);};
            try{
                releaseRequest=watchRequest(data=>{
                    if(latest!==capture||capture.chatId!==getChatId()||
                        (!correlated.has(data)&&!matches(data)))return;
                    try{
                        capture.setPrompt(requestTextParts(data.messages),null,'request');
                        capture.scope=readScope();
                        {
                            capture.proven=confirmStructuredProof(structural,data.messages,correlated.has(data)?assembled:null);
                            capture.requestProofChecked=true;
                            const unchanged=assembled&&data.messages.length===assembled.length&&assembled.every((item,i)=>
                                data.messages[i]?.content===item.content&&data.messages[i].role===item.role&&(data.messages[i].name||'')===item.name);
                            capture.excluded=unchanged?traced.excluded:new Map();
                        }
                    }catch{}
                    stopWatching();accept(capture);
                },remember);
                if(typeof releaseRequest==='function')return;
            }catch{stopWatching();}
        }
        accept(capture);
    }
    function ready(){
        stopWatching();
        if(waiting){if(latest)accept(latest);else{waiting=false;refresh();}}
    }
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
        dialog.append(header,body);overlay.append(dialog);
        current={overlay,previousFocus,body,revision:0,timer:null,openTerms:new Map()};
        x.addEventListener('click',close);
        overlay.addEventListener('cancel',e=>{e.preventDefault();close();});
        overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
        document.body.append(overlay);overlay.showModal();x.focus();
        render(current);
    }
    function render(view){
        invalidate(view);
        const revision=view.revision,body=view.body;
        const expanded=new Set([...body.querySelectorAll('details[open]')].map(d=>d.dataset.insightSection));
        body.replaceChildren();
        if(waiting||!latest||latest.chatId!==getChatId()){
            body.append(element('p','stwii--insight-note',t(waiting?'insight.waiting':'insight.empty')));return;
        }
        const capture=latest,scope=readScope();
        const allRows=getInsightRows(capture),rows=allRows.filter(r=>isVisible(r.entry.world));
        const allVisible=rows.length===allRows.length,sameScope=scope!==null&&capture.scope===scope;
        const matched=verifiedInsightRows(capture).filter(r=>isVisible(r.entry.world));
        const matchedSet=new Set(matched),excluded=rows.filter(r=>r.status==='excluded'&&!matchedSet.has(r)),unresolved=rows.filter(r=>!matchedSet.has(r)&&r.status!=='excluded');
        const visibility=JSON.stringify(rows.map(r=>[r.entry.world,r.entry.uid]));
        const saved=sameScope&&capture.measurement?.scope===scope&&capture.measurement?.visibility===visibility?capture.measurement:null;
        for(const row of rows){
            row.reason=getReason(row.entry);
            row.tokens=saved?.tokens.get(JSON.stringify([row.entry.world,row.entry.uid]))??null;
        }
        let measurement=saved?.result??null,busy=false;
        const numberUpdates=[];
        const report=element('div','stwii--insight-report');
        const status=element('div','stwii--insight-status');status.setAttribute('aria-live','polite');
        const hint=element('details','stwii--insight-help');
        hint.dataset.insightSection='help';hint.open=expanded.has('help');
        hint.append(element('summary','',t('insight.help')),
            element('p','stwii--insight-note',t('insight.source.'+capture.source)),
            element('p','stwii--insight-note',t('insight.note')));
        body.append(report,status,hint);
        if(!sameScope)body.append(element('p','stwii--insight-note',t('insight.scopeChanged')));
        function card(label,value){
            const node=element('div','stwii--insight-card'),number=element('strong','',value());
            node.append(element('small','',label),number);
            numberUpdates.push(()=>{number.textContent=value();});
            return node;
        }
        function bar(fraction){
            const track=element('div','stwii--insight-bar');track.setAttribute('aria-hidden','true');
            const fill=element('div','stwii--insight-bar-fill');
            const update=()=>{const f=fraction();track.hidden=f===null;fill.style.width=(100*Math.min(1,Math.max(0,f??0))).toFixed(2)+'%';};
            track.append(fill);update();numberUpdates.push(update);return track;
        }
        function groupSection(label,key,display){
            const section=element('section','stwii--insight-section');
            section.append(element('h4','',label));
            const groups=new Map();
            for(const row of matched){
                const k=key(row);
                if(!groups.has(k))groups.set(k,[]);
                groups.get(k).push(row);
            }
            const sum=()=>matched.length&&matched.every(r=>validCount(r.tokens))?matched.reduce((n,r)=>n+r.tokens,0):0;
            for(const [k,group] of groups){
                const total=()=>group.every(r=>validCount(r.tokens))?group.reduce((n,r)=>n+r.tokens,0):null;
                const line=element('div','stwii--insight-line'),value=element('strong','',formatted(total()));
                line.append(element('span','',display(k)),element('small','',t('insight.count',group.length)),value);
                section.append(line);numberUpdates.push(()=>{value.textContent=formatted(total());});
                section.append(bar(()=>{const all=sum();return all>0&&total()!==null?total()/all:null;}));
            }
            if(!groups.size)section.append(element('p','stwii--insight-note',t('insight.noMatches')));
            return section;
        }
        function termControl(copy,id){
            const help=element('p','stwii--insight-term-help');
            help.hidden=true;
            const buttons=[];
            const selected=view.openTerms.get(id);
            function refreshTerms(key){
                if(key)view.openTerms.set(id,key);else view.openTerms.delete(id);
                help.hidden=!key;
                help.textContent=key?t('insight.explain.'+key):'';
                for(const item of buttons)item.button.setAttribute('aria-expanded',String(item.key===key));
            }
            function button(key,label,cls='',ariaLabel=label){
                const node=element('button','stwii--insight-term'+(cls?' '+cls:''),label);
                node.type='button';node.setAttribute('aria-label',ariaLabel);
                node.setAttribute('aria-expanded',String(selected===key));
                buttons.push({button:node,key});
                node.addEventListener('click',()=>refreshTerms(view.openTerms.get(id)===key?null:key));
                return node;
            }
            function finish(){copy.append(help);if(selected&&buttons.some(x=>x.key===selected))refreshTerms(selected);}
            return {button,finish};
        }
        function entrySection(label,key,list,verified,opened){
            const detail=element('details','stwii--insight-section stwii--insight-details');
            detail.dataset.insightSection=key;detail.open=opened.has(key);
            detail.append(element('summary','',t(label)+' · '+list.length));
            let built=false;
            function build(){
                if(built)return;built=true;
                for(const row of list){
                const line=element('div','stwii--insight-entry');
                const copy=element('div','stwii--insight-entry-copy');
                const term=termControl(copy,key+':'+metricsKey(row.entry));
                let name=String(row.entry.uid??'');try{name=titleFor(row.entry)||name;}catch{}
                const heading=element('strong','stwii--insight-entry-heading');
                const icons=reasonIcons(row.entry);
                for(const {icon,label,key:reason} of icons)
                    heading.append(term.button('reason.'+reason,icon,'stwii--insight-reason-icon',label));
                heading.append(element('span','stwii--insight-entry-name',name));
                copy.append(heading,element('small','stwii--insight-entry-meta',String(row.entry.world??'')));
                const terms=element('div','stwii--insight-terms');
                if(!icons.length)terms.append(term.button('reason.'+row.reason,reasonLabel(row.reason)));
                for(const item of selectionLabels(row.entry))terms.append(term.button(item.key.slice('insight.'.length),item.label));
                if(row.outlet)terms.append(term.button('outlet',t('reader.route.outlet')+(row.entry.outletName?' · '+String(row.entry.outletName):'')));
                const evidence=verified?'evidence.verified':'excluded.'+row.exclusion;
                terms.append(term.button(evidence,t('insight.'+evidence)));
                copy.append(terms);term.finish();line.append(copy);
                if(verified){
                    const token=element('span','stwii--insight-entry-tokens',formatted(row.tokens));
                    line.append(token);numberUpdates.push(()=>{token.textContent=formatted(row.tokens);});
                }
                detail.append(line);
                }
            }
            detail.addEventListener('toggle',()=>{if(detail.open)build();});
            if(detail.open)build();
            return detail;
        }
        function ratio(){return measurement?.prompt>0&&validCount(measurement.total)&&measurement.total<=measurement.prompt?measurement.total/measurement.prompt:null;}
        function totalLabel(){return formatted(measurement?.total);}
        function ratioLabel(){const r=ratio();return r===null?t('insight.unmeasured'):'~'+(100*r).toFixed(1)+'%';}
        const grid=element('div','stwii--insight-grid');
        grid.append(card(t('insight.matched'),()=>t('insight.count',matched.length)),card(t('insight.total'),totalLabel));
        report.append(grid);
        if(excluded.length||unresolved.length)report.append(element('p','stwii--insight-note',t('insight.evidence.summary',excluded.length,unresolved.length)));
        const ratioCard=card(t('insight.share'),ratioLabel);ratioCard.append(bar(ratio));report.append(ratioCard);
        if(!allVisible)report.append(element('p','stwii--insight-note',t('insight.visible')));
        const limitNote=element('p','stwii--insight-note',t('insight.limit'));
        const updateLimit=()=>{limitNote.hidden=!(capture.truncated||capture.promptLimited||measurement?.limited);};
        updateLimit();numberUpdates.push(updateLimit);report.append(limitNote);
        report.append(groupSection(t('insight.books'),r=>String(r.entry.world??''),s=>s),groupSection(t('insight.reasons'),r=>r.reason,reasonLabel));
        report.append(entrySection('insight.entries','matched',matched,true,expanded));
        report.append(entrySection('insight.excluded','excluded',excluded,false,expanded));
        const sameView=()=>current===view&&view.revision===revision&&latest===capture&&getChatId()===capture.chatId;
        const stillCurrent=()=>sameView()&&readScope()===scope;
        function updateStatus(){
            status.replaceChildren();
            if(busy){status.append(element('small','stwii--insight-note',t('insight.counting')));return;}
            if(measurement?.failed&&sameScope&&stillCurrent()){
                const retry=element('button','menu_button stwii--insight-measure',t('insight.retry'));retry.type='button';
                retry.addEventListener('click',calculate);status.append(retry);
            }
        }
        async function calculate(){
            if(busy||!sameScope||!stillCurrent()||!matched.length||(measurement&&!measurement.failed))return;
            busy=true;updateStatus();
            try{
                const countEntry=capture.stlo?(entry,text,valid)=>capture.stlo.count(entry,text,countText,valid):null;
                const result=await estimateInsight(matched,capture,countText,stillCurrent,allVisible,measurement,countEntry);
                if(result&&stillCurrent()){
                    measurement=result;
                    capture.measurement={scope,visibility,result,tokens:new Map(rows.map(r=>[JSON.stringify([r.entry.world,r.entry.uid]),r.tokens]))};
                    publish(capture);
                }else if(stillCurrent()){
                    measurement=null;for(const row of rows)row.tokens=null;
                }
            }catch{
                if(stillCurrent()){measurement={total:null,prompt:null,failed:true};for(const row of rows)row.tokens=null;}
            }finally{
                if(stillCurrent()){busy=false;updateStatus();for(const update of numberUpdates)update();}
                else if(sameView())refresh();
            }
        }
        updateStatus();
        // Opening is the opt-in. One deferred job; no watcher or polling.
        // Prompt dispatch never awaits the token estimate.
        if(sameScope&&matched.length&&!measurement){
            view.timer=setTimeout(()=>{view.timer=null;void calculate();},0);
        }
    }
    return {start,clear,ready,close,open,finish,beginCapture,selectionFor};
}
