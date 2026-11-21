const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/srs.js');

const mk = (...en) => en.map((e) => ({ ru: 'ru-' + e, en: e, ipa: '', read: '' }));
const many = (n) => Array.from({ length: n }, (_, i) => ({ ru: 'r' + i, en: 'e' + i, ipa: '', read: '' }));
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
  assert.equal(S.position(s), 1);
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

test('не помню: слово возвращается через 3 карточки, потом через 7, потом завтра (два закрепления)', () => {
  assert.deepEqual(S.STEPS, [3, 7]);
  let s = S.buildSession(many(12), {}, T0, noShuffle);
  let p = {};
  const x = S.current(s);
  ({ s, progress: p } = swipeForgot(s, p));
  assert.equal(s.queue.indexOf(x), 3, 'через 3 карточки');
  assert.equal(p[x].lvl, 0);
  for (let i = 0; i < 3; i++) ({ s, progress: p } = swipeKnown(s, p));
  assert.equal(S.current(s), x);
  ({ s, progress: p } = swipeKnown(s, p)); // вспомнил - первое закрепление
  assert.equal(s.queue.indexOf(x), 7, 'второе - через 7 карточек');
  for (let i = 0; i < 7; i++) ({ s, progress: p } = swipeKnown(s, p));
  assert.equal(S.current(s), x);
  ({ s, progress: p } = swipeKnown(s, p)); // второе закрепление - доучено
  assert.equal(s.queue.includes(x), false);
  assert.equal(p[x].lvl, 1);
  assert.equal(p[x].due, T0 + 1 * DAY, 'после доучивания - завтра');
});

test('забыл на шаге доучивания - шаги сначала, это не новый провал', () => {
  let s = S.buildSession(many(10), {}, T0, noShuffle);
  const x = S.current(s);
  let p = { [x]: { lvl: 3, due: T0, lapses: 0 } };
  ({ s, progress: p } = swipeForgot(s, p));
  assert.equal(p[x].lapses, 1);
  while (S.current(s) !== x) ({ s, progress: p } = swipeKnown(s, p));
  ({ s, progress: p } = swipeForgot(s, p));
  assert.equal(s.steps[x], 0);
  assert.equal(p[x].lapses, 1, 'повторный провал при доучивании не считается');
});

test('если в занятии одно слово, забытое показывается снова сразу', () => {
  let s = S.buildSession(mk('a'), {}, T0);
  let p = {};
  ({ s, progress: p } = swipeForgot(s, p));
  assert.deepEqual(s.queue, [K('a')]);
  ({ s, progress: p } = swipeKnown(s, p));
  ({ s, progress: p } = swipeKnown(s, p));
  assert.ok(S.isFinished(s));
});

test('забытые слова не застревают: между повторами всегда новые слова, весь список доходит', () => {
  // худший случай: каждое пятое слово забывается каждый раз (подсматривает всегда)
  const cards = many(50);
  const hard = new Set(cards.filter((_, i) => i % 5 === 0).map(S.keyOf));
  let s = S.buildSession(cards, {}, T0, noShuffle);
  let p = {};
  const reached = new Set();
  for (let i = 0; i < 200 && !S.isFinished(s); i++) {
    const k = S.current(s);
    reached.add(k);
    ({ s, progress: p } = hard.has(k) ? swipeForgot(s, p) : swipeKnown(s, p));
  }
  assert.equal(reached.size, 50, 'все 50 слов показаны, ни одно не застряло за забытыми');
});

test('счетчик: второе число не растет от забытых слов, ↻ - сколько на закреплении', () => {
  let s = S.buildSession(many(20), {}, T0, noShuffle);
  let p = {};
  ({ s, progress: p } = swipeForgot(s, p));
  ({ s, progress: p } = swipeForgot(s, p));
  assert.equal(s.total, 20, 'второе число постоянное');
  assert.equal(s.done, 2, 'пройдено 2 слова');
  assert.equal(s.relearning, 2, '2 слова на закреплении');
  assert.equal(S.position(s), 3);
  // когда приходит повтор забытого слова, номер не растет: это не новое слово
  while (!(S.current(s) in s.steps)) ({ s, progress: p } = swipeKnown(s, p));
  assert.equal(S.position(s), s.done, 'на повторе показывается уже пройденное число');
  let guard = 0;
  while (!S.isFinished(s) && guard++ < 100) ({ s, progress: p } = swipeKnown(s, p));
  assert.equal(s.done, 20);
  assert.equal(s.total, 20);
  assert.equal(s.relearning, 0);
});

test('интервалы растут: 1, 3, 7, 16, 35, 80, 180 дней и дальше не растут', () => {
  let p = { [K('a')]: { lvl: 1, due: T0, lapses: 0 } };
  let t = T0;
  const got = [];
  for (let i = 0; i < 8; i++) {
    const s = S.buildSession(mk('a'), p, t);
    assert.equal(s.queue.length, 1, 'слово к повторению');
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

test('в план попадают только слова, срок которых сегодня, и новые', () => {
  const p = {
    [K('a')]: { lvl: 1, due: T0 - DAY, lapses: 0 },        // просрочено
    [K('b')]: { lvl: 1, due: T0 + 3600 * 1000, lapses: 0 }, // сегодня вечером
    [K('c')]: { lvl: 2, due: T0 + 2 * DAY, lapses: 0 },     // послезавтра
  };
  const s = S.buildSession(mk('a', 'b', 'c', 'd'), p, T0, noShuffle);
  assert.deepEqual(s.queue, [K('a'), K('b'), K('d')], 'сначала повторения по сроку, потом новые');
  assert.equal(S.remainingToday(mk('a', 'b', 'c', 'd'), p, T0), 3);
});

test('тренировка слабых: только слабые слова, трудные первыми, хорошо знакомые не попадают', () => {
  const p = {
    [K('strong')]: { lvl: 5, due: T0 + 30 * DAY, lapses: 0 },   // хорошо знает - не слабое
    [K('mid')]: { lvl: 2, due: T0 + 3 * DAY, lapses: 0 },       // тоже не слабое
    [K('soon')]: { lvl: 3, due: T0 + 0.5 * DAY, lapses: 0 },    // срок скоро - слабое
    [K('hard')]: { lvl: 2, due: T0 + 3 * DAY, lapses: 3 },      // часто забывал
    [K('lapsed')]: { lvl: 0, due: T0, lapses: 1 },              // забыл сегодня
  };
  const words = mk('strong', 'mid', 'soon', 'hard', 'lapsed');
  const s = S.buildSession(words, p, T0, Math.random, 'weak');
  assert.deepEqual(s.queue, [K('lapsed'), K('hard'), K('soon')]);
  // уже вспомненные сегодня в тренировке не повторяются
  const s2 = S.buildSession(words, p, T0, Math.random, 'weak', null, new Set([K('lapsed')]));
  assert.deepEqual(s2.queue, [K('hard'), K('soon')]);
  assert.equal(S.weakLeft(words, p, T0, new Set([K('lapsed'), K('hard'), K('soon')])), 0);
});

test('тренировка раньше срока расписание не меняет; забытое в ней - доучивание', () => {
  let p = { [K('a')]: { lvl: 1, due: T0 + DAY, lapses: 1 }, [K('b')]: { lvl: 1, due: T0 + DAY, lapses: 1 } };
  let s = S.buildSession(mk('a', 'b'), p, T0, noShuffle, 'weak');
  const first = S.current(s);
  const r = swipeKnown(s, p);
  assert.equal(r.recalled, true);
  assert.equal(r.progress[first].due, T0 + DAY, 'вспомнил раньше срока - без изменений');
  s = r.s; p = r.progress;
  const second = S.current(s);
  ({ s, progress: p } = swipeForgot(s, p));
  assert.equal(p[second].lvl, 0, 'забыл - уровень сброшен');
});

test('тренировка "все еще раз": все слова, в том числе хорошо знакомые', () => {
  const p = { [K('a')]: { lvl: 5, due: T0 + 30 * DAY, lapses: 0 }, [K('b')]: { lvl: 0, due: T0, lapses: 1 } };
  const s = S.buildSession(mk('a', 'b'), p, T0, Math.random, 'all');
  assert.deepEqual(s.queue, [K('b'), K('a')]);
});

test('тренировка: при равной трудности раньше то, что дольше не повторяли', () => {
  const p = {
    [K('fresh')]: { lvl: 1, due: T0 + DAY, lapses: 0, last: T0 - 3600e3 },
    [K('old')]: { lvl: 1, due: T0 + DAY, lapses: 0, last: T0 - 20 * DAY },
  };
  const s = S.buildSession(mk('fresh', 'old'), p, T0, Math.random, 'weak');
  assert.deepEqual(s.queue, [K('old'), K('fresh')]);
});

test('тренировка: только что отвеченное слово не идет первым', () => {
  const p = { [K('a')]: { lvl: 0, due: T0, lapses: 2 }, [K('b')]: { lvl: 1, due: T0 + DAY, lapses: 0 } };
  const s = S.buildSession(mk('a', 'b'), p, T0, Math.random, 'weak', K('a'));
  assert.equal(s.queue[0], K('b'));
});

test('слова, отвеченные сегодня в другом списке, засчитываются в счетчике плана', () => {
  let s = S.buildSession(mk('a', 'b'), {}, T0, noShuffle);
  let p = {};
  ({ s, progress: p } = swipeKnown(s, p));
  ({ s, progress: p } = swipeKnown(s, p));
  const v = S.buildSession(mk('a', 'b', 'c', 'd'), p, T0 + 3600e3, noShuffle);
  assert.equal(v.total, 4);
  assert.equal(v.done, 2);
  assert.equal(S.position(v), 3);
  assert.deepEqual(v.queue, [K('c'), K('d')]);
  const n = S.buildSession(mk('a', 'b', 'c', 'd'), p, T0 + DAY, noShuffle);
  assert.equal(n.done, 0, 'на следующий день прошлые ответы не "сегодняшние"');
});

test('вернулся к начатому списку: слова, отвеченные тем временем в другом списке, не повторяются', () => {
  const words = mk('a', 'b', 'c');
  const list = S.buildSession(words, {}, T0, noShuffle);
  let all = S.buildSession(words, {}, T0, noShuffle);
  let p = {};
  ({ s: all, progress: p } = swipeKnown(all, p));
  const back = S.merge(S.restore(S.serialize(list)), words, p, T0 + 60e3);
  assert.equal(back.queue.includes(K('a')), false);
  assert.equal(back.done, 1);
  assert.equal(back.total, 3);
});

test('добавили слова в таблицу посреди плана - встают в конец, счетчик растет', () => {
  let s = S.buildSession(mk('a', 'b'), {}, T0, noShuffle);
  let p = {};
  ({ s, progress: p } = swipeKnown(s, p));
  const m = S.merge(s, mk('a', 'b', 'c'), p);
  assert.equal(m.total, 3);
  assert.equal(m.done, 1);
  assert.equal(m.queue[m.queue.length - 1], K('c'));
  const r = S.merge(m, mk('c'), p); // a и b удалили из таблицы
  assert.deepEqual(r.queue, [K('c')]);
  assert.equal(r.total, 1);
});

test('новый день - занятие устаревает', () => {
  const s = S.buildSession(mk('a'), {}, T0);
  assert.equal(S.isStale(s, T0 + 3600 * 1000), false);
  assert.equal(S.isStale(s, T0 + DAY), true);
});

test('сохранение занятия и прогресса, в том числе старого формата', () => {
  let s = S.buildSession(mk('a', 'b', 'c'), {}, T0);
  let p = {};
  ({ s, progress: p } = swipeForgot(s, p));
  const r = S.restore(S.serialize(s));
  assert.deepEqual(r.queue, s.queue);
  assert.deepEqual(r.steps, s.steps);
  assert.deepEqual(r.seen, s.seen);
  assert.equal(r.total, s.total);
  assert.equal(r.done, s.done);
  assert.deepEqual(S.restoreProgress(JSON.stringify(p)), p);
  const v4 = S.restore(JSON.stringify({ v: 4, day: S.dayOf(T0), practice: true, queue: [K('a')], steps: {}, total: 5, done: 3 }));
  assert.equal(v4.practice, 'weak');
  assert.equal(v4.done, 3);
  assert.equal(S.restore('мусор'), null);
  assert.equal(S.restore(JSON.stringify({ v: 2, queue: [], doneKeys: [] })), null, 'совсем старый формат не подходит');
  assert.deepEqual(S.restoreProgress('мусор'), {});
});

test('модель занятия: знакомые слова показываются один раз, забытые - не больше 4 раз', () => {
  const cards = many(50);
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const need = {}; // сколько раз надо увидеть ответ, чтобы запомнить
  for (const c of cards) need[S.keyOf(c)] = rnd() < 0.7 ? 0 : rnd() < 0.5 ? 1 : 2;
  const peeked = {}, shows = {};
  let s = S.buildSession(cards, {}, T0, rnd), p = {};
  for (let i = 0; i < 400 && !S.isFinished(s); i++) {
    const k = S.current(s);
    shows[k] = (shows[k] || 0) + 1;
    if ((peeked[k] || 0) < need[k]) { s = S.flip(s); peeked[k] = (peeked[k] || 0) + 1; }
    ({ s, progress: p } = S.swipe(s, p, T0));
  }
  assert.ok(S.isFinished(s));
  for (const c of cards) {
    const k = S.keyOf(c);
    if (need[k] === 0) assert.equal(shows[k], 1, 'знакомое слово - один раз: ' + k);
    else assert.ok(shows[k] <= 2 + need[k], 'забытое ' + k + ' показано ' + shows[k] + ' раз');
  }
});
