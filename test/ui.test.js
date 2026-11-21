// Проверка собранной страницы в jsdom: клики, транскрипция, сохранение, загрузка из таблицы.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const CARDS = require('../src/cards.js');
const D = require('../src/deck.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const KEY = 'nnn-flashcards-v3';

async function open({ storage, sheet } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    beforeParse(win) {
      if (storage) for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v);
      win.fetch = sheet
        ? async () => ({ ok: true, status: 200, text: async () => sheet })
        : async () => { throw new Error('offline'); };
    },
  });
  await dom.window.flashcardsReady;
  const d = dom.window.document;
  const $ = (id) => d.getElementById(id);
  return { dom, d, $, word: () => $('word').textContent };
}

const byRu = (t) => CARDS.find((c) => c.ru === t);
const startWith = (i) => {
  const keys = CARDS.map(D.keyOf);
  const sess = JSON.stringify({ v: 2, queue: [keys[i], ...keys.filter((_, j) => j !== i)], doneKeys: [] });
  return JSON.stringify({ current: '__all__', sessions: { __all__: sess } });
};

test('старт: русское слово, без подсказки и без кнопки', async () => {
  const { $, word, d } = await open();
  assert.ok(byRu(word()));
  assert.equal($('hint').hidden, true);
  assert.equal(d.body.textContent.includes('перевернуть'), false);
  assert.equal($('ipaBtn').hidden, true);
  assert.equal($('counter').textContent, '1 / 24');
});

test('кнопка исчезает, на ее месте транскрипция; после переворота снова кнопка', async () => {
  const { $, word } = await open({ storage: { [KEY]: startWith(5) } }); // невероятно
  const card = CARDS[5];
  assert.equal(word(), card.ru);
  $('face').click();
  assert.equal(word(), card.en);
  assert.equal($('ipaBtn').hidden, false);
  assert.equal($('ipaBox').hidden, true);
  $('ipaBtn').click();
  assert.equal($('ipaBtn').hidden, true);
  assert.equal($('ipaBox').hidden, false);
  assert.equal($('ipa').textContent, card.ipa);
  assert.equal($('read').textContent, card.read);
  assert.equal(word(), card.en);
  $('face').click(); $('face').click();
  assert.equal($('ipaBtn').hidden, false);
  assert.equal($('ipaBox').hidden, true);
});

test('для слов без транскрипции кнопки нет', async () => {
  const { $, word } = await open({ storage: { [KEY]: startWith(2) } });
  assert.equal(word(), 'идёт дождь');
  $('face').click();
  assert.equal($('ipaBtn').hidden, true);
});

test('прогресс переживает перезагрузку', async () => {
  const t = await open();
  t.$('know').click(); t.$('know').click();
  assert.equal(t.$('counter').textContent, '3 / 24');
  const t2 = await open({ storage: { [KEY]: t.dom.window.localStorage.getItem(KEY) } });
  assert.equal(t2.$('counter').textContent, '3 / 24');
  assert.equal(t2.word(), t.word());
});

test('вся колода и "Заново"', async () => {
  const { $, word } = await open();
  $('dontknow').click();
  for (let i = 0; i < 24; i++) $('know').click();
  assert.equal(word(), 'Готово!');
  assert.equal($('know').disabled, true);
  $('restart').click();
  assert.equal($('counter').textContent, '1 / 24');
});

test('слова из таблицы: новые добавляются, пройденные сохраняются, слова кэшируются', async () => {
  const t = await open();
  t.$('know').click();
  const saved = t.dom.window.localStorage.getItem(KEY);
  const csv = fs.readFileSync(require('path').join(__dirname, 'words.csv'), 'utf8') + '"дверь","door","/dɔː/","«до»"\n';
  const t2 = await open({ storage: { [KEY]: saved }, sheet: csv });
  assert.equal(t2.$('counter').textContent, '2 / 25');
  assert.match(t2.$('status').textContent, /25/);
  const cached = JSON.parse(t2.dom.window.localStorage.getItem('nnn-words-v2'));
  assert.equal(cached.length, 25);
  // без сети: слова из памяти телефона, включая новое
  const t3 = await open({ storage: { [KEY]: t2.dom.window.localStorage.getItem(KEY), 'nnn-words-v2': JSON.stringify(cached) } });
  assert.equal(t3.$('counter').textContent, '2 / 25');
  assert.match(t3.$('status').textContent, /Нет связи/);
});

test('закрытая таблица не ломает приложение', async () => {
  const { $, word } = await open({ sheet: '<!DOCTYPE html><html>sign in' });
  assert.ok(byRu(word()));
  assert.match($('status').textContent, /Нет связи/);
});

test('работает без localStorage', async () => {
  const dom = new JSDOM(html.replace('<script>', '<script>Object.defineProperty(window,"localStorage",{get(){throw new Error("blocked")}});'), {
    runScripts: 'dangerously', url: 'https://example.test/',
  });
  await dom.window.flashcardsReady;
  const d = dom.window.document;
  assert.ok(d.getElementById('word').textContent.length > 0);
  d.getElementById('know').click();
  assert.equal(d.getElementById('counter').textContent, '2 / 24');
});

const LISTS_CSV = '"Русский","Английский","Транскрипция","Чтение","Список"\n' +
  '"очередь","queue","/kjuː/","«кью»","NNN"\n' +
  '"огромный","huge","","","NNN, Урок 5"\n' +
  '"дверь","door","","","Урок 5"\n' +
  '"окно","window","","",""\n';

test('кнопка списка: меню со всеми списками и прогрессом', async () => {
  const { $, d } = await open({ sheet: LISTS_CSV });
  assert.equal($('listName').textContent, 'Все слова');
  assert.equal($('counter').textContent, '1 / 4');
  $('listBtn').click();
  assert.equal($('picker').hidden, false);
  const items = [...d.querySelectorAll('.pick')].map((b) => b.textContent);
  assert.deepEqual(items, ['Все слова0 / 4', 'NNN0 / 2', 'Урок 50 / 2', 'Без списка0 / 1']);
});

test('выбор списка показывает только его слова; прогресс у каждого свой', async () => {
  const t = await open({ sheet: LISTS_CSV });
  const pick = (name) => { t.$('listBtn').click(); t.d.querySelector('.pick[data-list="' + name + '"]').click(); };
  pick('Урок 5');
  assert.equal(t.$('picker').hidden, true);
  assert.equal(t.$('listName').textContent, 'Урок 5');
  assert.equal(t.$('counter').textContent, '1 / 2');
  assert.ok(['огромный', 'дверь'].includes(t.word()));
  t.$('know').click();
  assert.equal(t.$('counter').textContent, '2 / 2');
  pick('NNN');
  assert.equal(t.$('counter').textContent, '1 / 2', 'у NNN свой прогресс');
  pick('Урок 5');
  assert.equal(t.$('counter').textContent, '2 / 2', 'прогресс Урока 5 сохранился');
  // после перезапуска открывается тот же список с тем же прогрессом
  const t2 = await open({ storage: { [KEY]: t.dom.window.localStorage.getItem(KEY) }, sheet: LISTS_CSV });
  assert.equal(t2.$('listName').textContent, 'Урок 5');
  assert.equal(t2.$('counter').textContent, '2 / 2');
});

test('если выбранный список удален из таблицы, открываются все слова', async () => {
  const t = await open({ sheet: LISTS_CSV });
  t.$('listBtn').click();
  t.d.querySelector('.pick[data-list="Урок 5"]').click();
  const noLesson = LISTS_CSV.replace(/Урок 5/g, 'NNN');
  const t2 = await open({ storage: { [KEY]: t.dom.window.localStorage.getItem(KEY) }, sheet: noLesson });
  assert.equal(t2.$('listName').textContent, 'Все слова');
});

test('меню закрывается тапом мимо и клавишей Esc', async () => {
  const { $, dom } = await open({ sheet: LISTS_CSV });
  $('listBtn').click();
  $('picker').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal($('picker').hidden, true);
  $('listBtn').click();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal($('picker').hidden, true);
});

test('прогресс прошлой версии переносится во "Все слова"', async () => {
  const keys = CARDS.map(D.keyOf);
  const old = JSON.stringify({ v: 2, queue: keys.slice(3), doneKeys: keys.slice(0, 3) });
  const { $ } = await open({ storage: { 'nnn-flashcards-v2': old } });
  assert.equal($('counter').textContent, '4 / 24');
});
