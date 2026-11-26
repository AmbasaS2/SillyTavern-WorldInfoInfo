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
function harness(added = [], regex = text => text) {
    const ctx = vm.createContext({
        chat_metadata: { stwiiLastReport: { added } },
        strategy: { constant: '🔵', normal: '🟢', vectorized: '🔎' },
        wiT: key => ko['worldInfoInfo.' + key] ?? key,
        world_info_position: position,
        regex_placement: { WORLD_INFO: 5 },
        getRegexedString: regex,
        console,
    });
    vm.runInContext(functions, ctx);
    return {
        verify: (entries, prompt) => ctx.confirmedWiEntries(entries, { prompt }),
        label: entry => ctx.describeLoreActivation(entry),
    };
}
const outlet = { world: 'Book', uid: 1, position: position.outlet, outletName: 'memory', content: 'A unique memory.' };
const regular = { ...outlet, position: position.before };
test('constant outlet gets the suffix only after the existing final-request check', () => {
    const h = harness([{ world: 'Book', uid: 1, logic: 'CONSTANT' }]);
    const candidate = { ...outlet, constant: true };
    assert.equal(h.label(candidate), '🔵 상시 주입');
    assert.equal(h.verify([candidate], [{ role: 'system', content: 'A unique\nmemory.' }]).length, 1);
    assert.equal(h.label(candidate), '🔵 상시 주입 · 아웃렛 경유');
    assert.equal(h.label({ ...candidate }), '🔵 상시 주입');
    assert.equal(h.verify([candidate], 'No outlet here.').length, 0);
    assert.equal(h.label(candidate), '🔵 상시 주입');
});
test('ordinary entries preserve labels and invalid or absent outlets stay excluded', () => {
    const h = harness([{ world: 'Book', uid: 1, logic: 'CONSTANT' }]);
    const entries = [regular, { ...outlet, outletName: '' }, { ...outlet, disable: true },
        { ...outlet, content: '' }, { ...outlet, uid: 2, content: 'Not present' }];
    const included = h.verify(entries, 'A unique memory.');
    assert.equal(included.length, 1);
    assert.equal(included[0], regular);
    assert.equal(h.label(regular), '🔵 상시 주입');
    for (const e of entries.slice(1)) assert.ok(!h.label(e).includes('아웃렛 경유'));
    assert.equal(h.verify([outlet], undefined).length, 0);
});
test('keyword, vector, sticky, external, decorator and unknown reasons are preserved', () => {
    const cases = [{ primary: 'memory' }, { vectorConfirmed: true }, { logic: 'STICKY' },
        { logic: 'EXTERNAL' }, { logic: 'DECORATOR' }, null];
    for (const event of cases) {
        const h = harness(event ? [{ world: 'Book', uid: 1, ...event }] : []);
        const e = { ...outlet };
        const original = h.label(e);
        assert.equal(h.verify([e], e.content).length, 1);
        assert.equal(h.label(e), original + ' · 아웃렛 경유');
    }
});
test('Jev retains precedence and receives the route suffix', () => {
    const h = harness([{ world: 'Book', uid: 1, logic: 'CONSTANT' }]);
    const e = { ...outlet, stwiiJevRecall: true };
    const original = h.label(e);
    assert.ok(original.startsWith('🔮'));
    h.verify([e], e.content);
    assert.equal(h.label(e), original + ' · 아웃렛 경유');
});
test('existing regex and raw matching behavior is unchanged without writing entry properties', () => {
    const h = harness([], text => text.replace('unique', 'processed'));
    const e = Object.freeze({ ...outlet });
    assert.equal(h.verify([e], 'A processed memory.').length, 1);
    assert.ok(h.label(e).endsWith('아웃렛 경유'));
    assert.equal(h.verify([e], e.content).length, 1);
    assert.equal(Object.keys(e).length, Object.keys(outlet).length);
    assert.equal(h.verify([e], 'not present').length, 0);
    assert.ok(!h.label(e).endsWith('아웃렛 경유'));
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
