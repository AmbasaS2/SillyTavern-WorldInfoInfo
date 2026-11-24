const test = require('node:test');
const assert = require('node:assert/strict');

test('only applied Jev IDs from the exact WI load are marked', async () => {
    const { createJevRecallReceipts } = await import('../jev-recall-display.js');
    const r = createJevRecallReceipts();
    const lists = {};
    const a = { world: 'Memory A', uid: 5, constant: true };
    const b = { world: 'Memory A', uid: 6, constant: true };
    const sameUidOtherWorld = { world: 'Memory B', uid: 5, constant: true };
    assert.equal(r.record(lists, 'Memory A', new Set([5, 8])), true);
    r.consume(lists);
    assert.deepEqual(r.annotate(a), { ...a, stwiiJevRecall: true });
    assert.deepEqual(r.annotate(b), b);
    assert.deepEqual(r.annotate(sameUidOtherWorld), sameUidOtherWorld);
    assert.equal(a.stwiiJevRecall, undefined);
    // The other selected candidate is never added to the activated list.
    assert.equal([a, b].map(e => r.annotate(e)).filter(e => e.stwiiJevRecall).length, 1);
});

test('native activation, invalid IDs, unrelated scans and reset cannot inherit Jev evidence', async () => {
    const { createJevRecallReceipts } = await import('../jev-recall-display.js');
    const r = createJevRecallReceipts();
    const lists = {};
    const a = { world: 'Memory A', uid: 5, constant: true };
    assert.equal(r.record(null, 'Memory A', [5]), false);
    r.record(lists, 'Memory A', ['5', null, '', -1, NaN]);
    r.consume({});
    assert.deepEqual(r.annotate(a), a);
    r.consume(lists);
    assert.equal(r.annotate(a).stwiiJevRecall, true);
    assert.equal(r.annotate({ ...a, constant: false }).stwiiJevRecall, undefined);
    assert.equal(r.annotate({ ...a, disable: true }).stwiiJevRecall, undefined);
    assert.equal(r.annotate({ ...a, uid: null }).stwiiJevRecall, undefined);
    r.consume(lists);
    assert.deepEqual(r.annotate(a), a);
    r.record(lists, 'Memory A', [5]);
    r.reset();
    r.consume(lists);
    assert.deepEqual(r.annotate(a), a);
    assert.equal(r.annotate({ ...a, stwiiJevRecall: true }).stwiiJevRecall, undefined);
});

test('a later WI load without a receipt clears an earlier selection', async () => {
    const { createJevRecallReceipts } = await import('../jev-recall-display.js');
    const r = createJevRecallReceipts();
    const lists = {};
    const entry = { world: 'Memory', uid: 1, constant: true };
    r.record(lists, 'Memory', [1]);
    r.consume(lists);
    const displayed = r.annotate(entry);
    r.consume({});
    assert.equal(r.annotate(entry).stwiiJevRecall, undefined);
    // Previously displayed copy remains stable during unrelated scans.
    assert.equal(displayed.stwiiJevRecall, true);
});
