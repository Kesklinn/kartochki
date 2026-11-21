const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const S = require('../src/sheet.js');

test('CSV: кавычки, запятые и переносы внутри поля', () => {
  const rows = S.parseCSV('"a","b, c","say ""hi"""\r\n"x","line1\nline2",""\n');
  assert.deepEqual(rows, [['a', 'b, c', 'say "hi"'], ['x', 'line1\nline2', '']]);
});

test('CSV без кавычек и без перевода строки в конце', () => {
  assert.deepEqual(S.parseCSV('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('строки таблицы -> карточки: заголовок, пустые и неполные строки пропускаются', () => {
  const cards = S.rowsToCards([
    ['Русский', 'Английский', 'Транскрипция', 'Чтение'],
    [' очередь ', 'queue', '/kjuː/', '«кью»'],
    ['', '', '', ''],
    ['только русский', '', '', ''],
    ['огромный', 'huge'],
  ]);
  assert.deepEqual(cards, [
    { ru: 'очередь', en: 'queue', ipa: '/kjuː/', read: '«кью»', lists: [] },
    { ru: 'огромный', en: 'huge', ipa: '', read: '', lists: [] },
  ]);
});

test('реальный CSV, выгруженный в таблицу, читается без потерь', () => {
  const cards = S.rowsToCards(S.parseCSV(fs.readFileSync(require('path').join(__dirname, 'words.csv'), 'utf8')));
  assert.deepEqual(cards, require('../src/cards.js'));
});

const res = (ok, status, body) => ({ ok, status, text: async () => body });

test('загрузка: успешный ответ', async () => {
  const cards = await S.fetchCards(async () => res(true, 200, '"Русский","Английский"\n"тихо","quietly"'));
  assert.deepEqual(cards, [{ ru: 'тихо', en: 'quietly', ipa: '', read: '', lists: [] }]);
});

test('загрузка: закрытая таблица (Google отдает HTML входа)', async () => {
  await assert.rejects(S.fetchCards(async () => res(true, 200, '<!DOCTYPE html><html>login')), /закрыта/);
});

test('загрузка: ошибка сервера и пустая таблица', async () => {
  await assert.rejects(S.fetchCards(async () => res(false, 404, '')), /404/);
  await assert.rejects(S.fetchCards(async () => res(true, 200, '"Русский","Английский"\n')), /нет слов/);
});

test('столбец "Список": несколько через запятую, пробелы и повторы убираются', () => {
  const [c] = S.rowsToCards([['дверь', 'door', '', '', ' Урок 5 , NNN,Урок 5,, ']]);
  assert.deepEqual(c.lists, ['Урок 5', 'NNN']);
});
