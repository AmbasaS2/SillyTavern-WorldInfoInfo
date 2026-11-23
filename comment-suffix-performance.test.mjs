import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Load the exact inline helper shipped by the extension instead of a duplicate implementation.
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const start = source.indexOf('const sanitizeComment = (s) =>');
const end = source.indexOf(';\n', start);
assert.ok(start !== -1 && end > start, 'WorldInfo report helper must be present');
const sanitizeComment = vm.runInNewContext(
  '(' + source.slice(start + 'const sanitizeComment = '.length, end) + ')'
);

const legacy = s => typeof s === 'string'
  ? s.replace(/\s*-\s*S[0-9][0-9A-Za-z.\-]*\s*$/, '').trim()
  : '';

test('WorldInfo report suffixes and unusual whitespace keep their original formatting', () => {
  const examples = [
    ['The Owlery - S2', 'The Owlery'],
    ['  The Owlery   -   S17.2  ', 'The Owlery'],
    ['A\n-\nS12\n', 'A'],
    ['- S9', ''],
    ['S12', 'S12'],
    ['A - S1 notes', 'A - S1 notes'],
    ['A - S1---', 'A'],
    ['The Owlery   ', 'The Owlery'],
    ['', ''],
    [null, ''],
    [21, '']
  ];
  for (const [input, expected] of examples) {
    assert.equal(sanitizeComment(input), expected, JSON.stringify(input));
    assert.equal(sanitizeComment(input), legacy(input));
  }
});

test('WorldInfo comment normalization has identical results for 50,000 varied inputs', () => {
  let seed = 20261123;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const alphabet = ['S', '0', '4', 'A', 'a', '9', '.', '-', ' ', '\t', '\n', '\r', 'x', '가', '🧭'];
  for (let i = 0; i < 50_000; i++) {
    let value = '';
    const count = Math.floor(next() * 128);
    for (let j = 0; j < count; j++) value += alphabet[Math.floor(next() * alphabet.length)];
    assert.equal(sanitizeComment(value), legacy(value), 'sample ' + i);
  }
});

test('WorldInfo report ignores adversarial 30k whitespace quickly', () => {
  const input = ' '.repeat(30_000) + 'X';
  const startTime = performance.now();
  assert.equal(sanitizeComment(input), 'X');
  assert.ok(performance.now() - startTime < 500, 'Long report titles must not stall the UI');
});
