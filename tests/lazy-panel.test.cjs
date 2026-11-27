const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
function extract(start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return source.slice(a, b);
}
function fixture() {
    const renders = [], badges = [];
    let open = false;
    const chat = [{ mes: 'old message' }, { mes: 'swiped message' }];
    const context = vm.createContext({
        chat, generationType: 'swipe', generationSerial: 1,
        chat_metadata: { note: 'scan note', depth: 4 },
        metadata_keys: { prompt: 'note', depth: 'depth' },
        currentEntryList: [], currentChat: [], currentChatNote: '', currentChatNoteDepth: undefined,
        panelNeedsRender: false, lastRenderedGenerationEntries: null, tokenFooter: null,
        panel: { textContent: '', classList: { contains: () => open } },
        syncTokenFooter() {},
        updateBadge(ids) { badges.push(Array.from(ids)); },
        renderPanelContents(list) {
            renders.push({ ids: Array.from(list, e => e.uid),
                messages: Array.from(context.currentChat, m => m.mes),
                note: context.currentChatNote, depth: context.currentChatNoteDepth });
        },
    });
    vm.runInContext(extract('    function renderGenerationEntries(list)', '\n    const beginRealGeneration') +
        extract('    function updatePanel(entryList', '\n    const renderPanelContents'), context);
    return {
        context, renders, badges,
        activate(list) { context.renderGenerationEntries(list); },
        open() { open = true; if (context.panelNeedsRender) context.updatePanel(context.currentEntryList); },
        close() { open = false; },
    };
}
const entry = uid => ({ world: 'Book', uid, sticky: 0 });
test('hidden scans update the badge, not the detail DOM; opening uses the latest scan snapshot', () => {
    const h = fixture();
    h.activate([entry(1)]);
    h.activate([entry(1)]);
    h.activate([entry(1), entry(2)]);
    assert.equal(h.renders.length, 0);
    assert.equal(h.badges.length, 2);
    h.context.chat[0].mes = 'edited after scan';
    h.context.chat.push({ mes: 'new reply' });
    h.context.chat_metadata.note = 'changed after scan';
    h.open();
    assert.deepEqual(h.renders, [{ ids: [1, 2], messages: ['old message'], note: 'scan note', depth: 4 }]);
    h.close(); h.open();
    assert.equal(h.renders.length, 1);
    h.activate([entry(3)]);
    assert.equal(h.renders.length, 2);
    h.close();
    h.activate([]);
    h.open();
    assert.equal(h.renders.length, 2);
    assert.equal(h.context.panel.textContent, '?');
});
test('closed settings changes defer repaint; the open trigger flushes before positioning', () => {
    const h = fixture();
    h.activate([entry(1)]); h.open(); h.close();
    h.context.updatePanel(h.context.currentEntryList);
    assert.equal(h.renders.length, 1);
    h.open();
    assert.equal(h.renders.length, 2);
    assert.match(source, /if \(opened && panelNeedsRender\) updatePanel\(currentEntryList\);\s*requestAnimationFrame\(ensurePanelsVisible\)/);
});
