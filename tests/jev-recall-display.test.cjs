const test = require('node:test');
const assert = require('node:assert/strict');

const key = (world, uid) => JSON.stringify([world, uid]);
const entry = (world, uid, extra = {}) => ({ world, uid, constant: false, vectorized: false, decorators: ['@@activate'], ...extra });
const marked = e => e.stwiiJevRecall === true;
async function create() {
    const { createJevRecallReceipts } = await import('../jev-recall-display.js');
    return createJevRecallReceipts();
}

test('marks only STLO-selected entries surviving the actual activation event, across books with duplicate UIDs', async () => {
    const r = await create();
    const lists = {};
    const a = entry('Memory A', 5), b = entry('World lore', 5);
    const c = entry('Other book', 5), constant = entry('Memory A', 7, { constant: true });
    r.record(lists, new Set([key('Memory A', 5), key('World lore', 5), key('Memory A', 8), key('Memory A', 7)]));
    r.consume(lists);
    const actual = [a, b, c, constant].map(e => r.annotate(e));
    assert.deepEqual(actual.filter(marked).map(e => [e.world, e.uid]), [['Memory A', 5], ['World lore', 5]]);
    assert.equal(actual.length, 4);
    assert.equal(a.stwiiJevRecall, undefined);
});

test('STLO receipts work before or after the receiver sees the same event payload', async () => {
    const r = await create();
    const first = {}, second = {};
    const a = entry('A', 2);
    r.record(first, new Set([key('A', 2)]));
    r.consume(first);
    assert.equal(marked(r.annotate(a)), true);
    r.consume(second);
    assert.equal(marked(r.annotate(a)), false);
    r.record(second, new Set([key('A', 2)]));
    assert.equal(marked(r.annotate(a)), true);
    r.record(first, new Set([key('B', 3)]));
    assert.equal(marked(r.annotate(entry('B', 3))), false);
    assert.equal(marked(r.annotate(a)), true);
});

test('no receipt, native decorator, disabled entries, invalid IDs and former Memory Books API do not mark', async () => {
    const r = await create(), lists = {};
    const a = entry('A', 5);
    assert.equal(r.record(null, new Set([key('A', 5)])), false);
    assert.equal(r.record(lists, 'A', new Set([5])), false);
    r.consume(lists);
    assert.equal(marked(r.annotate(a)), false);
    r.record(lists, new Set([key('A', '5'), key('A', null), key('A', ''), key('A', -1), 'bad', null]));
    assert.equal(marked(r.annotate(a)), true);
    assert.equal(marked(r.annotate(entry('A', null))), false);
    assert.equal(marked(r.annotate(entry('A', 5, { decorators: [] }))), false);
    assert.equal(marked(r.annotate(entry('A', 5, { disable: true }))), false);
    assert.equal(marked(r.annotate(entry('A', 5, { constant: true }))), false);
    r.record(lists, new Set());
    assert.equal(marked(r.annotate(a)), false);
    assert.equal(marked(r.annotate({ ...a, stwiiJevRecall: true })), false);
});

test('chat/generation reset clears receipts but preserves displayed snapshots', async () => {
    const r = await create(), lists = {};
    const a = entry('A', 5);
    r.record(lists, new Set([key('A', 5)]));
    r.consume(lists);
    const displayed = r.annotate(a);
    r.reset();
    r.consume(lists);
    assert.equal(marked(r.annotate(a)), false);
    assert.equal(marked(displayed), true);
});

test('production bridge is event-scoped, tears down all activation hooks, and adds no background work',()=>{
    const fs=require('node:fs'), path=require('node:path');
    const code=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
    const helper=fs.readFileSync(path.join(__dirname,'../jev-recall-display.js'),'utf8');
    assert.match(code,/STWII\.recordStloJevRecall = recordStloJevRecall/);
    assert.match(code,/onGenerationStopped = \(\) => \{[\s\S]*?realGenerationInProgress = false/);
    for(const event of ['WORLDINFO_ENTRIES_LOADED','WORLD_INFO_ACTIVATED','GENERATE_AFTER_DATA','CHAT_CHANGED','GENERATION_STOPPED']){
        assert.ok(code.includes('eventSource.removeListener?.(event_types.'+event+','));
    }
    assert.doesNotMatch(code,/\.difference\(/);
    assert.doesNotMatch(helper,/MutationObserver|ResizeObserver|setInterval|setTimeout|fetch\(/);
});
