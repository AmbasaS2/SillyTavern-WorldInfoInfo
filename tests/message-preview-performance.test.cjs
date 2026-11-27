const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
const start = source.indexOf('function messageRangeSentences(');
const end = source.indexOf('\nlet generationType;', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

test('message preview preserves the original first and last sentence exactly', () => {
    for (const text of [
        '', ' ', 'One sentence.', 'One. Two.', 'One. Two.  ',
        'First!\n\nSecond?\nThird.', 'Dr. A met Mr. B. Then they left.',
        '안녕. 오늘은 어때? 좋아!', '你好。再见。', '😀. 🦥!', 'No punctuation',
        'A. B. '.repeat(5000) + 'Last sentence!',
    ]) {
        const original = [...segmenter.segment(text)].map(it => it.segment.trim());
        const result = context.messageRangeSentences(segmenter, text);
        assert.equal(result.first, original.at(0), text.slice(0, 80));
        assert.equal(result.last, original.length > 1 ? original.at(-1) : null, text.slice(0, 80));
    }
});

test('both displayed message range paths use the bounded preview', () => {
    assert.equal((source.match(/const sentences = messageRangeSentences\(segmenter, text\);/g) || []).length, 2);
    assert.doesNotMatch(source, /\[\.\.\.segmenter\.segment\(text\)\]/);
});
