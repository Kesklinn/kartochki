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
// Короткая память (в течение занятия): забытое слово возвращается через 3 карточки, потом,
//   если вспомнил, еще раз через 7 - растущие промежутки закрепляют лучше, чем повтор подряд.
//   Забыл на любом шаге - шаги начинаются сначала. Между повторами забытых слов всегда
//   встают новые слова (если они есть), чтобы несколько забытых не крутились по кругу.
// Тренировка (practice):
//   'weak' - только слабые слова: низкий уровень, когда-либо забытые, срок которых завтра;
//            слово, вспомненное в тренировке, на сегодня из тренировки уходит (okToday);
//   'all'  - все слова списка, трудные первыми (по просьбе "повторить все еще раз").
//   Раньше срока тренировка расписание не сдвигает, забытое в ней слово идет на доучивание.

const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [0, 1, 3, 7, 16, 35, 80, 180]; // дней для lvl 1..7
const MAX_LVL = INTERVALS.length - 1;
const STEPS = [3, 7]; // через сколько карточек показать забытое слово снова (закрепляем дважды)
const FRESH_BETWEEN = 2; // сколько не-повторов должно пройти перед повтором забытого слова

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
// Слабое слово - кандидат на тренировку: низкий уровень, его забывали или срок уже завтра.
const isWeak = (p, now) => Boolean(p) && (p.lvl <= 1 || (p.lapses || 0) > 0 || p.due - now <= DAY);

// Насколько слово трудное: чем меньше уровень, чем чаще забывали, чем ближе срок и чем
// дольше его не повторяли - тем раньше оно в тренировке. Новые слова - как самые трудные.
function difficultyOrder(keys, progress, now, rng = Math.random) {
  const score = (k) => {
    const p = progress[k];
    if (!p) return -1e9;
    const idle = Math.min(60, (now - (p.last || 0)) / DAY); // давно не повторяли - раньше
    return p.lvl * 100 - (p.lapses || 0) * 40 + Math.max(0, (p.due - now) / DAY) - idle * 3;
  };
  return shuffle(keys, rng).sort((a, b) => score(a) - score(b)); // shuffle - случайный порядок среди равных
}

// Счетчик: второе число - сколько слов в занятии (не растет от забытых слов),
// первое - сколько из них уже пройдено хотя бы раз (pre - отвеченные сегодня в других списках).
// relearning - сколько забытых слов сейчас на закреплении (значок ↻ N).
function withCounts(s) {
  const seen = new Set(s.seen);
  const words = new Set([...s.seen, ...s.queue]);
  return {
    ...s,
    total: s.pre + words.size,
    done: s.pre + seen.size,
    relearning: s.queue.filter((k) => k in s.steps).length,
  };
}

// Какое число показывать первым: номер текущего слова, а на повторе забытого - сколько пройдено.
function position(s) {
  const k = current(s);
  if (k === null) return s.total;
  return Math.min(s.total, s.done + (s.seen.includes(k) ? 0 : 1));
}

// Занятие. План (practice = false): слова, срок которых подошел (самые просроченные первыми),
// потом новые. 'weak' - слабые слова, кроме уже вспомненных в тренировке сегодня (okToday).
// 'all' - все слова списка. avoid - только что отвеченное слово: не ставить его первым.
function buildSession(cards, progress, now, rng = Math.random, practice = false, avoid = null, okToday = new Set()) {
  const keys = uniqueKeys(cards);
  let queue;
  if (practice === 'all' || practice === true) {
    queue = difficultyOrder(keys, progress, now, rng);
  } else if (practice === 'weak') {
    queue = difficultyOrder(keys.filter((k) => isWeak(progress[k], now) && !okToday.has(k)), progress, now, rng);
  } else {
    const due = keys.filter((k) => isDue(progress[k], now)).sort((a, b) => progress[a].due - progress[b].due);
    const fresh = shuffle(keys.filter((k) => !progress[k]), rng);
    queue = [...due, ...fresh];
  }
  if (practice && queue.length > 1 && queue[0] === avoid) [queue[0], queue[1]] = [queue[1], queue[0]];
  // Слова этого списка, которые сегодня уже отвечены (здесь или в другом списке), в плане
  // сразу засчитываем: счетчик показывает весь сегодняшний объем, а не только остаток.
  const pre = practice ? 0 : keys.filter((k) => answeredToday(progress[k], now)).length;
  return withCounts({ day: dayOf(now), practice: practice === true ? 'all' : practice, queue, steps: {}, pre, seen: [], flipped: false, ipaShown: false, revealed: false });
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

// Куда вернуть забытое слово: не раньше чем через gap карточек и не раньше, чем пройдут
// FRESH_BETWEEN карточек, которые сами не повторы (если такие вообще есть в очереди).
function requeuePos(rest, steps, gap) {
  const isFresh = (k) => !(k in steps);
  const need = Math.min(FRESH_BETWEEN, rest.filter(isFresh).length);
  let fresh = 0;
  for (let i = 0; i < rest.length; i++) {
    if (i >= gap && fresh >= need) return i;
    if (isFresh(rest[i])) fresh++;
  }
  return rest.length;
}

// Смахивание. Возвращает новое занятие, новый прогресс и recalled - вспомнил ли слово.
function swipe(s, progress, now) {
  if (isFinished(s)) return { s, progress, recalled: false };
  const [key, ...rest] = s.queue;
  const remembered = !s.revealed;
  const p = progress[key];
  const steps = { ...s.steps };
  const next = { ...progress };
  const base = { flipped: false, ipaShown: false, revealed: false };
  const seen = s.seen.includes(key) ? s.seen : [...s.seen, key];

  const finish = (rec) => {
    if (rec) next[key] = { ...rec, last: now };
    delete steps[key];
    return { s: withCounts({ ...s, ...base, queue: rest, steps, seen }), progress: next, recalled: remembered };
  };
  const requeue = (stepIdx) => {
    steps[key] = stepIdx;
    const q = rest.slice();
    q.splice(requeuePos(rest, steps, STEPS[stepIdx]), 0, key);
    return { s: withCounts({ ...s, ...base, queue: q, steps, seen }), progress: next, recalled: remembered };
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

// Подстраивает занятие под новый список слов: удаленные убираем, новые (в плане) добавляем в конец.
// Если передан now: слова, на которые сегодня уже ответили в другом списке, из очереди
// плана убираются и засчитываются как пройденные (иначе они показались бы второй раз).
function merge(s, cards, progress, now) {
  const keys = uniqueKeys(cards);
  const has = new Set(keys);
  const kept = s.queue.filter((k) => has.has(k));
  const handled = now === undefined || s.practice ? [] : kept.filter((k) => !(k in s.steps) && !s.seen.includes(k) && answeredToday(progress[k], now));
  const queue = kept.filter((k) => !handled.includes(k));
  const added = s.practice ? [] : keys.filter((k) => !progress[k] && !queue.includes(k) && !s.seen.includes(k));
  const steps = {};
  for (const k of Object.keys(s.steps)) if (has.has(k)) steps[k] = s.steps[k];
  const sameFront = queue[0] === s.queue[0];
  return withCounts({
    ...s,
    queue: [...queue, ...added],
    steps,
    seen: s.seen.filter((k) => has.has(k)),
    pre: s.pre + handled.length,
    flipped: sameFront && s.flipped,
    ipaShown: sameFront && s.ipaShown,
    revealed: sameFront && s.revealed,
  });
}

// Нужно ли собрать занятие заново (наступил новый день).
function isStale(s, now) {
  return !s || s.day !== dayOf(now);
}

// Сколько слов списка еще ждут сегодня (по расписанию или новые).
function remainingToday(cards, progress, now) {
  return uniqueKeys(cards).filter((k) => !progress[k] || isDue(progress[k], now)).length;
}

// Сколько слабых слов списка еще можно потренировать сегодня.
function weakLeft(cards, progress, now, okToday = new Set()) {
  return uniqueKeys(cards).filter((k) => isWeak(progress[k], now) && !okToday.has(k)).length;
}

function hasNew(cards, progress) {
  return uniqueKeys(cards).some((k) => !progress[k]);
}

function serialize(s) {
  const { day, practice, queue, steps, pre, seen } = s;
  return JSON.stringify({ v: 5, day, practice, queue, steps, pre, seen });
}

function restore(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || (o.v !== 4 && o.v !== 5) || !Array.isArray(o.queue) || typeof o.day !== 'string') return null;
    if (!o.queue.every((k) => typeof k === 'string') || new Set(o.queue).size !== o.queue.length) return null;
    const steps = o.steps && typeof o.steps === 'object' ? o.steps : {};
    const practice = o.practice === true ? 'weak' : o.practice === 'weak' || o.practice === 'all' ? o.practice : false;
    const seen = o.v === 5 && Array.isArray(o.seen) ? o.seen.filter((k) => typeof k === 'string') : [];
    const pre = o.v === 5 ? o.pre | 0 : o.done | 0; // v4: done считал каждое смахивание - берем как "пройдено"
    return withCounts({ day: o.day, practice, queue: o.queue, steps, pre, seen, flipped: false, ipaShown: false, revealed: false });
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
  DAY, INTERVALS, STEPS, FRESH_BETWEEN, keyOf, hasIpa, dayOf, shuffle, difficultyOrder, isWeak,
  buildSession, current, position, isFinished, flip, toggleIpa, swipe, merge, isStale,
  remainingToday, weakLeft, hasNew, serialize, restore, restoreProgress,
};
if (typeof module !== 'undefined') module.exports = Srs;
