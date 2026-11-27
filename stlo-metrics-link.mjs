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

// Match the complete formatted native block. ST reverses equal-priority
// entries when inserting them. An activation listener can reorder those
// entries after ST has already produced the block, so verify exact boundaries
// and multiplicity rather than relying on the event's tie order.
export function matchesNativeLoreGroup(rows,content,format){
    if(typeof content!=='string'||!rows.length||
        rows.some(row=>!row.text.trim()||!Number.isFinite(row.entry.order)))return false;
    const ordered=rows.slice().sort((a,b)=>b.entry.order-a.entry.order).reverse();
    const joined=ordered.map(row=>row.text).join('\n');
    if(content===format(joined)&&content.includes(joined))return true;

    const marker='\u0000stwii-native-lore\u0000';
    const wrapped=format(marker);
    if(typeof wrapped!=='string'||wrapped.indexOf(marker)<0||wrapped.indexOf(marker)!==wrapped.lastIndexOf(marker))return false;
    const split=wrapped.indexOf(marker),prefix=wrapped.slice(0,split),suffix=wrapped.slice(split+marker.length);
    if(content.length!==prefix.length+joined.length+suffix.length||
        !content.startsWith(prefix)||!content.endsWith(suffix))return false;
    const body=content.slice(prefix.length,prefix.length+joined.length);
    if(format(body)!==content)return false;

    let offset=0;
    for(let start=0;start<ordered.length;){
        let end=start+1;
        const order=ordered[start].entry.order,counts=new Map([[ordered[start].text,1]]);
        while(end<ordered.length&&ordered[end].entry.order===order){
            const text=ordered[end++].text;
            counts.set(text,(counts.get(text)??0)+1);
        }
        for(let i=start;i<end;i++){
            let match=null;
            for(const text of counts.keys()){
                if(!body.startsWith(text,offset)||body[offset+text.length]!==(i===ordered.length-1?undefined:'\n'))continue;
                if(match!==null)return false;
                match=text;
            }
            if(match===null)return false;
            const left=counts.get(match)-1;
            if(left)counts.set(match,left);else counts.delete(match);
            offset+=match.length+(i===ordered.length-1?0:1);
        }
        start=end;
    }
    return offset===body.length;
}

// The dedicated PromptManager collection establishes source. Bind its
// complete block to a unique exact message from this assembly; unrelated
// collections need not be byte-for-byte equal.
export function buildStructuredProof(capture,info){
    const result=[];
    if(capture.truncated||!Array.isArray(info?.messages)||
        info.messages.length>4096||typeof info.formatWorldInfo!=='function'||
        !info.structure||info.squashed===true)return result;
    if(capture.observed!==capture.rows.length)return result;
    try{
        const root=info.structure.getCollection?.();
        if(!Array.isArray(root)||root.length>4096)return result;
        const keys=new Set();
        for(const row of capture.rows){
            const key=metricsKey(row.entry);
            if(keys.has(key))return [];
            keys.add(key);
        }
        for(const [position,identifier] of [[info.beforePosition,'worldInfoBefore'],[info.afterPosition,'worldInfoAfter']]){
            if(!Number.isInteger(position))continue;
            const group=capture.rows.filter(row=>row.entry.position===position&&!row.outlet&&row.text.length>0);
            const collections=root.filter(item=>item?.identifier===identifier);
            if(collections.length!==1)continue;
            const children=collections[0].getCollection?.();
            if(!Array.isArray(children)||children.length!==1||children[0]?.identifier!==identifier)continue;
            const source=children[0],text=source.content,role=source.role,name=source.name||'';
            if(!matchesNativeLoreGroup(group,text,info.formatWorldInfo))continue;
            const matches=info.messages.filter(message=>message?.content===text&&message.role===role&&(message.name||'')===name);
            if(matches.length!==1)continue;
            const ordered=group.sort((a,b)=>b.entry.order-a.entry.order).reverse();
            result.push({message:matches[0],text,role,name,entries:ordered.map(row=>({key:metricsKey(row.entry),text:row.text+'\n'}))});
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
