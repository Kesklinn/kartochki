// Чтение слов из Google-таблицы (CSV).
// Столбцы: Русский | Английский | Транскрипция | Чтение | Список. Первая строка - заголовок.
// В "Список" можно несколько названий через запятую; пусто - слово только во "Все слова".

const SHEET_ID = '17X-eUQzulBYLosELbQ4PD_6HL-trYI9AO11DLDUcr50';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&headers=1';

// CSV по RFC 4180: кавычки, запятые и переносы строк внутри кавычек.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function rowsToCards(rows) {
  const out = [];
  rows.forEach((r, i) => {
    const [ru = '', en = '', ipa = '', read = '', list = ''] = r.map((x) => (x || '').trim());
    if (i === 0 && /^русск/i.test(ru)) return; // заголовок
    if (!ru || !en) return; // пустые и недописанные строки пропускаем
    const lists = [...new Set(list.split(',').map((x) => x.trim()).filter(Boolean))];
    out.push({ ru, en, ipa, read, lists });
  });
  return out;
}

async function fetchCards(fetchFn = fetch, url = SHEET_URL) {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error('таблица закрыта (нет доступа по ссылке)');
  const cards = rowsToCards(parseCSV(text));
  if (!cards.length) throw new Error('в таблице нет слов');
  return cards;
}

const Sheet = { SHEET_ID, SHEET_URL, parseCSV, rowsToCards, fetchCards };
if (typeof module !== 'undefined') module.exports = Sheet;
