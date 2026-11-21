// Интерфейс. Ожидает глобальные Deck, Sheet, Lists и CARDS (встроенные слова на случай без сети).
(function () {
  const KEY = 'nnn-flashcards-v3';      // выбранный список и прогресс по каждому списку
  const OLD_KEY = 'nnn-flashcards-v2';  // прогресс прошлой версии (одна общая колода)
  const WORDS_KEY = 'nnn-words-v2';     // последние слова из таблицы
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  function loadCachedWords() {
    try {
      const w = JSON.parse(store.get(WORDS_KEY));
      if (Array.isArray(w) && w.length && w.every((c) => c && c.ru && c.en && Array.isArray(c.lists))) return w;
    } catch {}
    return null;
  }

  // --- данные ---
  let cards = [];
  let byKey = new Map();
  function setCards(list) {
    cards = list;
    byKey = new Map(list.map((c) => [Deck.keyOf(c), c]));
  }
  setCards(loadCachedWords() || CARDS);

  let saved = {};
  try { saved = JSON.parse(store.get(KEY)) || {}; } catch {}
  const sessions = saved.sessions && typeof saved.sessions === 'object' ? saved.sessions : {};
  if (!sessions[Lists.ALL] && store.get(OLD_KEY)) sessions[Lists.ALL] = store.get(OLD_KEY); // перенос старого прогресса
  // preferred - список, выбранный пользователем; listName - открытый сейчас.
  // Они расходятся, пока выбранного списка нет в словах (например, до загрузки таблицы).
  let preferred = typeof saved.current === 'string' ? saved.current : Lists.ALL;
  let listName = preferred;

  let state;
  function openList(name) {
    if (!Lists.menuItems(cards).includes(name)) name = Lists.ALL;
    listName = name;
    const subset = Lists.cardsFor(cards, name);
    state = (sessions[name] && Deck.restore(sessions[name], subset)) || Deck.newSession(subset);
  }
  openList(listName);

  function persist() {
    sessions[listName] = Deck.serialize(state);
    store.set(KEY, JSON.stringify({ current: preferred, sessions }));
  }

  // --- отрисовка ---
  function setStatus(text) { $('status').textContent = text; }

  // Текст с формами через " - " (be - was - been): перенос строки только между формами,
  // а не посреди слова или транскрипции.
  function setParts(el, text) {
    el.textContent = '';
    String(text || '').split(' - ').forEach((part, i) => {
      if (i) el.append(' - ');
      const s = document.createElement('span');
      s.className = 'seg';
      s.textContent = part;
      el.append(s);
    });
  }

  function render() {
    $('listName').textContent = Lists.label(listName);
    const total = Deck.total(state);
    const done = Deck.done(state);
    const finished = Deck.isFinished(state);
    $('counter').textContent = (finished ? total : done + 1) + ' / ' + total;
    $('fill').style.width = (total ? done / total * 100 : 0) + '%';
    $('know').disabled = $('dontknow').disabled = finished;

    const ipaBtn = $('ipaBtn'), ipaBox = $('ipaBox'), hint = $('hint');

    if (finished) {
      $('face').dataset.side = 'done';
      $('word').textContent = total ? 'Готово!' : 'Пусто';
      hint.textContent = total ? 'Все ' + total + ' карточек пройдены. Нажмите «Заново».' : 'В этом списке нет слов.';
      hint.hidden = false;
      ipaBtn.hidden = ipaBox.hidden = true;
      return;
    }

    const card = byKey.get(Deck.current(state));
    hint.hidden = true;
    if (!state.flipped) {
      $('face').dataset.side = 'ru';
      $('word').textContent = card.ru;
      ipaBtn.hidden = ipaBox.hidden = true;
    } else {
      $('face').dataset.side = 'en';
      setParts($('word'), card.en);
      const has = Deck.hasIpa(card);
      // по нажатию кнопка исчезает, на ее месте появляется транскрипция
      ipaBtn.hidden = !has || state.ipaShown;
      ipaBtn.setAttribute('aria-expanded', String(state.ipaShown));
      ipaBox.hidden = !(has && state.ipaShown);
      setParts($('ipa'), card.ipa);
      setParts($('read'), card.read);
    }
  }

  function update(next) { state = next; persist(); render(); }

  // --- выбор списка ---
  function progressOf(name) {
    const subset = Lists.cardsFor(cards, name);
    const s = sessions[name] && Deck.restore(sessions[name], subset);
    return { total: subset.length, done: s ? Deck.done(s) : 0 };
  }

  function showPicker() {
    const box = $('pickerList');
    box.textContent = '';
    for (const name of Lists.menuItems(cards)) {
      const p = name === listName ? { total: Deck.total(state), done: Deck.done(state) } : progressOf(name);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (name === listName ? ' current' : '');
      b.dataset.list = name;
      const t = document.createElement('span'); t.textContent = Lists.label(name);
      const n = document.createElement('span'); n.className = 'cnt'; n.textContent = p.done + ' / ' + p.total;
      b.append(t, n);
      b.addEventListener('click', () => { hidePicker(); preferred = name; openList(name); persist(); render(); });
      box.append(b);
    }
    $('picker').hidden = false;
    $('listBtn').setAttribute('aria-expanded', 'true');
    const cur = box.querySelector('.current');
    if (cur) cur.focus();
  }
  function hidePicker() {
    $('picker').hidden = true;
    $('listBtn').setAttribute('aria-expanded', 'false');
  }

  $('listBtn').addEventListener('click', () => ($('picker').hidden ? showPicker() : hidePicker()));
  $('picker').addEventListener('click', (e) => { if (e.target === $('picker')) hidePicker(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('picker').hidden) hidePicker(); });

  // --- карточка ---
  $('face').addEventListener('click', () => update(Deck.flip(state)));
  $('face').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); update(Deck.flip(state)); }
  });
  $('ipaBtn').addEventListener('click', () => update(Deck.toggleIpa(state)));
  $('know').addEventListener('click', () => update(Deck.know(state)));
  $('dontknow').addEventListener('click', () => update(Deck.dontKnow(state)));
  $('restart').addEventListener('click', () => update(Deck.newSession(Lists.cardsFor(cards, listName))));

  persist();
  render();

  // Подтягиваем свежие слова из таблицы; без сети остаются сохраненные.
  async function refresh() {
    try {
      const fresh = await Sheet.fetchCards(window.fetch.bind(window));
      store.set(WORDS_KEY, JSON.stringify(fresh));
      setCards(fresh);
      const items = Lists.menuItems(cards);
      if (listName !== preferred && items.includes(preferred)) {
        persist();
        openList(preferred); // выбранный список появился после загрузки таблицы
      } else if (items.includes(listName)) {
        state = Deck.merge(state, Lists.cardsFor(cards, listName));
      } else {
        openList(Lists.ALL); // выбранный список исчез из таблицы
      }
      persist();
      render();
      if (!$('picker').hidden) showPicker();
      setStatus(''); // все в порядке - внизу ничего не пишем
    } catch (e) {
      // Без интернета это нормально - молчим. Сообщаем, только если интернет есть,
      // а таблица не отдалась (например, закрыли доступ).
      setStatus(navigator.onLine === false ? '' : 'Не удалось обновить слова из таблицы');
    }
  }
  // Установленное приложение Android не перезагружает страницу, когда его снова
  // открывают из фона, поэтому слова подтягиваем и при каждом возвращении в приложение
  // (не чаще раза в 20 секунд, чтобы не дергать таблицу при быстрых переключениях).
  const MIN_GAP = 20000;
  let lastRefresh = 0;
  function refreshIfStale() {
    if (Date.now() - lastRefresh < MIN_GAP) return lastRefresh && window.flashcardsReady;
    lastRefresh = Date.now();
    window.flashcardsReady = refresh();
    return window.flashcardsReady;
  }
  refreshIfStale();
  window.addEventListener('online', () => { lastRefresh = 0; refreshIfStale(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfStale();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) refreshIfStale(); });

  if ('serviceWorker' in navigator && window.isSecureContext && /^https?:/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
