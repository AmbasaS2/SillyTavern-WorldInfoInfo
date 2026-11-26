const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const root = join(__dirname, '..');
const js = readFileSync(join(root, 'index.js'), 'utf8');
function between(start, end) {
    const a = js.indexOf(start), b = js.indexOf(end, a);
    assert.ok(a >= 0 && b > a, 'source section must exist');
    return js.slice(a, b);
}
const helpers = between('function showOriginalLore() {', '// Cherry&Solti RT');
const reader = between('    try {\n        // One on-demand, read-only request', '\n}\n\n');
const entry = { world: 'Book', uid: 4, comment: 'Title', content: 'Original body', key: ['word'] };

function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36) + '_' + text.length;
}
const id = 'Book\u241f4';
const record = { language: 'Korean', text: '번역 본문', sourceHash: hash(entry.content),
    fields: { comment: { source: entry.comment, text: '번역 제목' } } };
const snapshot = { records: { [id]: record }, pairs: { [id]: { translationLanguage: 'Korean' } } };
const legacy = { translations: snapshot.records, entryLanguagePairs: snapshot.pairs };

async function harness({ original, file = snapshot, oldSettings = null, rt = 'RT 번역', managerActive = true, latest = entry }) {
    const api = await import(pathToFileURL(join(root, 'lore-manager-translations.js')).href);
    const calls = { manager: 0, rt: 0, lore: 0, titleTranslation: 0, bodyTranslation: 0 };
    const settings = oldSettings ? { 'simple-lorebook': oldSettings } : {};
    if (original !== undefined) settings.worldInfoInfo = { showOriginalLore: original };
    const overlay = {};
    const title = { textContent: '' }, rendered = [];
    const context = {
        extension_settings: settings,
        managerTranslatedTitle(...args) { calls.titleTranslation++; return api.managerTranslatedTitle(...args); },
        managerTranslatedBody(...args) { calls.bodyTranslation++; return api.managerTranslatedBody(...args); },
        window: { __slbLoreManagerActive: managerActive },
        loadWorldInfo: async () => { calls.lore++; return { entries: { 4: latest } }; },
        readManagerTranslationBook: async () => { calls.manager++; return file; },
        rtTranslatedBody: async () => { calls.rt++; return rt; },
        renderLorePreview: (_, value) => rendered.push(value),
        entry, currentLoreViewer: { overlay }, overlay, title, body: {},
        schedulePlaceViewer() {}, getContext: () => ({ getRequestHeaders() {} }),
        fetch: () => { throw Error('unexpected direct fetch'); },
    };
    const ctx = vm.createContext(context);
    vm.runInContext(helpers, ctx);
    const listTitle = vm.runInContext('displayWiTitle(entry)', ctx);
    await vm.runInContext('(async () => {' + reader + '})()', ctx);
    return { calls, title: title.textContent, listTitle, text: rendered.at(-1) };
}

test('original mode shows original titles and current body without any translation lookup', async () => {
    const latest = { ...entry, comment: 'New title', content: 'New original body' };
    const result = await harness({ original: true, oldSettings: legacy, latest });
    assert.equal(result.listTitle, entry.comment);
    assert.equal(result.title, latest.comment);
    assert.equal(result.text, latest.content);
    assert.deepEqual(result.calls, { manager: 0, rt: 0, lore: 1, titleTranslation: 0, bodyTranslation: 0 });
});

test('default and unchecked mode keep saved file translations ahead of RT', async () => {
    for (const original of [undefined, false]) {
        const result = await harness({ original, oldSettings: legacy });
        assert.equal(result.listTitle, '번역 제목');
        assert.equal(result.title, '번역 제목');
        assert.equal(result.text, '번역 본문');
        assert.equal(result.calls.manager, 1);
        assert.equal(result.calls.rt, 0);
    }
});

test('unchecked mode preserves original-manager settings, RT fallback and source fallback', async () => {
    const fromLegacy = await harness({ original: false, file: null, oldSettings: legacy });
    assert.equal(fromLegacy.title, '번역 제목');
    assert.equal(fromLegacy.text, '번역 본문');
    const fromRT = await harness({ original: false, file: null, managerActive: false });
    assert.equal(fromRT.title, entry.comment);
    assert.equal(fromRT.text, 'RT 번역');
    assert.equal(fromRT.calls.manager, 0);
    assert.equal(fromRT.calls.rt, 1);
    const fromSource = await harness({ original: false, file: null, rt: null, managerActive: false });
    assert.equal(fromSource.text, entry.content);
});

test('settings checkbox defaults off, persists changes and redraws only the existing list', () => {
    const settings = {};
    const list = [entry];
    let saved = 0, redraw = 0, positioned = 0;
    const rows = [];
    const document = { createElement: () => ({
        classList: { add() {} },
        addEventListener(name, cb) { this[name] = cb; },
        append(...children) { this.children = children; },
    }) };
    const context = {
        document, extension_settings: settings, wiT: s => s,
        currentEntryList: list, configPanel: { append(row) { rows.push(row); } },
        updatePanel: value => { assert.equal(value, list); redraw++; },
        saveSettingsDebounced: () => { saved++; },
        requestAnimationFrame: cb => cb(),
        ensurePanelsVisible: () => { positioned++; },
    };
    const ctx = vm.createContext(context);
    vm.runInContext(helpers, ctx);
    const row = between('        const originalRow = document.createElement', '        // Optional bridge to Lorebook Manager');
    vm.runInContext('{' + row + '}', ctx);
    const checkbox = rows[0].children[0];
    assert.equal(checkbox.type, 'checkbox');
    assert.equal(checkbox.checked, false);
    for (const checked of [true, false, true]) {
        checkbox.checked = checked;
        checkbox.change();
        assert.equal(settings.worldInfoInfo.showOriginalLore, checked);
    }
    assert.equal(saved, 3);
    assert.equal(redraw, 3);
    assert.equal(positioned, 3);
    vm.runInContext('{' + row + '}', ctx);
    assert.equal(rows[1].children[0].checked, true);
    assert.match(js, /const enabled = extension_settings\.worldInfoInfo\?\.linkLoreLibrary === true/);
});

test('all supported UI locales include the original-view option', () => {
    for (const name of readdirSync(join(root, 'i18n')).filter(n => n.endsWith('.json'))) {
        const locale = JSON.parse(readFileSync(join(root, 'i18n', name), 'utf8'));
        assert.ok(locale['worldInfoInfo.settings.original.label']?.trim(), name);
        assert.ok(locale['worldInfoInfo.settings.original.hint']?.trim(), name);
    }
    const ko = JSON.parse(readFileSync(join(root, 'i18n', 'ko-kr.json'), 'utf8'));
    assert.equal(ko['worldInfoInfo.settings.original.label'], '원문으로 보기');
    assert.match(js, /"settings\.original\.label": "View original text"/);
});
