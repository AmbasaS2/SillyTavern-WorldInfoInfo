// Read-only observation of the actual ST 1.19.1 prompt assembly.
// Preserve native return values, errors and object contents. Never run a macro
// or tokenizer again to guess provenance; detach all observers at assembly end.
const LIMIT=4096, CHARS=524288;
const key=e=>JSON.stringify([e.world,e.uid]);
const roles=['system','user','assistant'];
const squashExcluded=new Set(['newMainChat','newChat','groupNudge']);
const isText=x=>typeof x==='string';
const positive=x=>Number.isInteger(x)&&x>=0;
const historyIndex=id=>/^chatHistory-(\d+)$/.exec(id??'')?.[1];
function flatMessages(root){
    const items=root?.getCollection?.();
    if(!Array.isArray(items)||items.length>LIMIT)return null;
    const out=[];let chars=0;
    for(const item of items){
        const nested=typeof item?.getCollection==='function'?item.getCollection():null;
        if(nested!==null&&(!Array.isArray(nested)||nested.length>LIMIT))return null;
        for(const message of nested??[item]){
            if(!message||typeof message.getCollection==='function'||out.length>=LIMIT)return null;
            if(message.content!=null&&!isText(message.content))return null;
            const content=message.content;
            if((chars+=(content?.length??0))>CHARS)return null;
            out.push({parent:nested?item.identifier:null,id:message.identifier,role:message.role,
                name:message.name||'',content,tools:!!message.tool_calls});
        }
    }
    return out;
}
function extensionSnapshot(value){
    if(!value||typeof value!=='object')return null;
    const keys=Object.keys(value);
    if(keys.length>LIMIT)return null;
    const result=new Map();let chars=0;
    for(const id of keys.sort()){
        const p=value[id];
        if(!p||!(p.position===1||id.startsWith('customWIOutlet_')||id==='2_floating_prompt'))continue;
        if(!isText(p.value)||(chars+=p.value.length)>CHARS)return null;
        result.set(id,{value:p.value,position:p.position,depth:p.depth,role:p.role,dynamic:typeof p.filter==='function'});
    }
    return result;
}

// Capture the pre-squash message hierarchy (native PromptManager discards
// identifiers during squashing), and the actual prepared in-chat prompts.
export function observePromptAssembly(manager,readExtensions,type){
    if(!manager||!['getPromptCollection','preparePrompt','setChatCompletion'].every(k=>typeof manager[k]==='function'))return null;
    const restorers=[];let active=true,collection=null,prepared=new WeakMap(),history=new Map(),chars=0,limited=false,latest=null,noteBase=null;
    function wrap(name,after,before){
        const own=Object.getOwnPropertyDescriptor(manager,name),original=manager[name];
        if(own&&!own.configurable)throw Error('Unsupported prompt manager');
        const wrapped=function(...args){
            if(active&&this===manager&&before)try{before(args);}catch{limited=true;}
            const result=original.apply(this,args);
            if(active&&this===manager)try{after(args,result);}catch{limited=true;latest=null;}
            return result;
        };
        Object.defineProperty(manager,name,{value:wrapped,configurable:true,writable:true,enumerable:own?.enumerable??false});
        restorers.push(()=>{
            if(manager[name]!==wrapped)return;
            if(own)Object.defineProperty(manager,name,own);else delete manager[name];
        });
    }
    function release(){active=false;for(const restore of restorers.reverse())try{restore();}catch{}restorers.length=0;collection=null;prepared=new WeakMap();history.clear();}
    try{
        wrap('getPromptCollection',(args,result)=>{
            if(args[0]===type)collection=result;
        },args=>{
            if(args[0]===type){collection=null;prepared=new WeakMap();history=new Map();chars=0;limited=false;latest=null;}
        });
        wrap('preparePrompt',([raw],result)=>{
            if(!result||!isText(raw?.content)||!isText(result.content))return;
            const record={raw:raw.content,content:result.content,role:result.role,id:result.identifier};
            if(historyIndex(result.identifier)){
                if(history.size>=LIMIT||(chars+=raw.content.length+result.content.length)>CHARS){limited=true;return;}
                if(history.has(result.identifier)){limited=true;return;}
                history.set(result.identifier,record);
            }else if(/\{\{\s*outlet::/i.test(raw.content)){
                if((chars+=raw.content.length+result.content.length)>CHARS){limited=true;return;}
                prepared.set(result,record);
            }
        });
        wrap('setChatCompletion',([completion])=>{
            const nodes=flatMessages(completion?.getMessages?.());
            const extensions=extensionSnapshot(readExtensions());
            const source=collection?.collection;
            if(limited||!nodes||!extensions||!Array.isArray(source)||source.length>LIMIT){latest=null;return;}
            let size=0;const prompts=[];
            for(const p of source){
                if(p.content!=null&&!isText(p.content)){latest=null;return;}
                if((size+=(p.content?.length??0))>CHARS){latest=null;return;}
                prompts.push({id:p.identifier,role:p.role,content:p.content??'',depth:p.injection_depth,
                    position:p.injection_position,order:p.injection_order??100,raw:prepared.get(p)?.raw});
            }
            latest={nodes,extensions,prompts,history:new Map(history),noteBase,
                disabledBefore:manager.isPromptDisabledForActiveCharacter?.('worldInfoBefore')===true,
                disabledAfter:manager.isPromptDisabledForActiveCharacter?.('worldInfoAfter')===true,
                squashed:manager.serviceSettings?.squash_system_messages===true,
                continuePrefill:manager.serviceSettings?.continue_prefill===true,type};
        });
        return {
            note(){try{const value=readExtensions()?.['2_floating_prompt']?.value;noteBase=isText(value)&&value.length<=CHARS?value:null;}catch{}},
            take(){const result=latest;release();latest=null;return result;},
            release(){release();latest=null;},
        };
    }catch{release();return null;}
}
function align(trace,messages,squashed){
    if(!Array.isArray(messages)||messages.length>LIMIT||trace.squashed!==squashed||!Array.isArray(trace.nodes))return null;
    const blocks=[];let last=null,size=0;
    for(const node of trace.nodes){
        if(squashed&&node.role==='system'&&!node.content)continue;
        if(!node.content&&!node.tools)continue;
        const merge=squashed&&node.role==='system'&&!node.name&&!squashExcluded.has(node.id)&&isText(node.content);
        if(merge&&last?.merge){last.content+='\n'+node.content;last.nodes.push(node);}
        else{last={content:node.content,role:node.role,name:node.name,merge,nodes:[node],entries:[]};blocks.push(last);}
        if((size+=(node.content?.length??0)+1)>CHARS)return null;
    }
    if(blocks.length!==messages.length)return null;
    const byNode=new Map();
    for(let i=0;i<blocks.length;i++){
        const block=blocks[i],message=messages[i];
        if(!message||message.role!==block.role||message.content!==block.content||(message.name||'')!==block.name)return null;
        block.message=message;block.text=block.content;
        for(const node of block.nodes)byNode.set(node,block);
    }
    return {blocks,byNode};
}
const orderRows=rows=>rows.slice().sort((a,b)=>b.entry.order-a.entry.order);
function validGroup(rows){
    return rows.length>0&&rows.every(row=>isText(row.text)&&row.text.trim()&&Number.isFinite(row.entry.order));
}
const refs=rows=>rows.map(row=>({key:key(row.entry),text:row.text+'\n'}));
function addRows(block,rows,sourceText){
    if(!block||!isText(sourceText))return;
    const normalized=sourceText.replace(/\s+/g,' ').trim();
    block.entries.push(...refs(rows.filter(row=>{
        const text=row.text.replace(/\s+/g,' ').trim();
        return text&&normalized.includes(text);
    })));
}
function outletGroups(capture,trace){
    const groups=new Map();
    for(const row of capture.rows)if(row.outlet&&isText(row.entry.outletName)&&row.entry.outletName){
        if(!groups.has(row.entry.outletName))groups.set(row.entry.outletName,[]);
        groups.get(row.entry.outletName).push(row);
    }
    for(const [name,rows] of groups){
        const expected=validGroup(rows)?orderRows(rows).map(r=>r.text).join('\n'):null;
        const p=trace.extensions.get('customWIOutlet_'+name);
        if(!expected||p?.value!==expected||p.position!==-1)groups.delete(name);
    }
    return groups;
}
// Evaluate only a literal, already-observed outlet substitution. Other macros
// may have side effects: never call the host macro engine a second time.
function expandLiteralOutlets(text,trace,outlets){
    const used=[];let unsafe=false;
    const expanded=text.replace(/\{\{outlet::(.+?)\}\}/gi,(_,name)=>{
        const outlet=name.trim(),p=trace.extensions.get('customWIOutlet_'+outlet);
        const value=p?.value??'';
        if(value.includes('{{'))unsafe=true;
        if(outlets.has(outlet))used.push(...outlets.get(outlet));
        return value;
    });
    if(unsafe||expanded.includes('{{'))return null;
    return {text:expanded,rows:used};
}
function preparedOutlets(prompt,trace,outlets){
    if(!isText(prompt.raw))return [];
    const expanded=expandLiteralOutlets(prompt.raw,trace,outlets);
    return expanded&&expanded.text===prompt.content?expanded.rows:[];
}
function nativeDepthGroups(capture,trace,info,outlets,noteRows){
    // Absolute main moves relative extension prompts into its own bucket.
    // The public API does not expose that final intermediate list; fail closed.
    if(trace.prompts.some(p=>p.id==='main'&&p.position===1))return null;
    if(trace.type==='continue'&&!trace.continuePrefill)return null;
    const byDepth=new Map(),absolute=trace.prompts.filter(p=>p.position===1&&p.content);
    function depth(d){if(!byDepth.has(d))byDepth.set(d,{absolute:[],extensions:[]});return byDepth.get(d);}
    for(const p of absolute){
        if(!positive(p.depth)||p.depth>10000||!roles.includes(p.role)||!Number.isFinite(p.order))return null;
        depth(p.depth).absolute.push(p);
    }
    for(const [id,p] of trace.extensions){
        if(p.position!==1||!p.value)continue;
        if(p.dynamic||!positive(p.depth)||p.depth>10000||!positive(p.role)||p.role>2)return null;
        depth(p.depth).extensions.push({id,...p});
    }
    const groups=[];
    for(const [d,data] of [...byDepth].sort((a,b)=>a[0]-b[0])){
        const orders=new Set([100,...data.absolute.map(p=>p.order)]);
        for(const order of [...orders].sort((a,b)=>b-a)){
            for(const role of roles){
                const rolePrompts=data.absolute.filter(p=>p.order===order&&p.role===role);
                const roleText=rolePrompts.map(p=>p.content).join('\n');
                const sources=rolePrompts.flatMap(p=>preparedOutlets(p,trace,outlets));
                const ext=order===100?data.extensions.filter(p=>roles[p.role]===role):[];
                const expanded=expandLiteralOutlets(ext.map(p=>p.value.trim()).join('\n'),trace,outlets);
                if(!expanded)return null;
                sources.push(...expanded.rows);
                for(const p of ext){
                    if(p.id==='2_floating_prompt'&&noteRows.length&&!p.value.includes('{{'))sources.push(...noteRows);
                    if(p.id!==('customDepthWI_'+d+'_'+p.role))continue;
                    const rows=capture.rows.filter(row=>!row.outlet&&row.entry.position===info.depthPosition&&
                        (row.entry.depth??4)===d&&(row.entry.role??0)===p.role);
                    if(validGroup(rows)&&orderRows(rows).reverse().map(row=>row.text).join('\n')===p.value&&!p.value.includes('{{'))sources.push(...rows);
                }
                const content=[roleText,expanded.text].filter(Boolean).map(s=>s.trim()).join('\n');
                if(content)groups.push({depth:d,role,content,rows:sources});
                if(groups.length>LIMIT)return null;
            }
        }
    }
    return groups;
}
function traceDepth(capture,trace,info,aligned,outlets,noteRows,excluded){
    const groups=nativeDepthGroups(capture,trace,info,outlets,noteRows);
    if(!groups||!groups.length||!trace.history.size)return;
    const indices=[...trace.history.keys()].map(id=>Number(historyIndex(id)));
    const total=Math.max(...indices),lowest=Math.min(...indices);
    if(!positive(total)||total>LIMIT||total<groups.length||lowest<1||indices.length!==total-lowest+1)return;
    const slots=Array(total-groups.length).fill(null);
    let inserted=0;
    for(let i=0;i<groups.length;){
        const d=groups[i].depth;let j=i+1;while(j<groups.length&&groups[j].depth===d)j++;
        slots.splice(d+inserted,0,...groups.slice(i,j));inserted+=j-i;i=j;
    }
    // Check every observed injected slot against the host's actual input and
    // prepared output, before accepting any of the route reconstruction.
    let observed=0;const verified=[],historyNodes=new Map();
    for(const node of trace.nodes){if(node.parent!=='chatHistory')continue;const list=historyNodes.get(node.id)??[];list.push(node);historyNodes.set(node.id,list);}
    for(let i=0;i<slots.length;i++){
        const group=slots[i];if(!group)continue;
        const id='chatHistory-'+(total-i),record=trace.history.get(id);
        if(!record){if(total-i>=lowest)return;verified.push({group,node:null});continue;}
        if(record.raw!==group.content||record.role!==group.role||record.content!==group.content)return;
        observed++;
        const candidates=historyNodes.get(id)??[];
        if(candidates.length>1)return;
        const node=candidates[0]??null;
        if(node&&(node.content!==record.content||node.role!==record.role))return;
        verified.push({group,node});
    }
    // Without any actual slot observation, do not infer what was dropped.
    if(!observed)return;
    for(const {group,node} of verified){
        if(node)addRows(aligned.byNode.get(node),group.rows,node.content);
        else for(const row of group.rows)if(!row.outlet)excluded.set(key(row.entry),'context');
    }
}

// Proof is attached to exact assembled message objects. The existing correlated
// pre-send request hook must still verify their unchanged role/name/content.
export function buildTraceEvidence(capture,info,trace){
    const excluded=new Map(),blocks=[];
    if(!trace||capture.truncated||capture.promptLimited||capture.observed!==capture.rows.length)return {blocks,excluded};
    try{
        const aligned=align(trace,info.messages,info.squashed===true);
        if(!aligned)return {blocks,excluded};
        const keys=new Set();
        for(const row of capture.rows){const id=key(row.entry);if(keys.has(id))return {blocks,excluded};keys.add(id);}
        for(const [position,id,disabled] of [[info.beforePosition,'worldInfoBefore',trace.disabledBefore],[info.afterPosition,'worldInfoAfter',trace.disabledAfter]]){
            if(!Number.isInteger(position))continue;
            const rows=capture.rows.filter(r=>!r.outlet&&r.entry.position===position&&r.text);
            if(!validGroup(rows))continue;
            const joined=orderRows(rows).reverse().map(row=>row.text).join('\n');
            const expected=info.formatWorldInfo(joined);
            const candidates=trace.nodes.filter(n=>n.parent===id&&n.id===id);
            if(candidates.length===1&&typeof expected==='string'&&expected.includes(joined)&&candidates[0].content===expected)
                addRows(aligned.byNode.get(candidates[0]),rows,candidates[0].content);
            else if(!candidates.length&&disabled&&!trace.prompts.some(p=>p.id===id&&p.position===1))
                for(const row of rows)excluded.set(key(row.entry),'preset');
        }
        const outlets=outletGroups(capture,trace);
        // A real prepared prompt containing an outlet reference is linked to
        // the native message with that identifier and the exact expansion.
        for(const p of trace.prompts){
            if(p.position===1||!p.id||!p.content)continue;
            const rows=preparedOutlets(p,trace,outlets);
            if(!rows.length)continue;
            const nodes=trace.nodes.filter(n=>n.id===p.id&&n.role===p.role&&n.content===p.content);
            if(nodes.length===1)addRows(aligned.byNode.get(nodes[0]),rows,nodes[0].content);
        }
        let noteRows=[];
        if(isText(trace.noteBase)&&Number.isInteger(info.anTopPosition)&&Number.isInteger(info.anBottomPosition)){
            const top=capture.rows.filter(r=>r.entry.position===info.anTopPosition&&r.text),bottom=capture.rows.filter(r=>r.entry.position===info.anBottomPosition&&r.text);
            if(top.length+bottom.length&&(!top.length||validGroup(top))&&(!bottom.length||validGroup(bottom))){
                const expected=(orderRows(top).reverse().map(r=>r.text).join('\n')+'\n'+trace.noteBase+'\n'+orderRows(bottom).reverse().map(r=>r.text).join('\n')).replace(/(^\n)|(\n$)/g,'');
                if(trace.extensions.get('2_floating_prompt')?.value===expected&&!expected.includes('{{')){
                    noteRows=[...top,...bottom];
                    const p=trace.prompts.find(p=>p.id==='authorsNote'&&p.position!==1&&p.content===expected);
                    const nodes=p?trace.nodes.filter(n=>n.id==='authorsNote'&&n.role===p.role&&n.content===expected):[];
                    if(nodes.length===1)addRows(aligned.byNode.get(nodes[0]),noteRows,nodes[0].content);
                }
            }
        }
        traceDepth(capture,trace,info,aligned,outlets,noteRows,excluded);
        for(const block of aligned.blocks){
            if(!block.entries.length)continue;
            const entries=[...new Map(block.entries.map(e=>[e.key,e])).values()];
            blocks.push({message:block.message,text:block.text,role:block.role,name:block.name,entries});
        }
        return {blocks,excluded};
    }catch{return {blocks:[],excluded:new Map()};}
}

// An observed loaded entry may have been skipped. Keep only bounded title/key
// metadata, never the body of nonactivated entries or another book load.
export function collectNonactivated(lists,activated,observedReasons,limit=256){
    const rows=[],seen=new Set(activated.map(key));let examined=0,limited=false;
    if(!lists)return {rows,limited};
    for(const name of ['globalLore','characterLore','chatLore','personaLore']){
        const list=lists[name];if(!Array.isArray(list))continue;
        for(const entry of list){
            if(++examined>LIMIT){limited=true;return {rows,limited};}
            if(!entry||!isText(entry.world)||entry.uid==null)continue;
            const id=key(entry);if(seen.has(id))continue;seen.add(id);
            if(rows.length>=limit){limited=true;return {rows,limited};}
            rows.push({entry:{world:entry.world,uid:entry.uid,comment:String(entry.comment??'').slice(0,512),
                key:Array.isArray(entry.key)?entry.key.slice(0,8).map(k=>String(k).slice(0,100)):[]},
                reason:observedReasons?.get(id)??'notRecorded'});
        }
    }
    return {rows,limited};
}

export function scanSkipReason(message){
    if(message==='disabled')return 'disabled';
    if(message.startsWith('skipped by generation type trigger filter'))return 'trigger';
    if(message==='filtered out by character')return 'character';
    if(message==='filtered out by tag')return 'tag';
    if(message==='suppressed by delay')return 'delay';
    if(message==='suppressed by cooldown')return 'cooldown';
    if(message.startsWith('suppressed by delay until recursion')||message==='suppressed by exclude recursion')return 'recursion';
    if(message==='suppressed by @@dont_activate decorator')return 'decorator';
    if(message==='has no keys defined, skipped')return 'noKeys';
    if(message==='skipped. Secondary keywords not satisfied')return 'secondary';
    if(/^WI entry \d+ failed probability check, removing from activated entries$/.test(message))return 'probability';
    return null;
}
