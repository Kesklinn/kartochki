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

test('не помню: слово возвращается через 3, 7 и 15 карточек, потом завтра', () => {
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
  ({ s, progress: p } = swipeKnown(s, p)); // вспомнил на втором шаге
  assert.equal(s.queue.indexOf(x), Math.min(15, s.queue.length - 1), 'третий шаг - через 15 карточек (или в конец)');
  while (S.current(s) !== x) ({ s, progress: p } = swipeKnown(s, p));
  ({ s, progress: p } = swipeKnown(s, p)); // вспомнил на третьем шаге - доучено
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
  for (let i = 0; i < 3; i++) ({ s, progress: p } = swipeKnown(s, p));
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

test('слова, отвеченные сегодня в другом списке, засчитываются: счетчик показывает весь объем дня', () => {
  const words = mk('a', 'b', 'c', 'd');
  // в "Все слова" сегодня ответили a (помню) и b (не помню, доучено)
  let s = S.buildSession(mk('a', 'b'), {}, T0, noShuffle);
  let p = {};
  ({ s, progress: p } = swipeKnown(s, p, T0));
  ({ s, progress: p } = swipeForgot(s, p, T0));
  for (let i = 0; i < 3; i++) ({ s, progress: p } = swipeKnown(s, p, T0));
  assert.ok(S.isFinished(s));
  // открыли список из четырех слов в тот же день
  const v = S.buildSession(words, p, T0 + 3600e3, noShuffle);
  assert.equal(v.total, 4);
  assert.equal(v.done, 2, 'a и b уже пройдены сегодня');
  assert.deepEqual(v.queue, [K('c'), K('d')]);
  // на следующий день прошлые ответы уже не считаются "сегодняшними"
  const n = S.buildSession(words, p, T0 + S.DAY, noShuffle);
  assert.equal(n.done, 0);
  assert.deepEqual(n.queue, [K('b'), K('c'), K('d')], 'b - на повторение (1 день), a - через 3 дня');
});

test('вернулся к начатому списку: слова, отвеченные тем временем в другом списке, не повторяются', () => {
  const words = mk('a', 'b', 'c');
  const list = S.buildSession(words, {}, T0, noShuffle); // начал список, ничего не ответил
  let all = S.buildSession(words, {}, T0, noShuffle);    // ушел во "Все слова"
  let p = {};
  ({ s: all, progress: p } = swipeKnown(all, p, T0));    // ответил a
  const back = S.merge(S.restore(S.serialize(list)), words, p, T0 + 60e3);
  assert.equal(back.queue.includes(K('a')), false);
  assert.equal(back.done, 1);
  assert.equal(back.total, 3);
});

test('тренировка: трудные слова первыми', () => {
  const p = {
    [K('easy')]: { lvl: 5, due: T0 + 30 * DAY, lapses: 0 },
    [K('mid')]: { lvl: 2, due: T0 + 3 * DAY, lapses: 0 },
    [K('hard')]: { lvl: 1, due: T0 + DAY, lapses: 3 },
    [K('lapsed')]: { lvl: 0, due: T0, lapses: 1 },
  };
  const s = S.buildSession(mk('easy', 'mid', 'hard', 'lapsed', 'new'), p, T0, Math.random, true);
  assert.deepEqual(s.queue, [K('new'), K('lapsed'), K('hard'), K('mid'), K('easy')]);
  const s2 = S.buildSession(mk('easy', 'mid', 'hard', 'lapsed', 'new'), p, T0, Math.random, true, K('new'));
  assert.notEqual(s2.queue[0], K('new'), 'только что отвеченное не первым');
});

test('сколько осталось на сегодня', () => {
  const p = { [K('a')]: { lvl: 1, due: T0 + DAY, lapses: 0 }, [K('b')]: { lvl: 1, due: T0 - DAY, lapses: 0 } };
  assert.equal(S.remainingToday(mk('a', 'b', 'c'), p, T0), 2);
  assert.equal(S.hasNew(mk('a', 'b'), p), false);
  assert.equal(S.hasNew(mk('a', 'c'), p), true);
});
