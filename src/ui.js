// Интерфейс. Ожидает глобальные Srs, Sheet, Lists и CARDS (встроенные слова на случай без сети).
(function () {
  const PROGRESS_KEY = 'nnn-srs-progress-v1';  // память по каждому слову: уровень и дата повторения
  const SESSIONS_KEY = 'nnn-srs-sessions-v1';  // выбранный список и сегодняшнее занятие по каждому списку
  const WORDS_KEY = 'nnn-words-v2';            // последние слова из таблицы
  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();

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
    byKey = new Map(list.map((c) => [Srs.keyOf(c), c]));
  }
  setCards(loadCachedWords() || CARDS);

  let progress = Srs.restoreProgress(store.get(PROGRESS_KEY));
  let saved = {};
  try { saved = JSON.parse(store.get(SESSIONS_KEY)) || {}; } catch {}
  const sessions = saved.sessions && typeof saved.sessions === 'object' ? saved.sessions : {};
  // preferred - список, выбранный пользователем; listName - открытый сейчас.
  // Они расходятся, пока выбранного списка нет в словах (например, до загрузки таблицы).
  let preferred = typeof saved.current === 'string' ? saved.current : Lists.ALL;
  let listName = preferred;

  let state;
  function openList(name, practice = false) {
    if (!Lists.menuItems(cards).includes(name)) name = Lists.ALL;
    listName = name;
    const subset = Lists.cardsFor(cards, name);
    const prev = !practice && sessions[name] && Srs.restore(sessions[name]);
    state = prev && !Srs.isStale(prev, now())
      ? Srs.merge(prev, subset, progress)
      : Srs.buildSession(subset, progress, now(), Math.random, practice);
  }
  openList(listName);

  function persist() {
    sessions[listName] = Srs.serialize(state);
    store.set(SESSIONS_KEY, JSON.stringify({ current: preferred, sessions }));
    store.set(PROGRESS_KEY, JSON.stringify(progress));
  }

  // --- отрисовка ---
  function setStatus(text) { $('status').textContent = text; }

  // Перенос строки только по пробелам, никогда посреди слова или транскрипции
  // (браузер иначе рвет, например, /ˌʌndəˈstænd/ на знаке ударения).
  function setParts(el, text) {
    el.textContent = '';
    String(text || '').split(' ').forEach((tok, i) => {
      if (i) el.append(' ');
      const s = document.createElement('span');
      s.className = 'seg';
      s.textContent = tok;
      el.append(s);
    });
  }

  // Если отдельное слово все равно шире карточки - уменьшаем шрифт, пока не влезет.
  function fit(el, maxRem, minRem) {
    el.style.fontSize = '';
    if (!el.clientWidth) return; // нет раскладки (тесты без браузера)
    let size = maxRem;
    while (el.scrollWidth > el.clientWidth + 1 && size > minRem) {
      size = Math.round((size - 0.1) * 10) / 10;
      el.style.fontSize = size + 'rem';
    }
  }

  function daysWord(n) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'день';
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'дня';
    return 'дней';
  }

  // Подпись на экране "на сегодня все": когда следующее повторение этого списка.
  function whenNext() {
    const t = Srs.nextDue(Lists.cardsFor(cards, listName), progress);
    if (t === null) return '';
    const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date(now()).setHours(0, 0, 0, 0)) / Srs.DAY);
    if (days <= 0) return 'Есть слова к повторению.';
    if (days === 1) return 'Следующее повторение - завтра.';
    return 'Следующее повторение - через ' + days + ' ' + daysWord(days) + '.';
  }

  function render() {
    $('listName').textContent = Lists.label(listName);
    const total = state.total;
    const finished = Srs.isFinished(state);
    $('counter').textContent = (finished ? total : Math.min(state.done + 1, total)) + ' / ' + total;
    $('fill').style.width = (total ? state.done / total * 100 : 0) + '%';

    const ipaBtn = $('ipaBtn'), ipaBox = $('ipaBox'), hint = $('hint'), again = $('again');

    if (finished) {
      $('face').dataset.side = 'done';
      $('word').style.fontSize = '';
      const empty = !Lists.cardsFor(cards, listName).length;
      $('word').textContent = empty ? 'Пусто' : state.practice ? 'Готово!' : 'На сегодня все';
      hint.textContent = empty ? 'В этом списке нет слов.' : whenNext();
      hint.hidden = !hint.textContent;
      ipaBtn.hidden = ipaBox.hidden = true;
      again.hidden = empty;
      return;
    }

    again.hidden = true;
    hint.hidden = true;
    const card = byKey.get(Srs.current(state));
    if (!state.flipped) {
      $('face').dataset.side = 'ru';
      setParts($('word'), card.ru);
      fit($('word'), 2, 1.1);
      ipaBtn.hidden = ipaBox.hidden = true;
    } else {
      $('face').dataset.side = 'en';
      setParts($('word'), card.en);
      fit($('word'), 2, 1.1);
      const has = Srs.hasIpa(card);
      // по нажатию кнопка исчезает, на ее месте появляется транскрипция
      ipaBtn.hidden = !has || state.ipaShown;
      ipaBtn.setAttribute('aria-expanded', String(state.ipaShown));
      ipaBox.hidden = !(has && state.ipaShown);
      setParts($('ipa'), card.ipa);
      setParts($('read'), card.read);
      if (!ipaBox.hidden) { fit($('ipa'), 1.15, 0.8); fit($('read'), 1.2, 0.8); }
    }
  }

  function update(next) { state = next; persist(); render(); }

  // Смахивание: "помню", если карточку не переворачивали, иначе "не помню".
  function answer() {
    const r = Srs.swipe(state, progress, now());
    progress = r.progress;
    update(r.s);
  }

  // --- выбор списка ---
  // В меню: сколько слов списка уже выучено (прошли хотя бы первое повторение) из всех.
  function progressOf(name) {
    const subset = Lists.cardsFor(cards, name);
    return { total: subset.length, done: Srs.learnedCount(subset, progress) };
  }

  function showPicker() {
    const box = $('pickerList');
    box.textContent = '';
    for (const name of Lists.menuItems(cards)) {
      const p = progressOf(name);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (name === listName ? ' current' : '');
      b.dataset.list = name;
      const t = document.createElement('span'); t.textContent = Lists.label(name);
      const n = document.createElement('span'); n.className = 'cnt'; n.textContent = p.done + ' / ' + p.total;
      b.append(t, n);
      b.addEventListener('click', () => { hidePicker(); persist(); preferred = name; openList(name); persist(); render(); });
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
  // Переворот - тап в любое место экрана, кроме кнопок (транскрипция, выбор списка,
  // "Повторить еще раз") и открытого меню списков.
  // Тап пальцем обрабатываем сами на pointerup: Chrome на телефоне иногда не присылает click
  // для тапа, сделанного сразу после смахивания. click остается для мыши/клавиатуры,
  // а click, пришедший вслед за уже обработанным тапом или жестом, игнорируется.
  let suppressClick = false;
  const flippable = (target) => $('picker').hidden && !target.closest('button, #picker');
  document.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (flippable(e.target)) update(Srs.flip(state));
  });

  // Смахивание влево - следующая карточка; оценку ставит answer().
  const cardEl = document.querySelector('.card');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sx = null, sy = 0, dragging = false;
  const threshold = () => Math.max(60, (cardEl.clientWidth || 300) * 0.22);

  function resetDrag() {
    sx = null; dragging = false;
    cardEl.classList.remove('dragging');
    cardEl.style.transform = '';
  }
  let tapStart = null; // для распознавания тапа: где и когда коснулись
  document.addEventListener('pointerdown', (e) => {
    suppressClick = false; // новое касание - лишний click от прошлого жеста уже не придет
    tapStart = null;
    if (e.isPrimary === false || e.button > 0) return;
    if (!flippable(e.target)) return;
    tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (Srs.isFinished(state)) return;
    sx = e.clientX; sy = e.clientY; dragging = false;
  });
  document.addEventListener('pointermove', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      dragging = true;
      cardEl.classList.add('dragging');
    }
    if (dragging) {
      const x = Math.min(dx, 0) + Math.max(dx, 0) * 0.15; // вправо - только легкая "резинка"
      cardEl.style.transform = 'translateX(' + x + 'px) rotate(' + x / 40 + 'deg)';
    }
  });
  document.addEventListener('pointerup', (e) => {
    const tap = tapStart;
    tapStart = null;
    const isTap = tap && !dragging && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12 && Date.now() - tap.t < 700;
    if (isTap && e.pointerType && e.pointerType !== 'mouse') {
      suppressClick = true; // click, если придет, - тот же самый тап
      setTimeout(() => { suppressClick = false; }, 700);
      update(Srs.flip(state));
    }
    if (sx === null) return;
    const dx = e.clientX - sx;
    const wasDrag = dragging;
    sx = null; dragging = false;
    cardEl.classList.remove('dragging');
    if (!wasDrag) { cardEl.style.transform = ''; return; }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    if (dx > -threshold()) { cardEl.style.transform = ''; return; } // не дотянули - назад
    if (reduceMotion) { cardEl.style.transform = ''; answer(); return; }
    cardEl.style.transform = 'translateX(-120%) rotate(-8deg)';
    setTimeout(() => {
      answer();
      cardEl.classList.add('dragging'); // без анимации ставим новую карточку чуть правее
      cardEl.style.transform = 'translateX(40px)';
      void cardEl.offsetWidth;
      cardEl.classList.remove('dragging');
      cardEl.style.transform = '';
    }, 180);
  });
  document.addEventListener('pointercancel', () => { tapStart = null; resetDrag(); });

  $('face').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); update(Srs.flip(state)); }
  });
  $('ipaBtn').addEventListener('click', () => update(Srs.toggleIpa(state)));
  // На экране "на сегодня все": пройти список еще раз. Расписание раньше срока не сдвигается,
  // а забытые слова снова попадают на доучивание.
  $('again').addEventListener('click', () => { openList(listName, true); persist(); render(); });

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
        state = Srs.merge(state, Lists.cardsFor(cards, listName), progress);
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

  // Наступил новый день - собираем новое занятие: подошли сроки повторений.
  function rollDay() {
    if (Srs.isStale(state, now())) { openList(listName); persist(); render(); }
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
    if (document.visibilityState === 'visible') { rollDay(); refreshIfStale(); }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { rollDay(); refreshIfStale(); } });

  if ('serviceWorker' in navigator && window.isSecureContext && /^https?:/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
