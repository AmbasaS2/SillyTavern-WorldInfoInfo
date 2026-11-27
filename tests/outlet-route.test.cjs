const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const root = join(__dirname, '..');
const js = readFileSync(join(root, 'index.js'), 'utf8');
function between(start, end) {
    const a = js.indexOf(start), b = js.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return js.slice(a, b);
}
const functions = between('const confirmedOutletEntries = new WeakSet();', '// Evaluate the option and the bridge')
    + between('function promptTextParts(value)', '\nlet generationType;');
const position = { before: 0, atDepth: 4, outlet: 7 };
const ko = JSON.parse(readFileSync(join(root, 'i18n/ko-kr.json'), 'utf8'));
async function harness(added = [], regex = text => text) {
    const {createInsightCapture,verifiedInsightRows,requestTextParts}=await import('../lore-insight.mjs');
    const ctx = vm.createContext({
        chat_metadata: { stwiiLastReport: { added } },
        strategy: { constant: '🔵', normal: '🟢', vectorized: '🔎' },
        wiT: key => ko['worldInfoInfo.' + key] ?? key,
        world_info_position: position,
        regex_placement: { WORLD_INFO: 5 },
        getRegexedString: regex, verifiedInsightRows, requestTextParts,
        console,
    });
    vm.runInContext(functions, ctx);
    return {
        verify(entries,prompt,confirmed=[]){
            const cap=createInsightCapture(1,'chat',entries.length);
            ctx.captureWiCandidates(entries,{prompt},cap);
            cap.setPrompt(typeof prompt==='string'?[prompt]:requestTextParts(prompt),null,'request');
            for(const entry of confirmed){
                const row=cap.rows.find(row=>row.entry===entry);
                if(row&&row.text.trim()&&entry.disable!==true)cap.proven.set(JSON.stringify([entry.world,entry.uid]),row.text+'\n');
            }
            return ctx.applyConfirmedWiEntries(cap);
        },
        label: entry => ctx.describeLoreActivation(entry),
    };
}
const outlet = { world: 'Book', uid: 1, position: position.outlet, outletName: 'memory', content: 'A unique memory.' };
const regular = { ...outlet, position: position.before };
test('outlet route suffix appears only on a verified entry, not on a matching chat phrase',async()=>{
    const h=await harness([{world:'Book',uid:1,logic:'CONSTANT'}]);
    const candidate={...outlet,constant:true};
    assert.equal(h.label(candidate),'🔵 상시 주입');
    assert.equal(h.verify([candidate],[{role:'user',content:'A unique memory.'}]).length,0);
    assert.equal(h.verify([candidate],[{role:'system',content:'A unique memory.'}],[candidate]).length,1);
    assert.equal(h.label(candidate),'🔵 상시 주입 · 아웃렛 경유');
    assert.equal(h.label({...candidate}),'🔵 상시 주입');
    assert.equal(h.verify([{...candidate}],'No outlet here.').length,0);
});
test('ordinary and outlet entries both require actual request proof',async()=>{
    const h=await harness([{world:'Book',uid:1,logic:'CONSTANT'}]);
    const a={...regular},b={...outlet,uid:2,content:'Another memory.'};
    assert.equal(h.verify([a,b],'A unique memory. Another memory.').length,0);
    const included=h.verify([a,b],'A unique memory. Another memory.',[a]);
    assert.equal(included.length,1);assert.equal(included[0],a);
    assert.equal(h.label(a),'🔵 상시 주입');
    assert.equal(h.verify([a,b],'No lore.',[a,b]).length,0);
});
test('keyword, vector, sticky, external, decorator and unknown reasons are preserved',async()=>{
    const cases=[{primary:'memory'},{vectorConfirmed:true},{logic:'STICKY'},{logic:'EXTERNAL'},{logic:'DECORATOR'},null];
    for(const event of cases){
        const h=await harness(event?[{world:'Book',uid:1,...event}]:[]);
        const e={...outlet},original=h.label(e);
        assert.equal(h.verify([e],e.content,[e]).length,1);
        assert.equal(h.label(e),original+' · 아웃렛 경유');
    }
});
test('Jev retains precedence and receives the route suffix',async()=>{
    const h=await harness([{world:'Book',uid:1,logic:'CONSTANT'}]);
    const e={...outlet,stwiiJevRecall:true},original=h.label(e);
    assert.ok(original.startsWith('🔮'));
    h.verify([e],e.content,[e]);assert.equal(h.label(e),original+' · 아웃렛 경유');
});
test('rendered content is verified without writing entry properties',async()=>{
    const h=await harness([],text=>text.replace('unique','processed'));
    const e=Object.freeze({...outlet});
    assert.equal(h.verify([e],'A processed memory.',[e]).length,1);
    assert.equal(h.verify([e],e.content,[e]).length,0);
    assert.equal(Object.keys(e).length,Object.keys(outlet).length);
});
test('all locales include exactly one outlet route label', () => {
    for (const name of readdirSync(join(root, 'i18n')).filter(n => n.endsWith('.json'))) {
        const raw = readFileSync(join(root, 'i18n', name), 'utf8');
        const locale = JSON.parse(raw);
        assert.ok(locale['worldInfoInfo.reader.route.outlet']?.trim(), name);
        assert.equal(raw.split('"worldInfoInfo.reader.route.outlet"').length, 2, name);
    }
    assert.match(js, /"reader.route.outlet": "Via outlet"/);
});
