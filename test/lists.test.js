const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lists.js');

const c = (en, ...lists) => ({ ru: 'ru-' + en, en, ipa: '', read: '', lists });
const cards = [c('a', 'NNN'), c('b', 'Урок 5', 'NNN'), c('c'), c('d', 'Урок 5')];

test('меню: все слова, списки в порядке появления, без списка в конце', () => {
  assert.deepEqual(L.menuItems(cards), [L.ALL, 'NNN', 'Урок 5', L.NONE]);
});

test('если списков нет вообще, в меню только "Все слова"', () => {
  assert.deepEqual(L.menuItems([c('a'), c('b')]), [L.ALL]);
});

test('"Без списка" не показывается, если у всех слов есть список', () => {
  assert.deepEqual(L.menuItems([c('a', 'X')]), [L.ALL, 'X']);
});

test('слова выбранного списка', () => {
  const en = (name) => L.cardsFor(cards, name).map((x) => x.en);
  assert.deepEqual(en(L.ALL), ['a', 'b', 'c', 'd']);
  assert.deepEqual(en('NNN'), ['a', 'b']);
  assert.deepEqual(en('Урок 5'), ['b', 'd']);
  assert.deepEqual(en(L.NONE), ['c']);
  assert.deepEqual(en('нет такого'), []);
});

test('названия пунктов', () => {
  assert.equal(L.label(L.ALL), 'Все слова');
  assert.equal(L.label(L.NONE), 'Без списка');
  assert.equal(L.label('NNN'), 'NNN');
});
