const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const loadClient = async () => import(pathToFileURL(join(root, 'lore-library-link.js')).href);

test('opt-in defaults to native viewer even if the library bridge exists', async () => {
    const { tryOpenInLoreLibrary } = await loadClient();
    let calls = 0;
    const bridge = { apiVersion: 1, async openEntry() { calls++; return true; } };
    assert.equal(await tryOpenInLoreLibrary({ world: 'Book', uid: 7 }, false, bridge), false);
    assert.equal(calls, 0);
});

test('uninstalled, unsupported, or invalid bridge falls back without throwing', async () => {
    const { tryOpenInLoreLibrary } = await loadClient();
    const entry = { world: 'Book', uid: 7 };
    assert.equal(await tryOpenInLoreLibrary(entry, true, null), false);
    assert.equal(await tryOpenInLoreLibrary(entry, true, { apiVersion: 2, openEntry() { return true; } }), false);
    assert.equal(await tryOpenInLoreLibrary(entry, true, { apiVersion: 1 }), false);
    assert.equal(await tryOpenInLoreLibrary({ world: 'Book', uid: '../3' }, true,
        { apiVersion: 1, openEntry() { throw Error('must not run'); } }), false);
});

test('bridge gets exact lorebook name and UID, never a translated title', async () => {
    const { tryOpenInLoreLibrary } = await loadClient();
    const calls = [];
    const bridge = { apiVersion: 1, async openEntry(target) { calls.push(target); return true; } };
    assert.equal(await tryOpenInLoreLibrary({ world: 'Book A', uid: 12, comment: 'Same title' }, true, bridge), true);
    assert.equal(await tryOpenInLoreLibrary({ world: 'Book B', uid: 12, comment: 'Same title' }, true, bridge), true);
    assert.deepEqual(calls, [{ book: 'Book A', uid: 12 }, { book: 'Book B', uid: 12 }]);
});

test('navigation refusal, async error and non-true results fall back to native reader', async () => {
    const { tryOpenInLoreLibrary } = await loadClient();
    const e = { world: 'Book', uid: 0 };
    assert.equal(await tryOpenInLoreLibrary(e, true, { apiVersion: 1, async openEntry() { return false; } }), false);
    assert.equal(await tryOpenInLoreLibrary(e, true, { apiVersion: 1, async openEntry() { throw Error('offline'); } }), false);
    assert.equal(await tryOpenInLoreLibrary(e, true, { apiVersion: 1, async openEntry() { return 'true'; } }), false);
});

test('UI toggle is Korean, off by default and click/keyboard paths use the same fallback', () => {
    const js = readFileSync(join(root, 'index.js'), 'utf8');
    const ko = JSON.parse(readFileSync(join(root, 'i18n/ko-kr.json'), 'utf8'));
    assert.equal(ko['worldInfoInfo.settings.library.label'], '로어북 서가 연동');
    assert.match(js, /linkLoreLibrary === true/);
    assert.match(js, /worldInfoInfo\.linkLoreLibrary = cb\.checked/);
    assert.match(js, /e\.addEventListener\('click', \(\) => void showInjectedLore\(entry\)\)/);
    assert.match(js, /void showInjectedLore\(entry\);/);
    assert.match(js, /if \(opened\) closeLoreViewer\(\);\s*else void showLoreViewer\(entry\);/);
    assert.doesNotMatch(js, /setInterval\([^)]*__slbLoreLibraryBridge/);
});
