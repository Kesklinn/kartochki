// Интервальное повторение (упрощенная схема Лейтнера / SM-2).
//
// Оценка ставится одним жестом - смахиванием:
//   смахнул, НЕ переворачивая  -> помню;
//   перевернул хотя бы раз     -> не помню.
//
// Долгая память (между днями): у слова есть уровень lvl и дата следующего показа due.
//   новое слово, сразу вспомнил        -> lvl 2, снова через 3 дня (уже знал его);
//   вспомнил при повторении             -> lvl + 1, интервал растет: 1, 3, 7, 16, 35, 80, 180 дней;
//   не вспомнил                         -> lvl 0 и доучивание прямо сейчас (см. ниже),
//                                          после доучивания - снова завтра.
// Короткая память (в течение занятия): забытое слово возвращается через 3 карточки,
//   потом, если вспомнил, еще раз через 7 карточек - растущие промежутки закрепляют лучше,
//   чем повтор подряд. Забыл на любом шаге - шаги начинаются сначала.

const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [0, 1, 3, 7, 16, 35, 80, 180]; // дней для lvl 1..7
const MAX_LVL = INTERVALS.length - 1;
const STEPS = [3, 7]; // через сколько карточек показать забытое слово снова

function keyOf(card) {
  return card.en.trim().toLowerCase() + '|' + card.ru.trim().toLowerCase();
}

function hasIpa(card) {
  return Boolean((card.ipa && card.ipa.trim()) || (card.read && card.read.trim()));
}

function dayOf(now) {
  const d = new Date(now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Повторения, которые надо сделать сегодня: к концу дня, а не к текущей минуте.
function endOfDay(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
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

const isDue = (p, now) => Boolean(p) && p.due <= endOfDay(now);

// Занятие на сегодня: сначала слова, срок которых подошел (самые просроченные первыми),
// потом новые в случайном порядке. В режиме practice - все слова списка.
function buildSession(cards, progress, now, rng = Math.random, practice = false) {
  const keys = uniqueKeys(cards);
  let queue;
  if (practice) {
    queue = shuffle(keys, rng);
  } else {
    const due = keys.filter((k) => isDue(progress[k], now)).sort((a, b) => progress[a].due - progress[b].due);
    const fresh = shuffle(keys.filter((k) => !progress[k]), rng);
    queue = [...due, ...fresh];
  }
  return { day: dayOf(now), practice, queue, steps: {}, total: queue.length, done: 0, flipped: false, ipaShown: false, revealed: false };
}

const current = (s) => (s.queue.length ? s.queue[0] : null);
const isFinished = (s) => s.queue.length === 0;

function flip(s) {
  if (isFinished(s)) return s;
  const flipped = !s.flipped;
  // увидел ответ - значит, не вспомнил сам
  return { ...s, flipped, ipaShown: false, revealed: s.revealed || flipped };
}

function toggleIpa(s) {
  if (isFinished(s) || !s.flipped) return s;
  return { ...s, ipaShown: !s.ipaShown };
}

// Смахивание. Возвращает новое занятие и новый прогресс.
function swipe(s, progress, now) {
  if (isFinished(s)) return { s, progress };
  const [key, ...rest] = s.queue;
  const remembered = !s.revealed;
  const p = progress[key];
  const steps = { ...s.steps };
  const next = { ...progress };
  const base = { flipped: false, ipaShown: false, revealed: false };

  const finish = (rec) => {
    if (rec) next[key] = rec;
    delete steps[key];
    return { s: { ...s, ...base, queue: rest, steps, done: s.done + 1 }, progress: next };
  };
  const requeue = (stepIdx) => {
    steps[key] = stepIdx;
    const q = rest.slice();
    q.splice(Math.min(q.length, STEPS[stepIdx]), 0, key);
    return { s: { ...s, ...base, queue: q, steps }, progress: next };
  };

  if (!remembered) {
    // не вспомнил: сброс уровня и доучивание с первого шага
    const lapse = p && !(key in steps) ? 1 : 0; // повторный провал на шаге доучивания - не новый провал
    next[key] = { lvl: 0, due: now, lapses: ((p && p.lapses) || 0) + lapse };
    return requeue(0);
  }

  if (key in steps) {
    // вспомнил на шаге доучивания
    if (steps[key] + 1 < STEPS.length) return requeue(steps[key] + 1);
    return finish({ ...next[key], lvl: 1, due: now + INTERVALS[1] * DAY });
  }

  if (!p) return finish({ lvl: 2, due: now + INTERVALS[2] * DAY, lapses: 0 }); // новое, но уже знал
  if (s.practice && !isDue(p, now)) return finish(null); // тренировка раньше срока: расписание не трогаем
  const lvl = Math.min(MAX_LVL, p.lvl + 1);
  return finish({ ...p, lvl, due: now + INTERVALS[lvl] * DAY });
}

// Подстраивает занятие под новый список слов: удаленные убираем, новые добавляем в конец.
function merge(s, cards, progress) {
  const keys = uniqueKeys(cards);
  const has = new Set(keys);
  const queue = s.queue.filter((k) => has.has(k));
  const removed = s.queue.length - queue.length;
  const added = s.practice ? [] : keys.filter((k) => !progress[k] && !queue.includes(k));
  const steps = {};
  for (const k of Object.keys(s.steps)) if (has.has(k)) steps[k] = s.steps[k];
  const sameFront = queue[0] === s.queue[0];
  return {
    ...s,
    queue: [...queue, ...added],
    steps,
    total: Math.max(s.done + queue.length + added.length, s.total - removed + added.length),
    flipped: sameFront && s.flipped,
    ipaShown: sameFront && s.ipaShown,
    revealed: sameFront && s.revealed,
  };
}

// Нужно ли собрать занятие заново (наступил новый день, а занятие закончено или вчерашнее).
function isStale(s, now) {
  return !s || s.day !== dayOf(now);
}

function learnedCount(cards, progress) {
  return uniqueKeys(cards).filter((k) => progress[k] && progress[k].lvl >= 1).length;
}

function dueCount(cards, progress, now) {
  return uniqueKeys(cards).filter((k) => !progress[k] || isDue(progress[k], now)).length;
}

// Когда следующее повторение (для экрана "на сегодня все"). null - слов нет.
function nextDue(cards, progress) {
  let best = null;
  for (const k of uniqueKeys(cards)) {
    const p = progress[k];
    if (!p) return 0; // есть новые - можно хоть сейчас
    if (best === null || p.due < best) best = p.due;
  }
  return best;
}

function serialize(s) {
  const { day, practice, queue, steps, total, done } = s;
  return JSON.stringify({ v: 4, day, practice, queue, steps, total, done });
}

function restore(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 4 || !Array.isArray(o.queue) || typeof o.day !== 'string') return null;
    if (!o.queue.every((k) => typeof k === 'string') || new Set(o.queue).size !== o.queue.length) return null;
    const steps = o.steps && typeof o.steps === 'object' ? o.steps : {};
    return { day: o.day, practice: !!o.practice, queue: o.queue, steps, total: o.total | 0, done: o.done | 0, flipped: false, ipaShown: false, revealed: false };
  } catch {
    return null;
  }
}

function restoreProgress(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return {};
    const out = {};
    for (const [k, p] of Object.entries(o)) {
      if (p && Number.isFinite(p.due) && Number.isInteger(p.lvl)) out[k] = { lvl: p.lvl, due: p.due, lapses: p.lapses | 0 };
    }
    return out;
  } catch {
    return {};
  }
}

const Srs = {
  DAY, INTERVALS, STEPS, keyOf, hasIpa, dayOf, shuffle, buildSession, current, isFinished, flip, toggleIpa,
  swipe, merge, isStale, learnedCount, dueCount, nextDue, serialize, restore, restoreProgress,
};
if (typeof module !== 'undefined') module.exports = Srs;
