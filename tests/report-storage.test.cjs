const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const root = join(__dirname, '..');
const api = () => import(pathToFileURL(join(root, 'report-storage.js')).href);
const js = readFileSync(join(root, 'index.js'), 'utf8');
const legacyKeys = ['stwiiBuilds', 'stwiiActivationEvents', 'stwiiLastLoopCounts', 'stwiiLastLoopEntryIds', 'stwiiLastAddedCount'];

function legacyMetadata() {
    return {
        timedWorldInfo: { sticky: { 'Book.1': { end: 5 } } },
        STMemoryBooks: { linked: true }, otherExtension: { keep: ['untouched'] },
        stwiiBuilds: Array.from({ length: 5 }, () => ({ added: [], logs: Array(905).fill('A long diagnostic log from an older version.') })),
        stwiiActivationEvents: Array.from({ length: 988 }, (_, uid) => ({ world: 'Book', uid, comment: 'Old record' })),
        stwiiLastLoopCounts: [35], stwiiLastLoopEntryIds: [['Book:1']], stwiiLastAddedCount: 35,
        stwiiLastReport: { runId: 1, added: [], loopCounts: [], loopEntryIds: [] },
    };
}
function sampleEvents(n = 35) {
    return Array.from({ length: n }, (_, uid) => ({
        ts: 1795660680000, runId: 2, world: '마법사 세계관', uid,
        comment: '오래된 사건과 인물 관계에 대한 설정 ' + uid, constant: uid === 1,
        vectorized: uid === 2, keys: ['Remus', 'Hogwarts', '리무스', '호그와트', '마루더즈'],
        primary: '리무스', secondary: ['호그와트'], logic: 'AND_ANY', vectorConfirmed: uid === 2, reason: 'primary',
        ...(uid === 3 ? { jevConfirmed: true } : {}),
    }));
}
function fullReport(n) {
    const added = sampleEvents(n);
    const a = Math.floor(n / 2);
    return { runId: 2, added, logs: ['do not persist'], chatId: 'test',
        loopCounts: [a, n - a],
        loopEntryIds: [added.slice(0, a), added.slice(a)].map(group => group.map(e => e.world + ':' + e.uid)) };
}
test('complete scan atomically replaces legacy fields, and leaves unrelated metadata unchanged', async () => {
    const { persistReport, reportBytes, REPORT_MAX_BYTES } = await api();
    const metadata = legacyMetadata();
    const before = structuredClone(metadata);
    const report = fullReport(53);
    const snapshot = structuredClone(report);
    assert.equal(persistReport(metadata, report, true), true);
    for (const key of legacyKeys) assert.ok(!Object.hasOwn(metadata, key));
    for (const key of ['timedWorldInfo', 'STMemoryBooks', 'otherExtension']) assert.deepEqual(metadata[key], before[key]);
    assert.deepEqual(report, snapshot);
    assert.equal(metadata.stwiiLastReport.added.length, 53);
    assert.deepEqual(metadata.stwiiLastReport.loopEntryIds, report.loopEntryIds);
    assert.equal(Object.hasOwn(metadata.stwiiLastReport, 'logs'), false);
    assert.equal(Object.hasOwn(metadata.stwiiLastReport.added[0], 'runId'), false);
    assert.equal(Object.hasOwn(metadata.stwiiLastReport.added[0], 'ts'), false);
    assert.equal(metadata.stwiiLastReport.added[3].jevConfirmed, true);
    assert.ok(reportBytes(metadata.stwiiLastReport) < REPORT_MAX_BYTES);
    const firstSize = JSON.stringify(metadata).length;
    for (let i = 0; i < 100; i++) persistReport(metadata, report, true);
    assert.equal(JSON.stringify(metadata).length, firstSize);
});
test('failed or incomplete capture cannot overwrite any saved metadata', async () => {
    const { persistReport, canReplaceReport } = await api();
    const metadata = legacyMetadata();
    const before = structuredClone(metadata);
    const build = { ...fullReport(35), startedFromScan: true, finished: true, finalCount: 35 };
    const candidates = build.added.map(e => ({ world: e.world, uid: e.uid }));
    assert.equal(canReplaceReport(build, 35, candidates), true);
    for (const [b, observed, c] of [
        [null, null, []], [{ ...build, finished: false }, 35, candidates],
        [{ ...build, startedFromScan: false }, 35, candidates],
        [{ ...build, added: build.added.slice(1) }, 35, candidates],
        [{ ...build, loopCounts: [] }, 35, candidates],
        [{ ...build, finalCount: null }, 35, candidates],
        [build, 34, candidates], [build, 35, candidates.slice(1)],
        [{ ...build, finalCount: 0 }, 35, candidates],
    ]) {
        assert.equal(canReplaceReport(b, observed, c), false);
        assert.equal(persistReport(metadata, build, false), false);
        assert.deepEqual(metadata, before);
    }
    assert.throws(() => persistReport(metadata, { added: null }, true));
    assert.deepEqual(metadata, before);
});
test('an explicitly completed empty scan can retire old records, but an unverified empty capture cannot', async () => {
    const { canReplaceReport, persistReport } = await api();
    const metadata = legacyMetadata();
    const build = { ...fullReport(0), startedFromScan: true, finished: true, finalCount: 0 };
    assert.equal(canReplaceReport(build, null, []), true);
    assert.equal(canReplaceReport({ ...build, finalCount: null }, null, []), false);
    assert.equal(persistReport(metadata, build, true), true);
    assert.deepEqual(metadata.stwiiLastReport.added, []);
    for (const key of legacyKeys) assert.ok(!Object.hasOwn(metadata, key));
});
test('UTF-8 cap preserves full live report and does not split individual entries', async () => {
    const { compactReport, reportBytes, REPORT_MAX_BYTES } = await api();
    const full = fullReport(1500);
    const snapshot = structuredClone(full);
    const compact = compactReport(full);
    assert.equal(compact.truncated, true);
    assert.ok(compact.added.length > 0 && compact.added.length < full.added.length);
    assert.ok(reportBytes(compact) <= REPORT_MAX_BYTES);
    assert.equal(reportBytes(compact), Buffer.byteLength(JSON.stringify({ stwiiLastReport: compact }), 'utf8'));
    assert.deepEqual(full, snapshot);
    const ids = new Set(compact.added.map(e => e.world + ':' + e.uid));
    assert.ok(compact.loopEntryIds.flat().every(id => ids.has(id)));
    assert.deepEqual(compact.loopCounts, compact.loopEntryIds.map(g => g.length));
    assert.equal(compact.loopCounts.reduce((a, b) => a + b, 0), compact.added.length);
    const huge = fullReport(1);
    huge.added[0].comment = '한😀'.repeat(40000);
    const empty = compactReport(huge);
    assert.equal(empty.truncated, true);
    assert.equal(empty.added.length, 0);
    assert.ok(reportBytes(empty) <= REPORT_MAX_BYTES);
});
test('partial report omits unknown loop membership rather than misassigning entries', async () => {
    const { compactReport } = await api();
    const report = fullReport(1000);
    report.loopEntryIds[0] = null;
    const compact = compactReport(report);
    assert.equal(compact.truncated, true);
    assert.deepEqual(compact.loopCounts, []);
    assert.deepEqual(compact.loopEntryIds, []);
});

function between(start, end) {
    const a = js.indexOf(start), b = js.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    return js.slice(a, b);
}
async function harness() {
    const { canReplaceReport, persistReport } = await api();
    const metadata = legacyMetadata();
    const ctx = vm.createContext({
        chat_metadata: metadata, STWII: { MAX_BUILD_LOGS: 2000 }, window: { STWII: {} },
        getCurrentChatId: () => 'test', canReplaceReport, persistReport, console: { warn() {} },
        realGenerationInProgress: true, stwiiCurrentBuild: null, lastReportBuild: null, lastLiveReport: null,
        observedActivatedCount: null, pendingEntries: [], stwiiCurrentScanMessageCount: null,
        stwiiCurrentLoopCounts: null, stwiiCurrentLoopEntryIds: null, stwiiCurrentLoopEventIds: null,
        stwiiActiveLoopIndex: -1, stwiiDryRunActive: false,
        generationSerial: 1, finalizedTokenGeneration: -1, displayedActivationEvents: new WeakMap(),
        confirmedWiEntries: list => list, world_info_position: { outlet: 7 },
        renderedWiContent: e => e.content, jevRecall: { annotate: e => ({ ...e }), reset() {} },
        renderGenerationEntries(list) { ctx.visible = list; },
        syncTokenFooter() {}, releaseWorldInfoConsoleCapture() {},
        noop() {},
    });
    vm.runInContext(
        between('function pushBounded(', '\nconst strategy = {') +
        between('function startBuildSession(', '    const worldInfoLogSources =') +
        between('    function captureDebug(', '    function startWorldInfoConsoleCapture(') +
        between('    const onWorldInfoActivated =', '    eventSource.on(event_types.WORLD_INFO_ACTIVATED,') +
        between('    const onGenerateAfterData =', '    eventSource.on(event_types.GENERATE_AFTER_DATA,'), ctx);
    return {
        ctx, metadata,
        debug: (...args) => ctx.captureDebug(ctx.noop, ...args),
        log: (...args) => ctx.captureLog(ctx.noop, ...args),
        activate: list => vm.runInContext('onWorldInfoActivated', ctx)(list),
        finalize: (dryRun = false) => vm.runInContext('onGenerateAfterData', ctx)({ prompt: 'test' }, dryRun),
    };
}
test('mixed real engine debug/log sequence stores one complete report without intermediate writes', async () => {
    const h = await harness();
    const before = structuredClone(h.metadata);
    const entries = sampleEvents(3).map(e => ({ ...e, content: 'Lore', position: 0 }));
    h.debug('[WI] --- START WI SCAN (on 12 messages, trigger = normal) ---');
    for (const e of entries) {
        h.debug("[WI] Entry " + e.uid + " from '" + e.world + "' processing ...");
        h.debug('[WI] Entry ' + e.uid, 'activated by primary key match', '리무스');
        h.debug('[WI] Entry ' + e.uid + ' activation successful, adding to prompt', e);
    }
    h.debug('[WI] Successfully activated 3 new entries to prompt. 3 total entries activated.', entries);
    h.debug('[WI] --- BUILDING PROMPT ---');
    h.log('[WI] Adding 3 entries to prompt', entries);
    h.debug('[WI] --- DONE ---');
    h.activate(entries);
    assert.deepEqual(h.metadata, before);
    h.finalize();
    assert.equal(h.ctx.lastLiveReport.incomplete, false);
    assert.equal(h.metadata.stwiiLastReport.added.length, 3);
    assert.equal(h.metadata.stwiiLastReport.loopCounts[0], 3);
    assert.equal(h.metadata.stwiiLastReport.loopEntryIds[0].length, 3);
    assert.equal(h.ctx.displayedActivationEvents.get(h.ctx.visible[0]).uid, entries[0].uid);
    for (const key of legacyKeys) assert.ok(!Object.hasOwn(h.metadata, key));
});
test('dry-run and missing activation diagnostics do not delete or overwrite legacy logs', async () => {
    const h = await harness();
    const before = structuredClone(h.metadata);
    const entries = [{ ...sampleEvents(1)[0], content: 'Lore', position: 0 }];
    h.debug('[WI] --- START WI SCAN (on 12 messages, trigger = normal) (DRY RUN) ---');
    h.log('[WI] Hypothetically adding 1 entries to prompt', entries);
    h.debug('[WI] --- DONE (DRY RUN) ---');
    h.finalize(true);
    assert.deepEqual(h.metadata, before);
    h.debug('[WI] --- START WI SCAN (on 12 messages, trigger = normal) ---');
    h.debug('[WI] Successfully activated 1 new entries to prompt. 1 total entries activated.', entries);
    h.log('[WI] Adding 1 entries to prompt', entries);
    h.debug('[WI] --- DONE ---');
    h.activate(entries);
    h.finalize();
    assert.equal(h.ctx.lastLiveReport.incomplete, true);
    assert.deepEqual(h.metadata, before);
    assert.equal(h.ctx.displayedActivationEvents.get(h.ctx.visible[0]), null);
});
test('report UI uses full session report and shows storage or capture warning in all locales', () => {
    assert.match(js, /const freshMemory = lastLiveReport\?\.chatId === getCurrentChatId\(\)/);
    assert.match(js, /displayedActivationEvents\.has\(entry\)/);
    assert.match(js, /lastBuild\?\.truncated \|\| lastBuild\?\.incomplete/);
    for (const name of readdirSync(join(root, 'i18n')).filter(n => n.endsWith('.json'))) {
        const locale = JSON.parse(readFileSync(join(root, 'i18n', name), 'utf8'));
        assert.ok(locale['worldInfoInfo.report.truncated']);
        assert.ok(locale['worldInfoInfo.report.incomplete']);
    }
});
