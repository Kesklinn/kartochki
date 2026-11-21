// Проверка собранной страницы в jsdom: тапы, смахивание, транскрипция, списки, таблица, повторение.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const CARDS = require('../src/cards.js');
const S = require('../src/srs.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const SESS = 'nnn-srs-sessions-v1';
const PROG = 'nnn-srs-progress-v1';
const T0 = new Date(2026, 10, 21, 12, 0).getTime();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open({ storage, sheet, now = T0 } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(win) {
      if (storage) for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v);
      win.fetch = sheet
        ? async () => ({ ok: true, status: 200, text: async () => (typeof sheet === 'function' ? sheet() : sheet) })
        : async () => { throw new Error('offline'); };
      win.__now = now;
      win.Date.now = () => win.__now;
      let vis = 'visible';
      Object.defineProperty(win.document, 'visibilityState', { get: () => vis });
      win.__setVis = (v) => { vis = v; };
    },
  });
  await dom.window.flashcardsReady;
  const w = dom.window, d = w.document;
  const $ = (id) => d.getElementById(id);
  const ptr = (type, x, y = 300) => d.querySelector('.card').dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  const swipe = async () => { ptr('pointerdown', 300); ptr('pointermove', 250); ptr('pointermove', 100); ptr('pointerup', 100); await sleep(220); };
  const ls = () => ({ [SESS]: w.localStorage.getItem(SESS), [PROG]: w.localStorage.getItem(PROG) });
  return { dom, w, d, $, ptr, swipe, ls, word: () => $('word').textContent, side: () => $('face').dataset.side };
}

const byRu = (t) => CARDS.find((c) => c.ru === t);
// Занятие, где первым идет слово с номером i из встроенных
const startWith = (i) => {
  const keys = CARDS.map(S.keyOf);
  const sess = { v: 4, day: S.dayOf(T0), practice: false, queue: [keys[i], ...keys.filter((_, j) => j !== i)], steps: {}, total: keys.length, done: 0 };
  return { [SESS]: JSON.stringify({ current: '__all__', sessions: { __all__: JSON.stringify(sess) } }) };
};

test('кнопок "Знаю", "Не знаю", "Заново" нет', async () => {
  const { $ } = await open();
  assert.equal($('know'), null);
  assert.equal($('dontknow'), null);
  assert.equal($('restart'), null);
});

test('старт: русское слово, без подсказки и без кнопки транскрипции', async () => {
  const { $, word, d } = await open();
  assert.ok(byRu(word()));
  assert.equal($('hint').hidden, true);
  assert.equal(d.querySelector('main').textContent.includes('перевернуть'), false);
  assert.equal($('ipaBtn').hidden, true);
  assert.equal($('counter').textContent, '1 / 24');
});

test('тап в любое место экрана переворачивает, кроме кнопок', async () => {
  const { $, d, side } = await open({ storage: startWith(5) }); // невероятно
  d.querySelector('.card').click(); assert.equal(side(), 'en');
  d.querySelector('main').click(); assert.equal(side(), 'ru');
  $('status').click(); assert.equal(side(), 'en');
  $('ipaBtn').click(); assert.equal(side(), 'en', 'кнопка транскрипции не переворачивает');
  assert.equal($('ipaBtn').hidden, true);
  assert.equal($('ipaBox').hidden, false);
  $('ipaBox').click(); assert.equal(side(), 'ru', 'тап по транскрипции переворачивает');
  $('listBtn').click(); d.querySelector('.pick').click();
  assert.equal(side(), 'ru', 'меню списков не переворачивает');
});

test('транскрипция: кнопка исчезает, на ее месте транскрипция; после переворота снова кнопка', async () => {
  const { $, word, d } = await open({ storage: startWith(5) });
  const card = CARDS[5];
  d.querySelector('.card').click();
  assert.equal(word(), card.en);
  $('ipaBtn').click();
  assert.equal($('ipa').textContent, card.ipa);
  assert.equal($('read').textContent, card.read);
  d.querySelector('.card').click(); d.querySelector('.card').click();
  assert.equal($('ipaBtn').hidden, false);
  assert.equal($('ipaBox').hidden, true);
});

test('для слов без транскрипции кнопки нет', async () => {
  const { $, word, d } = await open({ storage: startWith(2) });
  assert.equal(word(), 'идёт дождь');
  d.querySelector('.card').click();
  assert.equal($('ipaBtn').hidden, true);
});

test('смахнул, не переворачивая = помню: слово уходит до следующего повторения', async () => {
  const { $, word, swipe, w } = await open({ storage: startWith(5) });
  await swipe();
  assert.equal($('counter').textContent, '2 / 24');
  assert.notEqual(word(), 'невероятно');
  const p = JSON.parse(w.localStorage.getItem(PROG));
  const k = S.keyOf(CARDS[5]);
  assert.equal(p[k].lvl, 2);
  assert.equal(Math.round((p[k].due - T0) / S.DAY), 3, 'через 3 дня');
});

test('перевернул и смахнул = не помню: слово вернется через 3 карточки; счетчик не прыгает, ↻ показывает повторы', async () => {
  const { $, word, swipe, d } = await open({ storage: startWith(5) });
  d.querySelector('.card').click(); // посмотрел ответ
  await swipe();
  assert.equal($('counter').textContent, '2 / 24', 'второе число не выросло');
  assert.equal($('relearn').textContent, '↻ 1');
  assert.equal($('face').dataset.side, 'ru', 'следующая карточка русской стороной');
  for (let i = 0; i < 3; i++) await swipe();
  assert.equal(word(), 'невероятно');
  assert.equal($('counter').textContent, '4 / 24', 'на повторе номер не растет - это не новое слово');
  await swipe();
  assert.equal($('counter').textContent, '5 / 24');
});

test('click после жеста карточку не переворачивает', async () => {
  const { $, d, swipe } = await open();
  await swipe();
  d.querySelector('.card').click();
  assert.equal($('face').dataset.side, 'ru');
});

test('короткое смахивание, вправо или вертикальное - ничего не происходит', async () => {
  const { $, ptr, d } = await open();
  const go = async (x0, x1, y0 = 300, y1 = 300) => { ptr('pointerdown', x0, y0); ptr('pointermove', x1, y1); ptr('pointerup', x1, y1); await sleep(220); };
  await go(300, 270); await go(100, 300); await go(200, 190, 100, 400);
  assert.equal($('counter').textContent, '1 / 24');
  assert.equal(d.querySelector('.card').style.transform, '');
});

test('план выполнен: слабые слова на тренировку, знакомые - нет; потом "Отлично!"', async () => {
  const sheet = '"Русский","Английский"\n"тихо","quietly"\n"очередь","queue"\n"окно","window"\n';
  const t = await open({ sheet });
  let forgot = false;
  for (let i = 0; i < 12 && !t.$('mode').textContent; i++) {
    if (t.word() === 'окно' && !forgot) { t.$('face').click(); forgot = true; } // "окно" забыл один раз
    await t.swipe();
  }
  assert.match(t.$('mode').textContent, /слабые слова/);
  assert.equal(t.word(), 'окно', 'тренируется только забытое сегодня слово');
  assert.equal(t.$('counter').textContent, '1 / 1');
  await t.swipe(); // вспомнил
  assert.equal(t.word(), 'Отлично!');
  assert.equal(t.$('again').hidden, false);
  assert.match(t.$('hint').textContent, /закреплены/);
});

test('все слова знакомые - после плана сразу "Отлично!", знакомые слова не крутятся', async () => {
  const sheet = '"Русский","Английский"\n"тихо","quietly"\n"очередь","queue"\n';
  const t = await open({ sheet });
  await t.swipe(); await t.swipe();
  assert.equal(t.word(), 'Отлично!');
  t.$('again').click(); // "Повторить все еще раз" - по желанию
  assert.match(t.$('mode').textContent, /Повтор всех слов/);
  assert.equal(t.$('counter').textContent, '1 / 2');
  await t.swipe(); await t.swipe();
  assert.equal(t.word(), 'Отлично!');
});

test('через 3 дня слова снова в плане', async () => {
  const sheet = '"Русский","Английский"\n"тихо","quietly"\n"очередь","queue"\n';
  const t = await open({ sheet });
  await t.swipe(); await t.swipe();
  const t2 = await open({ storage: t.ls(), sheet, now: T0 + 1 * S.DAY });
  assert.equal(t2.word(), 'Отлично!');
  const t3 = await open({ storage: t.ls(), sheet, now: T0 + 3 * S.DAY });
  assert.equal(t3.$('mode').textContent, '');
  assert.equal(t3.$('counter').textContent, '1 / 2');
});

test('приложение висело в фоне до следующего дня - при возвращении новый план', async () => {
  const sheet = '"Русский","Английский"\n"тихо","quietly"\n';
  const t = await open({ sheet });
  t.$('face').click(); await t.swipe();          // забыл
  await t.swipe(); await t.swipe();               // два закрепления
  assert.match(t.$('mode').textContent, /слабые слова/);
  await t.swipe();                                 // вспомнил в тренировке
  assert.equal(t.word(), 'Отлично!');
  t.w.__now = T0 + S.DAY;
  t.w.__setVis('hidden'); t.d.dispatchEvent(new t.w.Event('visibilitychange'));
  t.w.__setVis('visible'); t.d.dispatchEvent(new t.w.Event('visibilitychange'));
  await t.w.flashcardsReady;
  assert.equal(t.$('mode').textContent, '', 'снова план');
  assert.equal(t.word(), 'тихо');
});

test('прогресс переживает перезагрузку', async () => {
  const t = await open();
  await t.swipe(); await t.swipe();
  assert.equal(t.$('counter').textContent, '3 / 24');
  const t2 = await open({ storage: t.ls() });
  assert.equal(t2.$('counter').textContent, '3 / 24');
  assert.equal(t2.word(), t.word());
});

test('слова из таблицы: новые добавляются в занятие, слова кэшируются для работы без сети', async () => {
  const t = await open();
  await t.swipe();
  const csv = fs.readFileSync(path.join(__dirname, 'words.csv'), 'utf8') + '"дверь","door","/dɔː/","«до»","Первый список"\n';
  const t2 = await open({ storage: t.ls(), sheet: csv });
  assert.equal(t2.$('counter').textContent, '2 / 25');
  assert.equal(t2.$('status').textContent, '');
  const cached = t2.w.localStorage.getItem('nnn-words-v2');
  assert.equal(JSON.parse(cached).length, 25);
  const t3 = await open({ storage: { ...t2.ls(), 'nnn-words-v2': cached } });
  assert.equal(t3.$('counter').textContent, '2 / 25');
  assert.match(t3.$('status').textContent, /Не удалось обновить/);
});

test('без интернета внизу ничего не пишется', async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.test/',
    beforeParse(win) {
      Object.defineProperty(win.navigator, 'onLine', { get: () => false });
      win.fetch = async () => { throw new Error('offline'); };
    },
  });
  await dom.window.flashcardsReady;
  assert.equal(dom.window.document.getElementById('status').textContent, '');
});

test('закрытая таблица не ломает приложение', async () => {
  const { $, word } = await open({ sheet: '<!DOCTYPE html><html>sign in' });
  assert.ok(byRu(word()));
  assert.match($('status').textContent, /Не удалось обновить/);
});

test('работает без localStorage', async () => {
  const dom = new JSDOM(html.replace('<script>', '<script>Object.defineProperty(window,"localStorage",{get(){throw new Error("blocked")}});'), {
    runScripts: 'dangerously', url: 'https://example.test/',
  });
  await dom.window.flashcardsReady;
  assert.ok(dom.window.document.getElementById('word').textContent.length > 0);
});

test('тема всегда темная', () => {
  assert.match(html, /color-scheme:dark}/);
  assert.doesNotMatch(html, /prefers-color-scheme/);
});

const LISTS_CSV = '"Русский","Английский","Транскрипция","Чтение","Список"\n' +
  '"очередь","queue","/kjuː/","«кью»","NNN"\n' +
  '"огромный","huge","","","NNN, Урок 5"\n' +
  '"дверь","door","","","Урок 5"\n' +
  '"окно","window","","",""\n';

test('меню списков: сколько слов еще ждут сегодня, "✓" - план выполнен', async () => {
  const t = await open({ sheet: LISTS_CSV });
  t.$('listBtn').click();
  let items = [...t.d.querySelectorAll('.pick')].map((b) => b.textContent);
  assert.deepEqual(items, ['Все словаеще 4', 'NNNеще 2', 'Урок 5еще 2', 'Без спискаеще 1']);
  t.d.querySelector('.pick[data-list="__none__"]').click();
  await t.swipe(); // "окно" вспомнил
  t.$('listBtn').click();
  items = [...t.d.querySelectorAll('.pick')].map((b) => b.textContent);
  assert.deepEqual(items, ['Все словаеще 3', 'NNNеще 2', 'Урок 5еще 2', 'Без списка✓']);
});

test('выбор списка показывает только его слова; выученное в одном списке выучено и в другом', async () => {
  const t = await open({ sheet: LISTS_CSV });
  const pick = (name) => { t.$('listBtn').click(); t.d.querySelector('.pick[data-list="' + name + '"]').click(); };
  pick('Урок 5');
  assert.equal(t.$('listName').textContent, 'Урок 5');
  assert.equal(t.$('counter').textContent, '1 / 2');
  assert.ok(['огромный', 'дверь'].includes(t.word()));
  const first = t.word();
  await t.swipe();
  pick('NNN');
  // если вспомнил "огромный" в Уроке 5, в NNN он сегодня уже засчитан и не показывается
  assert.equal(t.$('counter').textContent, first === 'огромный' ? '2 / 2' : '1 / 2');
  if (first === 'огромный') assert.equal(t.word(), 'очередь');
  pick('Урок 5');
  assert.equal(t.$('counter').textContent, '2 / 2', 'занятие Урока 5 продолжается');
  const t2 = await open({ storage: t.ls(), sheet: LISTS_CSV });
  assert.equal(t2.$('listName').textContent, 'Урок 5');
  assert.equal(t2.$('counter').textContent, '2 / 2');
});

test('если выбранный список удален из таблицы, открываются все слова', async () => {
  const t = await open({ sheet: LISTS_CSV });
  t.$('listBtn').click();
  t.d.querySelector('.pick[data-list="Урок 5"]').click();
  const t2 = await open({ storage: t.ls(), sheet: LISTS_CSV.replace(/Урок 5/g, 'NNN') });
  assert.equal(t2.$('listName').textContent, 'Все слова');
});

test('меню закрывается тапом мимо и клавишей Esc', async () => {
  const { $, w } = await open({ sheet: LISTS_CSV });
  $('listBtn').click();
  $('picker').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($('picker').hidden, true);
  $('listBtn').click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal($('picker').hidden, true);
});

test('при возвращении в приложение слова подтягиваются заново', async () => {
  let csv = '"Русский","Английский","Транскрипция","Чтение","Список"\n"очередь","queue","","","A"\n';
  const t = await open({ sheet: () => csv });
  assert.equal(t.$('counter').textContent, '1 / 1');
  csv += '"дверь","door","","","A"\n';
  t.w.__setVis('hidden'); t.d.dispatchEvent(new t.w.Event('visibilitychange'));
  t.w.__now += 60000;
  t.w.__setVis('visible'); t.d.dispatchEvent(new t.w.Event('visibilitychange'));
  await t.w.flashcardsReady;
  assert.equal(t.$('counter').textContent, '1 / 2');
});

test('частые переключения не дергают таблицу чаще раза в 20 секунд', async () => {
  let calls = 0;
  const t = await open({ sheet: () => { calls++; return '"Русский","Английский"\n"тихо","quietly"\n'; } });
  for (let i = 0; i < 5; i++) { t.w.__now += 1000; t.d.dispatchEvent(new t.w.Event('visibilitychange')); }
  await t.w.flashcardsReady;
  assert.equal(calls, 1);
  t.w.__now += 30000; t.d.dispatchEvent(new t.w.Event('visibilitychange'));
  await t.w.flashcardsReady;
  assert.equal(calls, 2);
});

test('тап сразу после смахивания пальцем переворачивает (жест без click)', async () => {
  const { $, d, w, ptr } = await open();
  ptr('pointerdown', 300); ptr('pointermove', 250); ptr('pointermove', 100); ptr('pointerup', 100);
  await sleep(220); // палец не шлет click после жеста; сразу новый тап
  ptr('pointerdown', 200); ptr('pointerup', 200);
  d.querySelector('.card').click();
  assert.equal($('face').dataset.side, 'en');
});

test('тап пальцем переворачивает один раз, даже если следом придет click', async () => {
  const { $, d, w } = await open();
  const card = d.querySelector('.card');
  const pe = (type) => { const e = new w.MouseEvent(type, { bubbles: true, clientX: 200, clientY: 300, button: 0 }); Object.defineProperty(e, 'pointerType', { value: 'touch' }); card.dispatchEvent(e); };
  pe('pointerdown'); pe('pointerup');
  assert.equal($('face').dataset.side, 'en', 'перевернулось на отпускании пальца');
  card.click(); // click от того же тапа
  assert.equal($('face').dataset.side, 'en', 'и не перевернулось обратно');
});

// --- возврат карточки, клавиатура, порог 1/5 ---
const swipeTo = async (t, dx) => { t.ptr('pointerdown', 200); t.ptr('pointermove', 200 + dx / 2); t.ptr('pointermove', 200 + dx); t.ptr('pointerup', 200 + dx); await sleep(220); };
const key = (t, k) => t.d.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('смахивание вправо возвращает предыдущую карточку и отменяет оценку', async () => {
  const t = await open({ storage: startWith(5) }); // невероятно
  await t.swipe();
  assert.equal(t.$('counter').textContent, '2 / 24');
  assert.ok(JSON.parse(t.w.localStorage.getItem(PROG))[S.keyOf(CARDS[5])], 'оценка записана');
  await swipeTo(t, +150);
  assert.equal(t.word(), 'невероятно');
  assert.equal(t.$('counter').textContent, '1 / 24');
  assert.equal(JSON.parse(t.w.localStorage.getItem(PROG))[S.keyOf(CARDS[5])], undefined, 'оценка отменена');
});

test('вернул карточку, ответ которой уже видел - она все равно "не помню"', async () => {
  const t = await open({ storage: startWith(5) });
  t.d.querySelector('.card').click();        // посмотрел ответ
  await t.swipe();                            // не помню
  await swipeTo(t, +150);                     // вернул
  assert.equal(t.word(), 'невероятно');
  assert.equal(t.$('face').dataset.side, 'ru', 'вернулась русской стороной');
  await t.swipe();                            // смахнул, не переворачивая
  const p = JSON.parse(t.w.localStorage.getItem(PROG))[S.keyOf(CARDS[5])];
  assert.equal(p.lvl, 0, 'засчитано как "не помню"');
});

test('возврат на несколько карточек назад, в том числе с карточки "Отлично!"', async () => {
  const sheet = '"Русский","Английский"\n"тихо","quietly"\n"очередь","queue"\n"окно","window"\n';
  const t = await open({ sheet });
  const seen = [];
  for (let i = 0; i < 3; i++) { seen.push(t.word()); await t.swipe(); }
  assert.equal(t.word(), 'Отлично!');
  await swipeTo(t, +150); assert.equal(t.word(), seen[2]);
  await swipeTo(t, +150); assert.equal(t.word(), seen[1]);
  await swipeTo(t, +150); assert.equal(t.word(), seen[0]);
  await swipeTo(t, +150); assert.equal(t.word(), seen[0], 'дальше начала занятия некуда');
  assert.equal(t.w.localStorage.getItem(PROG), '{}', 'все оценки отменены');
});

test('"назад" работает и после перезапуска приложения', async () => {
  const t = await open({ storage: startWith(5) });
  await t.swipe(); await t.swipe();
  const t2 = await open({ storage: { ...t.ls(), 'nnn-srs-history-v1': t.w.localStorage.getItem('nnn-srs-history-v1'), 'nnn-srs-ok-v1': t.w.localStorage.getItem('nnn-srs-ok-v1') } });
  assert.equal(t2.$('prev').disabled, false, 'стрелка назад доступна сразу после запуска');
  t2.$('prev').click(); await sleep(220);
  t2.$('prev').click(); await sleep(220);
  assert.equal(t2.word(), 'невероятно');
  assert.equal(t2.$('counter').textContent, '1 / 24');
  // на следующий день вчерашняя история не действует
  const t3 = await open({ storage: { ...t.ls(), 'nnn-srs-history-v1': t.w.localStorage.getItem('nnn-srs-history-v1') }, now: T0 + S.DAY });
  assert.equal(t3.$('prev').disabled, true);
});

test('порог смахивания - 1/5 ширины карточки', async () => {
  const t = await open();
  Object.defineProperty(t.d.querySelector('.card'), 'clientWidth', { get: () => 350 }); // порог 70 px
  await swipeTo(t, -65);
  assert.equal(t.$('counter').textContent, '1 / 24', '65 px - мало');
  await swipeTo(t, -75);
  assert.equal(t.$('counter').textContent, '2 / 24', '75 px - достаточно');
  await swipeTo(t, +65);
  assert.equal(t.$('counter').textContent, '2 / 24');
  await swipeTo(t, +75);
  assert.equal(t.$('counter').textContent, '1 / 24');
});

test('клавиши: пробел - перевернуть, стрелка вправо - дальше, стрелка влево - назад', async () => {
  const f = await open();
  key(f, ' ');
  assert.equal(f.$('face').dataset.side, 'en');
  key(f, ' ');
  assert.equal(f.$('face').dataset.side, 'ru');
  const t = await open({ storage: startWith(5) });
  key(t, 'ArrowRight'); await sleep(220);
  assert.equal(t.$('counter').textContent, '2 / 24');
  key(t, 'ArrowRight'); key(t, 'ArrowRight'); await sleep(220); // двойное нажатие во время анимации
  assert.equal(t.$('counter').textContent, '3 / 24', 'засчитано одно нажатие');
  key(t, 'ArrowLeft'); await sleep(220);
  key(t, 'ArrowLeft'); await sleep(220);
  assert.equal(t.word(), 'невероятно');
  assert.equal(t.$('counter').textContent, '1 / 24');
});

test('стрелки на экране: › - дальше, ‹ - назад; не переворачивают; недоступные выключены', async () => {
  const sheet = '"Русский","Английский"\n"тихо","quietly"\n"окно","window"\n';
  const t = await open({ sheet });
  const first = t.word();
  assert.equal(t.$('prev').disabled, true, 'назад некуда');
  t.$('next').click(); await sleep(220);
  assert.equal(t.$('counter').textContent, '2 / 2');
  assert.equal(t.$('face').dataset.side, 'ru', 'кнопка не переворачивает');
  assert.equal(t.$('prev').disabled, false);
  t.$('next').click(); await sleep(220);
  assert.equal(t.word(), 'Отлично!');
  assert.equal(t.$('next').disabled, true, 'дальше некуда');
  t.$('prev').click(); await sleep(220);
  t.$('prev').click(); await sleep(220);
  assert.equal(t.word(), first);
  assert.equal(t.$('prev').disabled, true);
  assert.match(t.$('prev').innerHTML, /<svg/, 'стрелка нарисована, а не символом шрифта');
});

test('при открытом меню списков клавиши не трогают карточку', async () => {
  const t = await open();
  t.$('listBtn').click();
  key(t, 'ArrowRight'); key(t, ' '); await sleep(220);
  assert.equal(t.$('counter').textContent, '1 / 24');
  assert.equal(t.$('face').dataset.side, 'ru');
});

test('возврат работает только в пределах занятия: другой список - история сброшена', async () => {
  const t = await open({ sheet: LISTS_CSV });
  await t.swipe();
  t.$('listBtn').click(); t.d.querySelector('.pick[data-list="Урок 5"]').click();
  const before = t.$('counter').textContent;
  await swipeTo(t, +150);
  assert.equal(t.$('counter').textContent, before);
});

test('"Отлично!": кнопка "Другой список" открывает меню', async () => {
  const t = await open({ sheet: LISTS_CSV });
  for (let i = 0; i < 4; i++) await t.swipe();
  assert.equal(t.word(), 'Отлично!');
  assert.equal(t.$('other').hidden, false);
  t.$('other').click();
  assert.equal(t.$('picker').hidden, false);
  assert.equal(t.$('face').dataset.side, 'done', 'кнопка не переворачивает');
});

test('добавили слова в таблицу после плана - сразу к новым словам', async () => {
  let csv = '"Русский","Английский"\n"тихо","quietly"\n';
  const t = await open({ sheet: () => csv });
  await t.swipe();
  assert.equal(t.word(), 'Отлично!');
  csv += '"окно","window"\n';
  t.w.__now += 60000;
  t.d.dispatchEvent(new t.w.Event('visibilitychange'));
  await t.w.flashcardsReady;
  assert.equal(t.$('mode').textContent, '');
  assert.equal(t.word(), 'окно');
});

test('список выполнен - автоматически следующий список, где сегодня есть работа', async () => {
  const t = await open({ sheet: LISTS_CSV });
  t.$('listBtn').click(); t.d.querySelector('.pick[data-list="Урок 5"]').click();
  await t.swipe(); await t.swipe(); // огромный, дверь
  assert.equal(t.$('listName').textContent, 'NNN', 'перешли в список, где еще есть слова');
  assert.match(t.$('mode').textContent, /«Урок 5» выполнен → «NNN»/);
  assert.equal(t.word(), 'очередь', '"огромный" уже ответили в Уроке 5 - его не повторяем');
  assert.equal(t.$('counter').textContent, '2 / 2', '"огромный" засчитан');
  await t.swipe();
  assert.equal(t.$('listName').textContent, 'Без списка');
  assert.equal(t.word(), 'окно');
  await t.swipe();
  // работы нигде не осталось, слабых слов нет (все сразу вспомнил)
  assert.equal(t.word(), 'Отлично!');
});

test('возврат карточки работает и через автопереход между списками', async () => {
  const t = await open({ sheet: LISTS_CSV });
  t.$('listBtn').click(); t.d.querySelector('.pick[data-list="Урок 5"]').click();
  await t.swipe(); const last = t.word(); await t.swipe();
  assert.equal(t.$('listName').textContent, 'NNN');
  await swipeTo(t, +150);
  assert.equal(t.$('listName').textContent, 'Урок 5');
  assert.equal(t.word(), last);
  assert.equal(t.$('mode').textContent, '');
});

test('вручную выбранный выполненный список: его слабые слова, без чужих', async () => {
  const t = await open({ sheet: LISTS_CSV });
  t.$('listBtn').click(); t.d.querySelector('.pick[data-list="Урок 5"]').click();
  const first = t.word();
  t.$('face').click(); await t.swipe(); // первое слово Урока 5 забыл
  while (t.$('listName').textContent === 'Урок 5' && !t.$('mode').textContent) await t.swipe();
  // план всех списков доделываем, слабое слово - только first
  for (let i = 0; i < 10 && t.word() !== 'Отлично!' && !/слабые/.test(t.$('mode').textContent); i++) await t.swipe();
  t.$('listBtn').click(); t.d.querySelector('.pick[data-list="Урок 5"]').click();
  assert.equal(t.$('listName').textContent, 'Урок 5');
  assert.match(t.$('mode').textContent, /слабые слова/);
  assert.equal(t.word(), first);
  await t.swipe();
  assert.equal(t.word(), 'Отлично!', 'слабых больше нет - не по кругу');
});

