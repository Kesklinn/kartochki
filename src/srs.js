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
//   потом, если вспомнил, через 7 и через 15 - растущие промежутки закрепляют лучше,
//   чем повтор подряд. Забыл на любом шаге - шаги начинаются сначала.
// Когда слова по расписанию на сегодня кончились, занятие не обрывается: идет тренировка
//   (practice) - сначала самые трудные слова. Раньше срока расписание она не сдвигает,
//   а забытое в ней слово уходит на доучивание, как обычно.

const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [0, 1, 3, 7, 16, 35, 80, 180]; // дней для lvl 1..7
const MAX_LVL = INTERVALS.length - 1;
const STEPS = [3, 7, 15]; // через сколько карточек показать забытое слово снова (закрепляем трижды)

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
// Слово сегодня уже отвечено и до следующего повторения не нужно.
const answeredToday = (p, now) => Boolean(p) && Boolean(p.last) && dayOf(p.last) === dayOf(now) && !isDue(p, now);

// Насколько слово трудное: чем меньше уровень, чем чаще забывали и чем ближе срок -
// тем раньше оно в тренировке. Новые слова (без истории) - как самые трудные.
function difficultyOrder(keys, progress, now, rng = Math.random) {
  const score = (k) => {
    const p = progress[k];
    if (!p) return -1e9;
    return p.lvl * 100 - (p.lapses || 0) * 40 + Math.max(0, (p.due - now) / DAY);
  };
  return shuffle(keys, rng).sort((a, b) => score(a) - score(b)); // shuffle - случайный порядок среди равных
}

// Занятие на сегодня: сначала слова, срок которых подошел (самые просроченные первыми),
// потом новые в случайном порядке. В режиме practice - все слова списка, трудные первыми;
// avoid - слово, которое только что было, чтобы оно не шло два раза подряд.
function buildSession(cards, progress, now, rng = Math.random, practice = false, avoid = null) {
  const keys = uniqueKeys(cards);
  let queue;
  if (practice) {
    queue = difficultyOrder(keys, progress, now, rng);
    if (queue.length > 1 && queue[0] === avoid) [queue[0], queue[1]] = [queue[1], queue[0]];
  } else {
    const due = keys.filter((k) => isDue(progress[k], now)).sort((a, b) => progress[a].due - progress[b].due);
    const fresh = shuffle(keys.filter((k) => !progress[k]), rng);
    queue = [...due, ...fresh];
  }
  // Слова этого списка, которые сегодня уже отвечены (здесь или в другом списке), сразу
  // считаем пройденными: счетчик показывает весь сегодняшний объем, а не только остаток.
  const doneToday = practice ? 0 : keys.filter((k) => answeredToday(progress[k], now)).length;
  return withTotal({ day: dayOf(now), practice, queue, steps: {}, total: 0, done: doneToday, flipped: false, ipaShown: false, revealed: false });
}

// Счетчик занятия считает каждое смахивание: done - сколько карточек уже пролистано,
// total - done плюс все, что еще предстоит: карточки в очереди и будущие повторы
// забытых слов (у слова на шаге i осталось еще STEPS.length - 1 - i возвратов).
// Забыл слово - total вырастает на число шагов доучивания, но первое число не стоит на месте.
function withTotal(s) {
  let extra = 0;
  for (const k of Object.keys(s.steps)) if (s.queue.includes(k)) extra += STEPS.length - 1 - s.steps[k];
  return { ...s, total: s.done + s.queue.length + extra };
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
    if (rec) next[key] = { ...rec, last: now };
    delete steps[key];
    return { s: withTotal({ ...s, ...base, queue: rest, steps, done: s.done + 1 }), progress: next };
  };
  const requeue = (stepIdx) => {
    steps[key] = stepIdx;
    const q = rest.slice();
    q.splice(Math.min(q.length, STEPS[stepIdx]), 0, key);
    return { s: withTotal({ ...s, ...base, queue: q, steps, done: s.done + 1 }), progress: next };
  };

  if (!remembered) {
    // не вспомнил: сброс уровня и доучивание с первого шага
    const lapse = p && !(key in steps) ? 1 : 0; // повторный провал на шаге доучивания - не новый провал
    next[key] = { lvl: 0, due: now, lapses: ((p && p.lapses) || 0) + lapse, last: now };
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
// Если передан now: слова, на которые сегодня уже ответили в другом списке, из очереди
// убираются и засчитываются как пройденные (иначе они показались бы второй раз).
function merge(s, cards, progress, now) {
  const keys = uniqueKeys(cards);
  const has = new Set(keys);
  const kept = s.queue.filter((k) => has.has(k));
  const removed = s.queue.length - kept.length;
  const handled = now === undefined || s.practice ? [] : kept.filter((k) => !(k in s.steps) && answeredToday(progress[k], now));
  const queue = kept.filter((k) => !handled.includes(k));
  const added = s.practice ? [] : keys.filter((k) => !progress[k] && !queue.includes(k));
  const steps = {};
  for (const k of Object.keys(s.steps)) if (has.has(k)) steps[k] = s.steps[k];
  const sameFront = queue[0] === s.queue[0];
  return withTotal({
    ...s,
    queue: [...queue, ...added],
    steps,
    done: s.done + handled.length,
    flipped: sameFront && s.flipped,
    ipaShown: sameFront && s.ipaShown,
    revealed: sameFront && s.revealed,
  });
}

// Нужно ли собрать занятие заново (наступил новый день, а занятие закончено или вчерашнее).
function isStale(s, now) {
  return !s || s.day !== dayOf(now);
}

// Сколько слов списка еще ждут сегодня (по расписанию или новые).
function remainingToday(cards, progress, now) {
  return uniqueKeys(cards).filter((k) => !progress[k] || isDue(progress[k], now)).length;
}

function hasNew(cards, progress) {
  return uniqueKeys(cards).some((k) => !progress[k]);
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
    return withTotal({ day: o.day, practice: !!o.practice, queue: o.queue, steps, total: 0, done: o.done | 0, flipped: false, ipaShown: false, revealed: false });
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
      if (p && Number.isFinite(p.due) && Number.isInteger(p.lvl)) {
        out[k] = { lvl: p.lvl, due: p.due, lapses: p.lapses | 0 };
        if (Number.isFinite(p.last)) out[k].last = p.last;
      }
    }
    return out;
  } catch {
    return {};
  }
}

const Srs = {
  DAY, INTERVALS, STEPS, keyOf, difficultyOrder, remainingToday, hasNew, hasIpa, dayOf, shuffle, buildSession, current, isFinished, flip, toggleIpa,
  swipe, merge, isStale, learnedCount, dueCount, nextDue, serialize, restore, restoreProgress,
};
if (typeof module !== 'undefined') module.exports = Srs;
