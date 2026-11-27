// Optional STLOMemoryMetrics v1 consumer. All data stays generation-local.
// A missing or obsolete companion is never a dependency of RP or the reader.
const validCount=n=>Number.isSafeInteger(n)&&n>=0;
export const metricsKey=entry=>JSON.stringify([entry.world,entry.uid]);
const sources=new Set(['all','native','adaptive-durable','adaptive-concise','adaptive-role','adaptive-anchors','adaptive-recent']);

export function connectStloMetrics(getBridge=()=>globalThis.STLOMemoryMetrics){
    let bridge,context;
    try{
        bridge=getBridge();
        if(bridge?.version!==1||typeof bridge.context!=='function')return null;
        context=bridge.context();
        if(!context?.generation||typeof context.generation!=='object'||typeof context.tokenizer!=='string'||!context.tokenizer)return null;
    }catch{return null;}
    const {generation,tokenizer}=context;
    let expired=false;
    function live(){
        if(expired)return false;
        try{
            if(getBridge()===bridge){
                const current=bridge.context();
                if(current?.generation===generation&&current.tokenizer===tokenizer)return true;
            }
        }catch{}
        expired=true;return false;
    }
    function selection(entry){
        if(!entry?.stwiiJevRecall||!live()||typeof bridge.selection!=='function')return null;
        try{
            const value=bridge.selection({generation,key:metricsKey(entry)});
            if(!live()||value?.decision!=='include'||value.activated!==true)return null;
            return {source:sources.has(value.source)?value.source:null,
                score:typeof value.score==='number'&&Number.isFinite(value.score)?value.score:null,
                accepted:value.budget==='accepted'};
        }catch{return null;}
    }
    async function count(entry,text,fallback,stillCurrent){
        if(!stillCurrent())return null;
        const descriptor={generation,tokenizer,target:metricsKey(entry),text};
        if(live()){
            try{
                const known=bridge.lookup?.(descriptor);
                if(stillCurrent()&&live()&&validCount(known)&&!(known===0&&text.trim()))return known;
                if(stillCurrent()&&live()&&typeof bridge.measure==='function'){
                    const n=await bridge.measure(descriptor);
                    if(!stillCurrent())return null;
                    if(live()&&validCount(n)&&!(n===0&&text.trim()))return n;
                }
            }catch{/* optional sharing, same local fallback as standalone */}
        }
        return stillCurrent()?fallback(text):null;
    }
    function publish(records,complete){
        if(!live()||typeof bridge.publishInjection!=='function')return false;
        try{return bridge.publishInjection({generation,tokenizer,records,complete})===true;}catch{return false;}
    }
    return {live,selection,count,publish};
}

// ST 1.19.1 PromptManager keeps identifiers for the dedicated before/after
// World Info collections. Flatten in the same order as ChatCompletion.getChat.
// Only accept an exact correspondence to the actual assembled message array.
// Other insertion routes (including at-depth and outlets) do not expose this
// provenance here: never promote a substring hit into a confirmed receipt.
export function buildStructuredProof(capture,info){
    const result=[];
    if(capture.truncated||!Array.isArray(info?.messages)||
        info.messages.length>4096||typeof info.formatWorldInfo!=='function'||
        !info.structure||info.squashed===true)return result;
    if(capture.observed!==capture.rows.length)return result;
    try{
        const root=info.structure.getCollection?.();
        if(!Array.isArray(root)||root.length>4096)return result;
        const flat=[];
        for(const item of root){
            const nested=typeof item?.getCollection==='function'?item.getCollection():null;
            if(nested!==null&&!Array.isArray(nested))return [];
            for(const message of nested??[item]){
                if(typeof message?.getCollection==='function')return [];
                if(message?.content||message?.tool_calls)flat.push({parent:nested?item.identifier:null,message});
                if(flat.length>4096)return [];
            }
        }
        if(flat.length!==info.messages.length)return [];
        // Full ordered alignment; refuse to guess from text in arbitrary chat.
        for(let i=0;i<flat.length;i++){
            const a=flat[i].message,b=info.messages[i];
            if(!b||a.role!==b.role||a.content!==b.content||(a.name||'')!==(b.name||''))return [];
        }
        const keys=new Set();
        for(const row of capture.rows){
            const key=metricsKey(row.entry);
            if(keys.has(key))return [];
            keys.add(key);
        }
        for(const [position,identifier] of [[info.beforePosition,'worldInfoBefore'],[info.afterPosition,'worldInfoAfter']]){
            if(!Number.isInteger(position))continue;
            const group=capture.rows.filter(row=>row.entry.position===position&&!row.outlet&&row.text.length>0);
            if(!group.length||group.some(row=>!Number.isFinite(row.entry.order)||!row.text.trim()))continue;
            // Host sorts descending and unshifts: reversing also handles ties.
            const ordered=group.slice().sort((a,b)=>b.entry.order-a.entry.order).reverse();
            const joined=ordered.map(row=>row.text).join('\n');
            const exact=info.formatWorldInfo(joined);
            if(typeof exact!=='string'||!exact||!exact.includes(joined))continue;
            const indices=flat.map((node,i)=>node.parent===identifier&&node.message.identifier===identifier?i:-1).filter(i=>i>=0);
            if(indices.length!==1)continue;
            const message=info.messages[indices[0]];
            if(message.content!==exact||flat[indices[0]].message.content!==exact)continue;
            // Keep only the correlated message reference, its exact text, role
            // and bounded key list until the existing pre-send hook fires.
            result.push({message,text:exact,role:message.role,name:message.name||'',entries:ordered.map(row=>({key:metricsKey(row.entry),text:row.text+'\n'}))});
        }
    }catch{return [];}
    return result;
}

export function confirmStructuredProof(blocks,messages,correlatedOriginals=null){
    const proven=new Map();
    if(!Array.isArray(messages)||messages.length>4096)return proven;
    for(const block of blocks){
        const exact=m=>m?.content===block.text&&m.role===block.role&&(m.name||'')===block.name;
        const identical=messages.filter(m=>m===block.message);
        let m=identical.length===1&&exact(block.message)?block.message:null;
        // A native block may survive as a unique exact copy in the same
        // request, even when another handler copies every message object.
        if(!m&&identical.length===0&&correlatedOriginals?.filter(exact).length===1){
            const copies=messages.filter(exact);
            if(copies.length===1)m=copies[0];
        }
        if(!m)continue;
        if(typeof m.content!=='string')continue;
        const normalized=m.content.replace(/\s+/g,' ').trim();
        for(const entry of block.entries){
            const text=entry.text.replace(/\s+/g,' ').trim();
            if(text&&normalized.includes(text))proven.set(entry.key,entry.text);
        }
    }
    return proven;
}

export function buildInjectionRecords(capture,isVisible,scanComplete){
    const records=[],seen=new Set();
    let complete=!capture.truncated&&(!capture.promptLimited||capture.requestProofChecked===true)&&
        (capture.observed===capture.rows.length||(capture.observed===null&&scanComplete&&capture.rows.length===0));
    for(const row of capture.rows){
        const key=metricsKey(row.entry);
        if(seen.has(key)){complete=false;continue;}seen.add(key);
        if(!isVisible(row.entry.world)){complete=false;continue;}
        const text=capture.proven?.get(key);
        // Unknown is not exclusion. A missing substring is not proof of
        // non-injection after macros, regex, squashing, or backend transforms.
        records.push(typeof text==='string'&&text.trim()?{key,status:'confirmed',text}:
            capture.excluded?.has(key)?{key,status:'excluded'}:{key,status:'unknown'});
    }
    return {records,complete};
}
