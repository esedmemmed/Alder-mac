import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cls, lastIndexWhere } from '../../src/lib/dom.js';

test('cls joins strings, arrays and objects, dropping falsy values', () => {
  assert.equal(cls('a', false, null, undefined, '', 'b'), 'a b');
  assert.equal(cls(['a', ['b', 'c']], { d: true, e: 0, f: 'yes' }), 'a b c d f');
  assert.equal(cls(), '');
  assert.equal(cls([]), '');
});

test('lastIndexWhere searches from the end', () => {
  assert.equal(lastIndexWhere([1, 2, 3, 2], (x) => x === 2), 3);
  assert.equal(lastIndexWhere([1, 2, 3], (x) => x > 5), -1);
  assert.equal(lastIndexWhere([], () => true), -1);
});
