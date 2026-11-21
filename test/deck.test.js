const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/deck.js');
const CARDS = require('../src/cards.js');

const mk = (...en) => en.map((e) => ({ ru: 'ru-' + e, en: e, ipa: '', read: '' }));
const K = (e) => e + '|ru-' + e;
const fixed = () => 0.5;

test('новая сессия содержит все слова ровно по одному разу', () => {
  const s = D.newSession(CARDS);
  assert.equal(D.total(s), 24);
  assert.equal(new Set(s.queue).size, 24);
  assert.equal(D.done(s), 0);
});

test('одинаковые слова в таблице не дублируются', () => {
  const s = D.newSession([...mk('a', 'b'), { ru: 'RU-A ', en: ' A', ipa: '', read: '' }]);
  assert.equal(D.total(s), 2);
});

test('переворот, транскрипция только на английской стороне и сбрасывается', () => {
  let s = D.newSession(mk('a', 'b'), fixed);
  assert.equal(D.toggleIpa(s).ipaShown, false, 'на русской стороне нельзя');
  s = D.toggleIpa(D.flip(s));
  assert.equal(s.ipaShown, true);
  s = D.flip(s);
  assert.equal(s.ipaShown, false);
  assert.equal(D.flip(s).ipaShown, false);
});

test('"Знаю" переносит слово в пройденные', () => {
  let s = D.newSession(mk('a', 'b', 'c'));
  const first = D.current(s);
  s = D.know(D.flip(s));
  assert.deepEqual(s.doneKeys, [first]);
  assert.equal(s.queue.includes(first), false);
  assert.equal(s.flipped, false);
});

test('"Не знаю" возвращает слово через 3 позиции', () => {
  const s = D.dontKnow({ queue: ['0', '1', '2', '3', '4', '5'], doneKeys: [], flipped: true, ipaShown: true });
  assert.deepEqual(s.queue, ['1', '2', '3', '0', '4', '5']);
  assert.equal(s.flipped, false);
  assert.deepEqual(D.dontKnow({ queue: ['x', 'y'], doneKeys: [], flipped: false, ipaShown: false }).queue, ['y', 'x']);
});

test('конец колоды: действия ничего не меняют', () => {
  let s = D.newSession(mk('a', 'b'));
  s = D.know(D.know(s));
  assert.ok(D.isFinished(s));
  assert.equal(D.current(s), null);
  for (const f of [D.know, D.dontKnow, D.flip, D.toggleIpa]) assert.deepEqual(f(s), s);
});

test('новые слова из таблицы добавляются, пройденные не сбрасываются', () => {
  let s = D.newSession(mk('a', 'b', 'c'), fixed);
  s = D.know(s);
  const doneKey = s.doneKeys[0];
  const m = D.merge(s, mk('a', 'b', 'c', 'd', 'e'), fixed);
  assert.deepEqual(m.doneKeys, [doneKey]);
  assert.equal(D.total(m), 5);
  assert.ok(m.queue.includes(K('d')) && m.queue.includes(K('e')));
  assert.equal(m.queue.includes(doneKey), false);
});

test('удаленные из таблицы слова исчезают из очереди и пройденных', () => {
  let s = D.newSession(mk('a', 'b', 'c'), fixed);
  s = D.know(s);
  const m = D.merge(s, mk('a'), fixed);
  assert.equal(D.total(m), 1);
  assert.deepEqual([...m.queue, ...m.doneKeys], [K('a')]);
});

test('если текущее слово осталось первым, переворот сохраняется', () => {
  const s = { queue: [K('a'), K('b')], doneKeys: [], flipped: true, ipaShown: true };
  const m = D.merge(s, mk('a', 'b'));
  assert.equal(m.flipped, true);
  assert.equal(D.merge(s, mk('b')).flipped, false);
});

test('сохранение и восстановление прогресса', () => {
  let s = D.know(D.newSession(CARDS));
  const r = D.restore(D.serialize(s), CARDS);
  assert.deepEqual(r.queue, s.queue);
  assert.deepEqual(r.doneKeys, s.doneKeys);
});

test('испорченное сохранение отбрасывается', () => {
  assert.equal(D.restore('мусор', CARDS), null);
  assert.equal(D.restore(JSON.stringify({ total: 3, queue: [0], done: 1 }), CARDS), null, 'старый формат');
  assert.equal(D.restore(JSON.stringify({ v: 2, queue: ['a', 'a'], doneKeys: [] }), CARDS), null);
  assert.equal(D.restore(JSON.stringify({ v: 2, queue: [1], doneKeys: [] }), CARDS), null);
});

test('встроенные слова: 24, у каждого русский и английский, 3 без транскрипции', () => {
  assert.equal(CARDS.length, 24);
  for (const c of CARDS) assert.ok(c.ru.trim() && c.en.trim());
  assert.equal(CARDS.filter((c) => !D.hasIpa(c)).length, 3);
});
