const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/srs.js');

const mk = (...en) => en.map((e) => ({ ru: 'ru-' + e, en: e, ipa: '', read: '' }));
const K = (e) => e + '|ru-' + e;
const DAY = S.DAY;
const T0 = new Date(2026, 10, 21, 12, 0).getTime(); // 21.11.2026, полдень
const noShuffle = () => 0.999999;                    // shuffle оставляет порядок почти как есть

// "смахнуть", предварительно перевернув или нет
const swipeKnown = (s, p, t = T0) => S.swipe(s, p, t);
const swipeForgot = (s, p, t = T0) => S.swipe(S.flip(s), p, t);

test('новое занятие: все новые слова, счетчик с нуля', () => {
  const s = S.buildSession(mk('a', 'b', 'c'), {}, T0);
  assert.equal(s.total, 3);
  assert.equal(s.done, 0);
  assert.deepEqual([...s.queue].sort(), [K('a'), K('b'), K('c')]);
});

test('перевернул - значит не помню, даже если перевернул обратно', () => {
  let s = S.buildSession(mk('a'), {}, T0);
  s = S.flip(S.flip(s));
  assert.equal(s.flipped, false);
  assert.equal(s.revealed, true);
});

test('новое слово, смахнул не переворачивая: знал, следующий показ через 3 дня', () => {
  const s0 = S.buildSession(mk('a', 'b'), {}, T0, noShuffle);
  const first = S.current(s0);
  const { s, progress } = swipeKnown(s0, {});
  assert.equal(progress[first].lvl, 2);
  assert.equal(progress[first].due, T0 + 3 * DAY);
  assert.equal(s.done, 1);
  assert.equal(s.queue.includes(first), false);
});

test('не помню: слово возвращается через 3 карточки, затем через 7, потом завтра', () => {
  const words = mk('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l');
  let s = S.buildSession(words, {}, T0, noShuffle);
  let p = {};
  const x = S.current(s);
  ({ s, progress: p } = swipeForgot(s, p));
  assert.equal(s.queue.indexOf(x), 3, 'через 3 карточки');
  assert.equal(s.done, 0, 'забытое не засчитано');
  assert.equal(p[x].lvl, 0);
  // три других слова - вспомнил
  for (let i = 0; i < 3; i++) ({ s, progress: p } = swipeKnown(s, p));
  assert.equal(S.current(s), x);
  ({ s, progress: p } = swipeKnown(s, p)); // вспомнил на первом шаге
  assert.equal(s.queue.indexOf(x), 7, 'второй шаг - через 7 карточек');
  for (let i = 0; i < 7; i++) ({ s, progress: p } = swipeKnown(s, p));
  assert.equal(S.current(s), x);
  ({ s, progress: p } = swipeKnown(s, p)); // вспомнил на втором шаге - выучено
  assert.equal(s.queue.includes(x), false);
  assert.equal(p[x].lvl, 1);
  assert.equal(p[x].due, T0 + 1 * DAY, 'после доучивания - завтра');
});

test('забыл на шаге доучивания - шаги сначала', () => {
  let s = S.buildSession(mk('a', 'b', 'c', 'd', 'e'), {}, T0, noShuffle);
  let p = {};
  const x = S.current(s);
  ({ s, progress: p } = swipeForgot(s, p));
  for (let i = 0; i < 3; i++) ({ s, progress: p } = swipeKnown(s, p));
  ({ s, progress: p } = swipeForgot(s, p)); // снова забыл
  assert.equal(s.steps[x], 0);
  assert.equal(s.queue.indexOf(x), Math.min(3, s.queue.length - 1));
});

test('если в занятии одно слово, забытое показывается снова сразу', () => {
  let s = S.buildSession(mk('a'), {}, T0);
  let p = {};
  ({ s, progress: p } = swipeForgot(s, p));
  assert.deepEqual(s.queue, [K('a')]);
  ({ s, progress: p } = swipeKnown(s, p));
  ({ s, progress: p } = swipeKnown(s, p));
  assert.ok(S.isFinished(s));
  assert.equal(s.done, 1);
});

test('интервалы растут: 1, 3, 7, 16, 35, 80, 180 дней и дальше не растут', () => {
  let p = { [K('a')]: { lvl: 1, due: T0, lapses: 0 } };
  let t = T0;
  const got = [];
  for (let i = 0; i < 8; i++) {
    const s = S.buildSession(mk('a'), p, t);
    assert.equal(s.total, 1, 'слово к повторению');
    ({ progress: p } = swipeKnown(s, p, t));
    got.push(Math.round((p[K('a')].due - t) / DAY));
    t = p[K('a')].due;
  }
  assert.deepEqual(got, [3, 7, 16, 35, 80, 180, 180, 180]);
});

test('забыл выученное слово: уровень сбрасывается, считается провал', () => {
  let p = { [K('a')]: { lvl: 5, due: T0, lapses: 0 } };
  const s = S.buildSession(mk('a'), p, T0);
  ({ progress: p } = swipeForgot(s, p));
  assert.equal(p[K('a')].lvl, 0);
  assert.equal(p[K('a')].lapses, 1);
});

test('в занятие попадают только слова, срок которых сегодня, и новые', () => {
  const p = {
    [K('a')]: { lvl: 1, due: T0 - DAY, lapses: 0 },        // просрочено
    [K('b')]: { lvl: 1, due: T0 + 3600 * 1000, lapses: 0 }, // сегодня вечером
    [K('c')]: { lvl: 2, due: T0 + 2 * DAY, lapses: 0 },     // послезавтра
  };
  const s = S.buildSession(mk('a', 'b', 'c', 'd'), p, T0, noShuffle);
  assert.deepEqual(s.queue, [K('a'), K('b'), K('d')], 'сначала повторения по сроку, потом новые');
  assert.equal(S.dueCount(mk('a', 'b', 'c', 'd'), p, T0), 3);
});

test('все выучено на сегодня - пустое занятие; дата следующего повторения', () => {
  const p = { [K('a')]: { lvl: 2, due: T0 + 3 * DAY, lapses: 0 }, [K('b')]: { lvl: 1, due: T0 + DAY, lapses: 0 } };
  const s = S.buildSession(mk('a', 'b'), p, T0);
  assert.ok(S.isFinished(s));
  assert.equal(S.nextDue(mk('a', 'b'), p), T0 + DAY);
  assert.equal(S.learnedCount(mk('a', 'b', 'c'), p), 2);
});

test('"Повторить еще раз": все слова, раньше срока расписание не меняется, забытое - доучивание', () => {
  let p = { [K('a')]: { lvl: 3, due: T0 + 7 * DAY, lapses: 0 }, [K('b')]: { lvl: 3, due: T0 + 7 * DAY, lapses: 0 } };
  let s = S.buildSession(mk('a', 'b'), p, T0, noShuffle, true);
  assert.equal(s.total, 2);
  const first = S.current(s);
  ({ s, progress: p } = swipeKnown(s, p));
  assert.deepEqual(p[first], { lvl: 3, due: T0 + 7 * DAY, lapses: 0 }, 'вспомнил раньше срока - без изменений');
  const second = S.current(s);
  ({ s, progress: p } = swipeForgot(s, p));
  assert.equal(p[second].lvl, 0, 'забыл - уровень сброшен');
});

test('новый день - занятие устаревает', () => {
  const s = S.buildSession(mk('a'), {}, T0);
  assert.equal(S.isStale(s, T0 + 3600 * 1000), false);
  assert.equal(S.isStale(s, T0 + DAY), true);
});

test('добавили слова в таблицу посреди занятия - встают в конец, счетчик растет', () => {
  let s = S.buildSession(mk('a', 'b'), {}, T0, noShuffle);
  let p = {};
  ({ s, progress: p } = swipeKnown(s, p));
  const m = S.merge(s, mk('a', 'b', 'c'), p);
  assert.equal(m.total, 3);
  assert.equal(m.done, 1);
  assert.equal(m.queue[m.queue.length - 1], K('c'));
  const r = S.merge(m, mk('c'), p); // b удалили
  assert.deepEqual(r.queue, [K('c')]);
});

test('сохранение занятия и прогресса', () => {
  let s = S.buildSession(mk('a', 'b', 'c'), {}, T0);
  let p = {};
  ({ s, progress: p } = swipeForgot(s, p));
  const r = S.restore(S.serialize(s));
  assert.deepEqual(r.queue, s.queue);
  assert.deepEqual(r.steps, s.steps);
  assert.equal(r.day, s.day);
  assert.deepEqual(S.restoreProgress(JSON.stringify(p)), p);
  assert.equal(S.restore('мусор'), null);
  assert.equal(S.restore(JSON.stringify({ v: 2, queue: [], doneKeys: [] })), null, 'старый формат не подходит');
  assert.deepEqual(S.restoreProgress('мусор'), {});
});
