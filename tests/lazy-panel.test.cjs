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
        syncTokenFooter() {},wiT:key=>key,
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
    assert.equal(h.context.panel.textContent, 'panel.noneVerified');
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

test('unrelated idle generation stop preserves the last verified display and diagnostic state', () => {
    const calls = [];
    const context = vm.createContext({
        realGenerationInProgress: false, tokenGenerationAwaitingEnd: false,
        tokenSummaryRequest: 4, tokenSummaryPending: -1, tokenSummary: { count: 42 },
        finalizedTokenGeneration: 5, pendingEntries: [], noteBeforeScan: 'note',
        insight: { clear() { calls.push('insight'); } },
        insightTokens: { clear() { calls.push('tokens'); } },
        resetJevRecall() { calls.push('jev'); },
        releaseWorldInfoConsoleCapture() { calls.push('console'); },
        releasePromptTrace() { calls.push('trace'); },
        renderGenerationEntries(list) { calls.push('render'); assert.equal(list.length, 0); },
        syncTokenFooter() { calls.push('footer'); },
    });
    vm.runInContext(extract('    const onGenerationStopped = () => {',
        '    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);') +
        '\nthis.stop = onGenerationStopped;', context);
    context.stop();
    assert.equal(calls.length, 0);
    assert.equal(context.tokenSummary.count, 42);
    assert.equal(context.finalizedTokenGeneration, 5);
    assert.equal(context.noteBeforeScan, 'note');
    context.tokenGenerationAwaitingEnd = true;
    context.stop();
    assert.deepEqual(calls, ['insight', 'tokens', 'jev', 'console', 'trace', 'render', 'footer']);
    assert.equal(context.tokenSummary, null);
    assert.equal(context.tokenGenerationAwaitingEnd, false);
    context.stop();
    assert.equal(calls.length, 7);
    context.realGenerationInProgress = true;
    context.stop();
    assert.equal(context.realGenerationInProgress, false);
    assert.equal(calls.length, 14);
});


test('unrelated completion cannot release an in-progress visible reply capture', () => {
    const calls = [];
    const context = vm.createContext({
        realGenerationInProgress: true, tokenGenerationAwaitingEnd: true,
        generationSerial: 5, finalizedTokenGeneration: -1, noteBeforeScan: 'scan note',
        releaseWorldInfoConsoleCapture() { calls.push('console'); },
        releasePromptTrace() { calls.push('trace'); },
        insight: { ready() { calls.push('ready'); } },
        syncTokenFooter() { calls.push('footer'); },
        panel: { classList: { contains: () => false } },
        scheduleTokenSummary() { calls.push('count'); },
    });
    vm.runInContext(extract('    const onCompletedGeneration = () => {',
        '    eventSource.on(event_types.GENERATION_ENDED, onCompletedGeneration);') +
        '\nthis.complete = onCompletedGeneration;', context);
    context.complete();
    assert.deepEqual(calls, []);
    assert.equal(context.noteBeforeScan, 'scan note');
    assert.equal(context.tokenGenerationAwaitingEnd, true);
    context.realGenerationInProgress = false;
    context.finalizedTokenGeneration = 5;
    context.complete();
    assert.deepEqual(calls, ['console', 'trace', 'ready', 'footer']);
    assert.equal(context.tokenGenerationAwaitingEnd, false);
    context.complete();
    assert.equal(calls.length, 4);
});

test('console capture checks source stacks only for potential World Info messages and restores methods',()=>{
 const received=[],captures=[];let stackReads=0,caller='https://host/other.js:5';
 const fakeConsole={log(...args){received.push(args);},debug(...args){received.push(args);}};
 const originalLog=fakeConsole.log,originalDebug=fakeConsole.debug;
 const ctx=vm.createContext({console:fakeConsole,realGenerationInProgress:true,stopConsoleCapture:null,
   worldInfoLogSources:['https://host/world-info.js'],
   Error:class {get stack(){stackReads++;return 'Error\n    at captureWorldInfoConsole (extension.js:1)\n    at '+caller;}},
   captureDebug(fn,...args){captures.push(args);return fn.apply(fakeConsole,args);},
   captureLog(fn,...args){captures.push(args);return fn.apply(fakeConsole,args);},
   releaseWorldInfoConsoleCapture(){ctx.stopConsoleCapture?.();ctx.stopConsoleCapture=null;}
 });
 vm.runInContext(extract('    function startWorldInfoConsoleCapture()', '// Optional teardown')+'\nthis.start=startWorldInfoConsoleCapture;',ctx);
 ctx.start();fakeConsole.log('ordinary log');fakeConsole.debug({arbitrary:true});
 assert.equal(stackReads,0);
 fakeConsole.log('[WI] fake source');assert.equal(stackReads,1);assert.equal(captures.length,0);
 caller='https://host/world-info.js:19';
 fakeConsole.debug('[WI] real source');assert.equal(stackReads,2);assert.equal(captures.length,1);
 assert.equal(received.length,4);
 ctx.releaseWorldInfoConsoleCapture();assert.equal(fakeConsole.log,originalLog);assert.equal(fakeConsole.debug,originalDebug);
});


test('failed optional token count can retry on reopen, successful count is reused', async () => {
    const pending = [], entry = { type: 'wi' };
    let calls = 0;
    const context = vm.createContext({
        generationSerial: 1, finalizedTokenGeneration: 1, tokenSummary: null,
        tokenSummaryPending: -1, tokenSummaryRequest: 0, realGenerationInProgress: false,
        tokenGenerationAwaitingEnd: false, currentEntryList: [entry],
        confirmedRenderedEntries: new Map([[entry, 'lore text']]),
        panel: { classList: { contains: () => true } },
        getCurrentChatId: () => 'chat-a', showTokenTotal: () => true,
        syncTokenFooter() {}, ensurePanelsVisible() {},
        requestAnimationFrame: fn => fn(), setTimeout: fn => pending.push(fn),
        insightTokens: { async countText() { if (++calls === 1) throw Error('temporary failure'); return 123; } },
    });
    vm.runInContext(extract('    function scheduleTokenSummary() {', '    // This is the exact number'), context);
    context.scheduleTokenSummary();
    context.scheduleTokenSummary();
    assert.equal(pending.length, 1);
    await pending.shift()();
    assert.equal(context.tokenSummary.count, null);
    context.scheduleTokenSummary();
    assert.equal(pending.length, 1);
    await pending.shift()();
    assert.equal(context.tokenSummary.count, 123);
    context.scheduleTokenSummary();
    assert.equal(pending.length, 0);
    assert.equal(calls, 2);
});
