// Read-only observation of the actual ST 1.19.1 prompt assembly.
// Preserve native return values, errors and object contents. Never run a macro
// or tokenizer again to guess provenance; detach all observers at assembly end.
const LIMIT=4096, CHARS=524288, TRACE_CHARS=4*1024*1024, MAX_LAYOUTS=64;
const key=e=>JSON.stringify([e.world,e.uid]);
const roles=['system','user','assistant'];
const squashExcluded=new Set(['newMainChat','newChat','groupNudge']);
const isText=x=>typeof x==='string';
const positive=x=>Number.isInteger(x)&&x>=0;
const historyIndex=id=>/^chatHistory-(\d+)$/.exec(id??'')?.[1];
function flatMessages(root,readReceipt=null){
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
            if((chars+=(content?.length??0))>TRACE_CHARS)return null;
            out.push({parent:nested?item.identifier:null,id:message.identifier,role:message.role,
                name:message.name||'',content,tools:!!message.tool_calls,receipt:readReceipt?.(message)??null});
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
export function observePromptAssembly(manager,readExtensions,type,noteBase=null,messageClass=null){
    if(!manager||!['getPromptCollection','preparePrompt','setChatCompletion'].every(k=>typeof manager[k]==='function'))return null;
    const restorers=[],native=typeof messageClass?.fromPromptAsync==='function';
    let active=true,collections=[],prepared=new WeakMap(),receipts=new WeakMap(),requests=new WeakMap(),
        legacyHistory=new Map(),latest=null,chars=0,records=0;
    function install(target,name,factory){
        const own=Object.getOwnPropertyDescriptor(target,name),original=target[name];
        if(typeof original!=='function'||own&&!own.configurable)throw Error('Unsupported prompt observer');
        const wrapped=factory(original);
        Object.defineProperty(target,name,{value:wrapped,configurable:true,writable:true,enumerable:own?.enumerable??false});
        restorers.push(()=>{
            if(target[name]!==wrapped)return;
            if(own)Object.defineProperty(target,name,own);else delete target[name];
        });
    }
    function wrap(name,after){
        install(manager,name,original=>function(...args){
            const result=original.apply(this,args);
            if(active&&this===manager)try{after(args,result);}catch{}
            return result;
        });
    }
    function release(){
        active=false;
        for(const restore of restorers.reverse())try{restore();}catch{}
        restorers.length=0;collections=[];prepared=new WeakMap();receipts=new WeakMap();requests=new WeakMap();legacyHistory.clear();latest=null;
    }
    try{
        // Native history IDs are local to an assembly. A concurrent dry-run
        // may reuse every one of them. Bind a prepared prompt to the actual
        // Message object created from it, not to its string identifier.
        if(native)install(messageClass,'fromPromptAsync',original=>function(...args){
            const prompt=args[0],record=prepared.get(prompt),result=original.apply(this,args);
            if(active&&prompt&&result&&typeof result.then==='function'){
                result.then(message=>{
                    if(active&&message&&typeof message==='object')receipts.set(message,{prompt,record});
                },()=>{});
            }
            return result;
        });
        wrap('getPromptCollection',(args,result)=>{
            if(!result)return;
            if(!native){if(args[0]!==type)return;collections=[];legacyHistory.clear();}
            collections.push({type:args[0],collection:result,extensions:extensionSnapshot(readExtensions()),
                disabledBefore:manager.isPromptDisabledForActiveCharacter?.('worldInfoBefore')===true,
                disabledAfter:manager.isPromptDisabledForActiveCharacter?.('worldInfoAfter')===true});
            if(collections.length>6)collections.shift();
        });
        wrap('preparePrompt',([raw],result)=>{
            if(!result||!isText(raw?.content)||!isText(result.content))return;
            const id=result.identifier;
            if(!historyIndex(id)&&!/\{\{\s*outlet::/i.test(raw.content))return;
            const size=raw.content.length+(raw.content===result.content?0:result.content.length);
            if(records>=2*LIMIT||chars+size>TRACE_CHARS)return;
            records++;chars+=size;
            const record={raw:raw.content,content:result.content,role:result.role,id};
            prepared.set(result,record);
            if(!native&&historyIndex(id)){
                const previous=legacyHistory.get(id);
                if(!previous)legacyHistory.set(id,record);
                else if(previous.raw!==record.raw||previous.content!==record.content||previous.role!==record.role)legacyHistory.set(id,{ambiguous:true});
            }
        });
        wrap('setChatCompletion',([completion])=>{
            const structure=completion?.getMessages?.();
            if(!structure)return;
            const nodes=flatMessages(structure,native?message=>receipts.get(message):null)??[];
            const anchors=new Set(nodes.map(n=>n.receipt?.prompt).filter(Boolean));
            const candidates=collections.filter(c=>c.type===type&&Array.isArray(c.collection?.collection));
            const matched=candidates.filter(c=>c.collection.collection.some(prompt=>anchors.has(prompt)));
            const chosen=matched.length===1?matched[0]:!matched.length&&collections.length===1&&candidates.length===1?candidates[0]:null;
            const prompts=[];let size=0,collectionKnown=!!chosen?.extensions;
            if(collectionKnown){
                for(const p of chosen.collection.collection){
                    if(p.content!=null&&!isText(p.content)||(size+=(p.content?.length??0))>CHARS||prompts.length>=LIMIT){collectionKnown=false;break;}
                    prompts.push({id:p.identifier,role:p.role,content:p.content??'',depth:p.injection_depth,
                        position:p.injection_position,order:p.injection_order??100,relativePosition:p.position,
                        extension:p.extension===true,raw:prepared.get(p)?.raw});
                }
            }
            const history=new Map();let historyKnown=true;
            if(native){
                for(const n of nodes){
                    if(n.parent!=='chatHistory')continue;
                    if(n.tools||n.role==='tool'){historyKnown=false;break;}
                    if(!historyIndex(n.id))continue;
                    const r=n.receipt?.record;
                    if(!r||r.id!==n.id||r.content!==n.content||r.role!==n.role||history.has(n.id)){historyKnown=false;break;}
                    history.set(n.id,r);
                }
            }else{
                for(const [id,r] of legacyHistory){if(r.ambiguous){historyKnown=false;break;}history.set(id,r);}
            }
            if(!historyKnown)history.clear();
            const snapshot={structure,nodes:nodes.map(({receipt,...node})=>node),extensions:collectionKnown?chosen.extensions:new Map(),
                prompts:collectionKnown?prompts:[],history,noteBase,collectionKnown,
                disabledBefore:collectionKnown&&chosen.disabledBefore,disabledAfter:collectionKnown&&chosen.disabledAfter,
                squashed:manager.serviceSettings?.squash_system_messages===true,
                continuePrefill:manager.serviceSettings?.continue_prefill===true,type};
            latest=snapshot;
            // ST returns a fresh chat array from this exact ChatCompletion
            // instance after squashing. Correlate that array by identity;
            // don't let the first dry-run completion steal the live trace.
            if(typeof completion.getChat==='function')install(completion,'getChat',original=>function(...args){
                const result=original.apply(this,args);
                if(active&&this===completion&&Array.isArray(result))requests.set(result,snapshot);
                return result;
            });
        });
        return {
            take(messages){
                const result=Array.isArray(messages)?requests.get(messages)??null:latest;
                release();return result;
            },
            release,
        };
    }catch{release();return null;}
}
function align(trace,messages,squashed){
    if(!Array.isArray(messages)||messages.length>LIMIT||trace.squashed!==squashed||!Array.isArray(trace.nodes))return null;
    const blocks=[];let last=null,size=0;
    for(const node of trace.nodes){
        if(squashed&&node.role==='system'&&!node.content)continue;
        // In a squashed request an empty non-system native message still
        // breaks adjacent system blocks; getChat drops it only afterwards.
        if(!squashed&&!node.content&&!node.tools)continue;
        const merge=squashed&&node.role==='system'&&!node.name&&!squashExcluded.has(node.id)&&isText(node.content);
        if(merge&&last?.merge){last.content+='\n'+node.content;last.nodes.push(node);}
        else{last={content:node.content,role:node.role,name:node.name,merge,nodes:[node],entries:[]};blocks.push(last);}
        if((size+=(node.content?.length??0)+1)>TRACE_CHARS)return null;
    }
    const emitted=blocks.filter(block=>block.content||block.nodes.some(node=>node.tools));
    if(emitted.length!==messages.length)return null;
    const byNode=new Map();
    for(let i=0;i<emitted.length;i++){
        const block=emitted[i],message=messages[i];
        if(!message||message.role!==block.role||message.content!==block.content||(message.name||'')!==block.name)return null;
        block.message=message;block.text=block.content;
        for(const node of block.nodes)byNode.set(node,block);
    }
    return {blocks:emitted,byNode};
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
// Reproduce the host's absolute-main handling using the already prepared
// prompt collection. Never re-evaluate a filter or a macro.
function absolutePrompts(trace){
    const absolute=trace.prompts.filter(p=>p.position===1);
    if(!absolute.some(p=>p.id==='main'))return absolute;
    function insert(p){
        if(!p?.relativePosition)return;
        const i=absolute.findIndex(x=>x.id==='main');
        const main=absolute[i];
        absolute.splice(i+(p.relativePosition==='end'?1:0),0,
            {...p,role:main.role,position:main.position,depth:main.depth,order:main.order});
    }
    for(const id of ['summary','authorsNote','vectorsMemory','vectorsDataBank','smartContext'])
        insert(trace.prompts.find(p=>p.id===id));
    for(const p of trace.prompts.filter(p=>p.extension&&p.relativePosition))insert(p);
    return absolute;
}
function nativeDepthChoices(capture,trace,info,outlets,noteRows){
    if(trace.type==='continue'&&!trace.continuePrefill)return null;
    const byDepth=new Map(),absolute=absolutePrompts(trace).filter(p=>p.content);
    function depth(d){if(!byDepth.has(d))byDepth.set(d,{absolute:[],extensions:[]});return byDepth.get(d);}
    for(const p of absolute){
        if(!positive(p.depth)||p.depth>10000||!roles.includes(p.role)||!Number.isFinite(p.order))return null;
        depth(p.depth).absolute.push(p);
    }
    for(const [id,p] of trace.extensions){
        if(p.position!==1||!p.value)continue;
        if(!positive(p.depth)||p.depth>10000||!positive(p.role)||p.role>2)return null;
        depth(p.depth).extensions.push({id,...p});
    }
    const choices=[];
    for(const [d,data] of [...byDepth].sort((a,b)=>a[0]-b[0])){
        const orders=new Set([100,...data.absolute.map(p=>p.order)]);
        for(const order of [...orders].sort((a,b)=>b-a)){
            for(const role of roles){
                const rolePrompts=data.absolute.filter(p=>p.order===order&&p.role===role);
                const roleText=rolePrompts.map(p=>p.content).join('\n');
                const sources=rolePrompts.flatMap(p=>preparedOutlets(p,trace,outlets));
                for(const p of rolePrompts){
                    const position=p.id==='worldInfoBefore'?info.beforePosition:p.id==='worldInfoAfter'?info.afterPosition:null;
                    if(Number.isInteger(position)){
                        const rows=capture.rows.filter(r=>!r.outlet&&r.entry.position===position&&r.text);
                        if(validGroup(rows)){
                            const joined=orderRows(rows).reverse().map(r=>r.text).join('\n');
                            const expected=info.formatWorldInfo(joined);
                            if(isText(expected)&&expected.includes(joined)&&p.content===expected)sources.push(...rows);
                        }
                    }
                    if(p.id==='authorsNote'&&noteRows.length&&p.content===trace.extensions.get('2_floating_prompt')?.value)sources.push(...noteRows);
                }
                const ext=order===100?data.extensions.filter(p=>roles[p.role]===role):[];
                if(!roleText&&!ext.length)continue;
                // A conditional extension may be present or absent. Let the
                // actual native history choose; do not call its filter again.
                let variants=[[]];
                for(const p of ext){
                    variants=p.dynamic?variants.flatMap(items=>[items,[...items,p]]):variants.map(items=>[...items,p]);
                    if(variants.length>MAX_LAYOUTS)return null;
                }
                const options=[];
                for(const included of variants){
                    const expanded=expandLiteralOutlets(included.map(p=>p.value.trim()).join('\n'),trace,outlets);
                    if(!expanded){
                        // This group's macro output is opaque. It may shift
                        // other slots, but must not erase their exact proof.
                        options.push({depth:d,role,content:null,rows:[]});
                        if(!roleText.trim())options.push(null);
                        continue;
                    }
                    const rows=[...sources,...expanded.rows];
                    for(const p of included){
                        if(p.id==='2_floating_prompt'&&noteRows.length&&!p.value.includes('{{'))rows.push(...noteRows);
                        if(p.id!==('customDepthWI_'+d+'_'+p.role))continue;
                        const depthRows=capture.rows.filter(row=>!row.outlet&&row.entry.position===info.depthPosition&&
                            (row.entry.depth??4)===d&&(row.entry.role??0)===p.role);
                        if(validGroup(depthRows)&&orderRows(depthRows).reverse().map(row=>row.text).join('\n')===p.value&&!p.value.includes('{{'))rows.push(...depthRows);
                    }
                    const content=[roleText,expanded.text].filter(Boolean).map(s=>s.trim()).join('\n');
                    options.push(content?{depth:d,role,content,rows}:null);
                }
                const distinct=new Map();
                for(const option of options){
                    const signature=option?JSON.stringify([option.content,option.rows.map(r=>key(r.entry))]):'absent';
                    if(!distinct.has(signature))distinct.set(signature,option);
                }
                choices.push([...distinct.values()]);
                if(choices.length>LIMIT)return null;
            }
        }
    }
    return choices;
}
function traceDepth(capture,trace,info,aligned,outlets,noteRows,excluded){
    const choices=nativeDepthChoices(capture,trace,info,outlets,noteRows);
    if(trace.collectionKnown===false||!choices?.length||!trace.history.size)return;
    const indices=[...trace.history.keys()].map(id=>Number(historyIndex(id)));
    const total=Math.max(...indices),lowest=Math.min(...indices);
    if(!positive(total)||total>LIMIT||lowest<1||indices.length!==total-lowest+1)return;
    const historyNodes=new Map();
    for(const node of trace.nodes){if(node.parent!=='chatHistory')continue;const list=historyNodes.get(node.id)??[];list.push(node);historyNodes.set(node.id,list);}
    let layouts=[[]];
    for(const options of choices){
        if(layouts.length*options.length>MAX_LAYOUTS)return;
        if(options.length===1){if(options[0])for(const layout of layouts)layout.push(options[0]);continue;}
        layouts=layouts.flatMap(layout=>options.map(option=>option?[...layout,option]:layout));
    }
    // An entry is confirmed only when *every* possible layout consistent
    // with the actual history proves that same native slot. Opaque groups
    // cannot themselves supply proof, nor turn a text-only hit into proof.
    let common=null;
    for(const groups of layouts){
        if(total<groups.length)continue;
        const slots=Array(total-groups.length).fill(null);
        let inserted=0;
        for(let i=0;i<groups.length;){
            const d=groups[i].depth;let j=i+1;while(j<groups.length&&groups[j].depth===d)j++;
            slots.splice(d+inserted,0,...groups.slice(i,j));inserted+=j-i;i=j;
        }
        let observed=0,valid=true;const verified=[];
        for(let i=0;i<slots.length;i++){
            const group=slots[i];if(!group)continue;
            const id='chatHistory-'+(total-i),record=trace.history.get(id);
            if(!record){if(total-i>=lowest){valid=false;break;}verified.push({group,node:null});continue;}
            if(record.role!==group.role||group.content!==null&&(record.raw!==group.content||record.content!==group.content)){valid=false;break;}
            observed++;
            const candidates=historyNodes.get(id)??[];
            if(candidates.length>1){valid=false;break;}
            const node=candidates[0]??null;
            if(node&&(node.content!==record.content||node.role!==record.role)){valid=false;break;}
            verified.push({group,node});
        }
        if(!valid)continue;
        const evidence=new Map();
        if(observed)for(const {group,node} of verified){
            for(const row of group.rows){
                if(!node&&row.outlet)continue;
                const id=key(row.entry),prior=evidence.get(id);
                // Multiple actual placements are not a unique depth proof.
                if(prior&&prior.node!==node){evidence.set(id,{ambiguous:true});continue;}
                if(!prior?.ambiguous)evidence.set(id,{row,node});
            }
        }
        for(const [id,proof] of evidence)if(proof.ambiguous)evidence.delete(id);
        if(common===null)common=evidence;
        else for(const [id,proof] of common)if(!evidence.has(id)||evidence.get(id).node!==proof.node)common.delete(id);
        if(common.size===0)return;
    }
    for(const [id,{row,node}] of common??[]){
        if(node)addRows(aligned.byNode.get(node),[row],node.content);
        else excluded.set(id,'context');
    }
}

// Proof is attached to exact assembled message objects. The existing correlated
// pre-send request hook must still verify their unchanged role/name/content.
export function buildTraceEvidence(capture,info,trace){
    const excluded=new Map(),blocks=[];
    if(!trace||capture.truncated||capture.observed!==capture.rows.length)return {blocks,excluded};
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
        // A depth-route failure must not discard independently proven native blocks.
        try{traceDepth(capture,trace,info,aligned,outlets,noteRows,excluded);}catch{}
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
