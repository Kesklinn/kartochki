// Логика колоды: без DOM, чтобы тестировать отдельно.
// Карточка: { ru, en, ipa, read }. ipa и read могут быть пустыми.
// Прогресс хранится по ключам слов, а не по номерам: добавление слов
// в таблицу не сбрасывает уже пройденное.

const RETRY_GAP = 3; // "Не знаю": карточка вернется через 3 карточки

function keyOf(card) {
  return card.en.trim().toLowerCase() + '|' + card.ru.trim().toLowerCase();
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqueKeys(cards) {
  return [...new Set(cards.map(keyOf))];
}

function newSession(cards, rng = Math.random) {
  return { queue: shuffle(uniqueKeys(cards), rng), doneKeys: [], flipped: false, ipaShown: false };
}

const total = (s) => s.queue.length + s.doneKeys.length;
const done = (s) => s.doneKeys.length;
const current = (s) => (s.queue.length ? s.queue[0] : null);
const isFinished = (s) => s.queue.length === 0;

function flip(s) {
  if (isFinished(s)) return s;
  return { ...s, flipped: !s.flipped, ipaShown: false }; // транскрипция скрыта при каждом перевороте
}

function toggleIpa(s) {
  if (isFinished(s) || !s.flipped) return s; // только на английской стороне
  return { ...s, ipaShown: !s.ipaShown };
}

function know(s) {
  if (isFinished(s)) return s;
  return { ...s, queue: s.queue.slice(1), doneKeys: [...s.doneKeys, s.queue[0]], flipped: false, ipaShown: false };
}

function dontKnow(s) {
  if (isFinished(s)) return s;
  const [first, ...rest] = s.queue;
  rest.splice(Math.min(rest.length, RETRY_GAP), 0, first);
  return { ...s, queue: rest, flipped: false, ipaShown: false };
}

// Подстраивает сессию под новый список слов:
// удаленные слова исчезают, новые встают в очередь на случайные места,
// пройденные остаются пройденными.
function merge(s, cards, rng = Math.random) {
  const keys = uniqueKeys(cards);
  const has = new Set(keys);
  const queue = s.queue.filter((k) => has.has(k));
  const doneKeys = s.doneKeys.filter((k) => has.has(k));
  const known = new Set([...queue, ...doneKeys]);
  for (const k of shuffle(keys.filter((x) => !known.has(x)), rng)) {
    queue.splice(Math.floor(rng() * (queue.length + 1)), 0, k);
  }
  const sameFront = queue[0] === s.queue[0];
  return { queue, doneKeys, flipped: sameFront && s.flipped, ipaShown: sameFront && s.ipaShown };
}

function hasIpa(card) {
  return Boolean((card.ipa && card.ipa.trim()) || (card.read && card.read.trim()));
}

function serialize(s) {
  return JSON.stringify({ v: 2, queue: s.queue, doneKeys: s.doneKeys });
}

// Восстановление из сохраненного. null, если данных нет или они испорчены.
function restore(raw, cards) {
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 2 || !Array.isArray(o.queue) || !Array.isArray(o.doneKeys)) return null;
    const all = [...o.queue, ...o.doneKeys];
    if (!all.every((k) => typeof k === 'string') || new Set(all).size !== all.length) return null;
    return merge({ queue: o.queue, doneKeys: o.doneKeys, flipped: false, ipaShown: false }, cards);
  } catch {
    return null;
  }
}

const Deck = { RETRY_GAP, keyOf, shuffle, newSession, total, done, current, isFinished, flip, toggleIpa, know, dontKnow, merge, hasIpa, serialize, restore };
if (typeof module !== 'undefined') module.exports = Deck;
