const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const moduleUrl = pathToFileURL(join(root, 'lore-manager-translations.js')).href;
const api = () => import(moduleUrl);

function sourceHash(value) {
    // Independently mirror the FNV-1a source-body fingerprint contract.
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36) + '_' + value.length;
}
function snapshot(book, entry, overrides = {}) {
    const key = book + '\u241f' + entry.uid;
    return {
        format: 'lore-manager-translations-v1', book, revision: 3,
        records: { [key]: { book, uid: entry.uid, language: 'Korean',
            sourceHash: sourceHash(entry.content), text: '번역한 본문',
            fields: { comment: { source: entry.comment, text: '번역한 제목' } },
        } },
        pairs: { [key]: { sourceLanguage: 'English', translationLanguage: 'Korean' } },
        ...overrides,
    };
}

test('file path precisely matches Lorebook Manager for Unicode and unusual names', async () => {
    const { managerTranslationBookPath: path } = await api();
    assert.equal(path('일반 세계관'), '/user/files/lore-manager-translation-book-944d70c586b57a43.json');
    assert.equal(path('A Rose & A Rose'), '/user/files/lore-manager-translation-A-Rose-A-Rose-278ca259d3a02555.json');
    assert.equal(path('🦊狐🦊'), '/user/files/lore-manager-translation-book-85f2fac765ffed43.json');
    assert.equal(path('마법사의 기록 3'), '/user/files/lore-manager-translation-3-1a24f65c34237384.json');
    assert.equal(path(''), null);
    assert.equal(path(null), null);
});

test('read only one current book file on demand with no-store and same-origin credentials', async () => {
    const { readManagerTranslationBook } = await api();
    const entry = { world: '일반 세계관', uid: 9, comment: 'Title', content: 'Original' };
    const data = snapshot(entry.world, entry);
    const calls = [];
    const request = async (url, options) => {
        calls.push([url, options]);
        return { ok: true, json: async () => data };
    };
    assert.deepEqual(await readManagerTranslationBook(entry.world, request, { 'X-Test': 'yes' }), data);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/user/files/lore-manager-translation-book-944d70c586b57a43.json');
    assert.deepEqual(calls[0][1], {
        method: 'GET', credentials: 'same-origin',
        headers: { 'X-Test': 'yes' }, cache: 'no-store',
    });
});

test('missing server file, error, wrong book and invalid formats fail closed', async () => {
    const { readManagerTranslationBook } = await api();
    const entry = { world: 'Book A', uid: 3, content: 'A', comment: 'X' };
    const valid = snapshot(entry.world, entry);
    const respond = value => async () => ({ ok: true, json: async () => value });
    for (const invalid of [
        { ...valid, book: 'Book B' }, { ...valid, revision: 0 },
        { ...valid, records: null }, { ...valid, pairs: [] },
        { ...valid, format: 'unsupported' },
    ]) assert.equal(await readManagerTranslationBook('Book A', respond(invalid)), null);
    assert.equal(await readManagerTranslationBook('Book A', async () => ({ ok: false, status: 404 })), null);
    assert.equal(await readManagerTranslationBook('Book A', async () => { throw Error('network'); }), null);
    assert.equal(await readManagerTranslationBook('Book A', async () => ({
        ok: true, json: async () => { throw Error('bad JSON'); },
    })), null);
    assert.equal(await readManagerTranslationBook('', async () => { throw Error('not called'); }), null);
});

test('display exactly matching title and fresh body from saved per-book file', async () => {
    const { managerTranslatedTitle, managerTranslatedBody } = await api();
    const entry = { world: 'Book A', uid: 7, comment: 'Shared title', content: 'A sentence' };
    const file = snapshot(entry.world, entry);
    assert.equal(managerTranslatedTitle(entry, file, null), '번역한 제목');
    assert.equal(managerTranslatedBody(entry, file, null), '번역한 본문');
    // The same UID and title in a different lorebook must not borrow A's record.
    assert.equal(managerTranslatedBody({ ...entry, world: 'Book B' }, file, null), null);
    assert.equal(managerTranslatedTitle({ ...entry, world: 'Book B' }, file, null), '');
});

test('stale body, changed title and conflicting language never render a wrong translation', async () => {
    const { managerTranslatedTitle, managerTranslatedBody } = await api();
    const entry = { world: 'Book A', uid: 1, comment: 'Original title', content: 'Original body' };
    const file = snapshot(entry.world, entry);
    assert.equal(managerTranslatedBody({ ...entry, content: 'Edited body' }, file, null), null);
    assert.equal(managerTranslatedTitle({ ...entry, comment: 'Edited title' }, file, null), '');
    const invalidLanguage = { ...file, pairs: {
        ['Book A\u241f1']: { translationLanguage: 'English' },
    } };
    assert.equal(managerTranslatedBody(entry, invalidLanguage, null), null);
    assert.equal(managerTranslatedTitle(entry, invalidLanguage, null), '');
});

test('English target and old settings records remain supported read-only', async () => {
    const { managerTranslatedTitle, managerTranslatedBody } = await api();
    const entry = { world: 'Book A', uid: 10, comment: '제목', content: '본문' };
    const file = snapshot(entry.world, entry);
    file.records['Book A\u241f10'].language = 'English';
    file.pairs['Book A\u241f10'].translationLanguage = 'English';
    file.records['Book A\u241f10'].text = 'Translated English';
    assert.equal(managerTranslatedBody(entry, file, null), 'Translated English');
    const legacy = {
        translations: { ['Book A\u241f10']: file.records['Book A\u241f10'] },
        entryLanguagePairs: { ['Book A\u241f10']: file.pairs['Book A\u241f10'] },
    };
    assert.equal(managerTranslatedBody(entry, null, legacy), 'Translated English');
    assert.equal(managerTranslatedTitle(entry, null, legacy), '번역한 제목');
});

test('viewer-only integration retains legacy and RT fallback; no background polling or watchers', () => {
    const index = readFileSync(join(root, 'index.js'), 'utf8');
    const helper = readFileSync(join(root, 'lore-manager-translations.js'), 'utf8');
    const manager = readFileSync(join(root, 'lore-library-link.js'), 'utf8');
    assert.match(index, /const \[data, translationFile\] = await Promise\.all\(/);
    assert.match(index, /hasManager[\s\S]*readManagerTranslationBook\(entry\.world/);
    assert.match(index, /displayWiTitle\(full, translationFile\)/);
    assert.match(index, /displayWiBody\(full, translationFile\)/);
    assert.match(index, /if \(managerText === source\) \{[\s\S]*rtTranslatedBody\(full\)/);
    assert.match(index, /linkLoreLibrary === true/);
    assert.doesNotMatch(helper, /MutationObserver|ResizeObserver|setInterval|setTimeout|localStorage|POST|PUT/);
    assert.doesNotMatch(manager, /MutationObserver|ResizeObserver|setInterval|setTimeout/);
    assert.equal(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version, '1.7.1-ambasa.4');
});
