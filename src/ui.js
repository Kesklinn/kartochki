// Интерфейс. Ожидает глобальные Srs, Sheet, Lists и CARDS (встроенные слова на случай без сети).
(function () {
  const PROGRESS_KEY = 'nnn-srs-progress-v1';  // память по каждому слову: уровень и дата повторения
  const SESSIONS_KEY = 'nnn-srs-sessions-v1';  // выбранный список и сегодняшнее занятие по каждому списку
  const OK_KEY = 'nnn-srs-ok-v1';              // слова, вспомненные сегодня в тренировке слабых
  const HISTORY_KEY = 'nnn-srs-history-v1';    // последние смахивания - для возврата и после перезапуска
  const WORDS_KEY = 'nnn-words-v2';            // последние слова из таблицы
  const UNDO_MAX = 20;
  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const readJson = (k) => { try { return JSON.parse(store.get(k)); } catch { return null; } };

  function loadCachedWords() {
    const w = readJson(WORDS_KEY);
    if (Array.isArray(w) && w.length && w.every((c) => c && c.ru && c.en && Array.isArray(c.lists))) return w;
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
  const subsetOf = (name) => Lists.cardsFor(cards, name);

  let progress = Srs.restoreProgress(store.get(PROGRESS_KEY));
  const saved = readJson(SESSIONS_KEY) || {};
  const sessions = saved.sessions && typeof saved.sessions === 'object' ? saved.sessions : {};
  // preferred - список, выбранный пользователем; listName - открытый сейчас.
  // Они расходятся, пока выбранного списка нет в словах (например, до загрузки таблицы).
  let preferred = typeof saved.current === 'string' ? saved.current : Lists.ALL;
  let listName = preferred;

  const today = () => Srs.dayOf(now());
  const okSaved = readJson(OK_KEY);
  let okToday = new Set(okSaved && okSaved.day === today() && Array.isArray(okSaved.keys) ? okSaved.keys : []);

  // История для возврата карточек: [{ state, key, had, rec, list, ok }]. Хранится и в телефоне,
  // чтобы "назад" работало и после перезапуска приложения (в пределах того же дня).
  let history = [];
  const histSaved = readJson(HISTORY_KEY);
  if (histSaved && histSaved.day === today() && Array.isArray(histSaved.items)) {
    for (const h of histSaved.items) {
      const st = h && Srs.restore(h.s);
      if (st && typeof h.key === 'string' && typeof h.list === 'string') history.push({ ...h, state: st });
    }
  }

  let state;
  let notice = ''; // подпись о переходе, видна до следующего смахивания

  function sessionFor(name) {
    const subset = subsetOf(name);
    const prev = sessions[name] && Srs.restore(sessions[name]);
    return prev && !Srs.isStale(prev, now())
      ? Srs.merge(prev, subset, progress, now())
      : Srs.buildSession(subset, progress, now());
  }

  function openList(name, { clearHistory = true } = {}) {
    if (clearHistory) history = []; // при ручном выборе списка возврат начинается заново
    if (!Lists.menuItems(cards).includes(name)) name = Lists.ALL;
    listName = name;
    state = sessionFor(name);
    keepGoing();
  }

  // Что показывать, когда в текущем занятии карточки кончились. Стоп-экрана нет:
  //  1) после смахивания (auto) - в другой список, где на сегодня есть план (новые/к повторению);
  //  2) тренировка слабых слов: забытые, низкого уровня, со сроком завтра; вспомненное в
  //     тренировке слово сегодня больше не показывается. Если выбрали список вручную - его слабые,
  //     иначе - слабые по всем словам;
  //  3) если и слабых не осталось - карточка "Отлично!" с выбором: все еще раз или другой список.
  function keepGoing(avoid = null, auto = false) {
    if (!Srs.isFinished(state)) return;
    const from = listName;
    const fromLabel = Lists.label(from);
    if (auto && state.practice !== 'all') {
      const next = Lists.menuItems(cards)
        .filter((n) => n !== Lists.ALL && n !== from)
        .map((n) => ({ n, left: Srs.remainingToday(subsetOf(n), progress, now()) }))
        .filter((x) => x.left > 0)
        .sort((a, b) => b.left - a.left)[0];
      if (next) {
        persist();
        listName = preferred = next.n;
        state = sessionFor(next.n);
        if (!Srs.isFinished(state)) { notice = '✓ «' + fromLabel + '» выполнен → «' + Lists.label(next.n) + '»'; return; }
        listName = from;
      }
    }
    if (state.practice !== 'all') {
      const weak = (n) => Srs.weakLeft(subsetOf(n), progress, now(), okToday);
      let target = weak(from) > 0 ? from : auto && weak(Lists.ALL) > 0 ? Lists.ALL : null;
      if (target) {
        if (target !== from) { persist(); listName = preferred = target; }
        state = Srs.buildSession(subsetOf(target), progress, now(), Math.random, 'weak', avoid, okToday);
        return;
      }
    }
    // работы не осталось: пустая тренировка = карточка "Отлично!"
    state = Srs.buildSession([], progress, now(), Math.random, state.practice || 'weak');
  }
  openList(listName, { clearHistory: false });

  function persist() {
    sessions[listName] = Srs.serialize(state);
    store.set(SESSIONS_KEY, JSON.stringify({ current: preferred, sessions }));
    store.set(PROGRESS_KEY, JSON.stringify(progress));
    store.set(OK_KEY, JSON.stringify({ day: today(), keys: [...okToday] }));
    store.set(HISTORY_KEY, JSON.stringify({
      day: today(),
      items: history.map((h) => ({ s: Srs.serialize(h.state), key: h.key, had: h.had, rec: h.rec, list: h.list, ok: h.ok })),
    }));
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

  function render() {
    $('listName').textContent = Lists.label(listName);
    const finished = Srs.isFinished(state);
    // Счетчик: какое слово из скольких; второе число не растет от забытых слов.
    // ↻ N - сколько забытых слов сейчас на закреплении (они еще вернутся).
    $('counter').textContent = Srs.position(state) + ' / ' + state.total;
    $('relearn').textContent = state.relearning ? '↻ ' + state.relearning : '';
    $('fill').style.width = (state.total ? state.done / state.total * 100 : 0) + '%';
    $('prev').disabled = !history.length;
    $('next').disabled = finished;

    const ipaBtn = $('ipaBtn'), ipaBox = $('ipaBox'), hint = $('hint');
    $('mode').textContent = state.practice === 'weak' && !finished ? '✓ План на сегодня выполнен · слабые слова'
      : state.practice === 'all' && !finished ? 'Повтор всех слов списка'
      : notice;

    if (finished) {
      $('face').dataset.side = 'done';
      $('word').style.fontSize = '';
      const empty = !subsetOf(listName).length;
      $('word').textContent = empty ? 'Пусто' : 'Отлично!';
      hint.textContent = empty ? 'В этом списке нет слов.' : 'Новые и слабые слова на сегодня закреплены.';
      hint.hidden = false;
      ipaBtn.hidden = ipaBox.hidden = true;
      $('doneBtns').hidden = false;
      $('again').hidden = empty;
      $('other').hidden = Lists.menuItems(cards).length < 2;
      return;
    }

    $('doneBtns').hidden = true;
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
  // Перед каждым ответом запоминаем, как было, чтобы его можно было отменить.
  function answer() {
    if (Srs.isFinished(state)) return;
    const key = Srs.current(state);
    const entry = { state, key, had: key in progress, rec: progress[key], list: listName, ok: false };
    notice = '';
    const r = Srs.swipe(state, progress, now());
    progress = r.progress;
    // вспомнил слабое слово в тренировке - сегодня оно больше не нужно
    if (state.practice === 'weak' && r.recalled && !r.s.queue.includes(key) && !okToday.has(key)) {
      okToday.add(key);
      entry.ok = true;
    }
    history.push(entry);
    if (history.length > UNDO_MAX) history.shift();
    state = r.s;
    keepGoing(key, true);
    update(state);
  }

  // Вернуть предыдущую карточку: занятие и запись прогресса этого слова - как до смахивания.
  // Карточка возвращается русской стороной; если ответ уже видели, это остается "не помню".
  function undo() {
    const h = history.pop();
    if (!h) return false;
    progress = { ...progress };
    if (h.had) progress[h.key] = h.rec; else delete progress[h.key];
    if (h.ok) okToday.delete(h.key);
    const back = { ...h.state, flipped: false, ipaShown: false };
    notice = '';
    if (h.list !== listName) { persist(); listName = preferred = h.list; } // назад через автопереход
    update(Srs.merge(back, subsetOf(listName), progress)); // слова могли обновиться
    return true;
  }

  // --- выбор списка ---
  // В меню: сколько слов списка еще ждут сегодня ("✓" - план выполнен).
  function todayOf(name) {
    const n = Srs.remainingToday(subsetOf(name), progress, now());
    return n ? 'еще ' + n : '✓';
  }

  function showPicker() {
    const box = $('pickerList');
    box.textContent = '';
    for (const name of Lists.menuItems(cards)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (name === listName ? ' current' : '');
      b.dataset.list = name;
      const t = document.createElement('span'); t.textContent = Lists.label(name);
      const n = document.createElement('span'); n.className = 'cnt'; n.textContent = todayOf(name);
      b.append(t, n);
      b.addEventListener('click', () => { hidePicker(); persist(); preferred = name; notice = ''; openList(name); persist(); render(); });
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
  // Клавиатура (компьютер) - как стрелки на экране: стрелка вправо - следующая карточка,
  // стрелка влево - вернуть предыдущую, пробел - перевернуть, Esc - закрыть меню списков.
  document.addEventListener('keydown', (e) => {
    if (!$('picker').hidden) { if (e.key === 'Escape') hidePicker(); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      if (e.target.closest && e.target.closest('button')) return; // пробел на кнопке - нажать кнопку
      e.preventDefault(); update(Srs.flip(state));
    } else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
  });

  // --- карточка ---
  // Переворот - тап в любое место экрана, кроме кнопок и открытого меню списков.
  // Тап пальцем обрабатываем сами на pointerup: Chrome на телефоне иногда не присылает click
  // для тапа, сделанного сразу после смахивания. click остается для мыши/клавиатуры,
  // а click, пришедший вслед за уже обработанным тапом или жестом, игнорируется.
  let suppressClick = false;
  const flippable = (target) => $('picker').hidden && !target.closest('button, #picker');
  document.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (flippable(e.target)) update(Srs.flip(state));
  });

  // Смахивание влево - следующая карточка (оценку ставит answer()),
  // вправо - вернуть предыдущую (undo()). Срабатывает от 1/5 ширины карточки.
  const cardEl = document.querySelector('.card');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sx = null, sy = 0, dragging = false;
  const threshold = () => Math.max(50, (cardEl.clientWidth || 300) / 5);

  // Анимации: текущая карточка улетает в сторону dir (-1 влево, +1 вправо),
  // новая въезжает с противоположной стороны.
  let sliding = false; // пока карточка улетает, второе нажатие не засчитывается
  function slide(dir, action) {
    if (sliding) return;
    if (reduceMotion) { cardEl.style.transform = ''; action(); return; }
    sliding = true;
    cardEl.classList.remove('dragging');
    cardEl.style.transform = 'translateX(' + dir * 120 + '%) rotate(' + dir * 8 + 'deg)';
    setTimeout(() => {
      sliding = false;
      action();
      cardEl.classList.add('dragging'); // без анимации ставим новую карточку с другой стороны
      cardEl.style.transform = 'translateX(' + -dir * 40 + 'px)';
      void cardEl.offsetWidth;
      cardEl.classList.remove('dragging');
      cardEl.style.transform = '';
    }, 180);
  }
  const goNext = () => { if (!Srs.isFinished(state)) slide(-1, answer); };
  const goBack = () => { if (history.length) slide(1, undo); };
  $('next').addEventListener('click', goNext);
  $('prev').addEventListener('click', goBack);

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
    sx = e.clientX; sy = e.clientY; dragging = false; // на карточке "Отлично!" - только вправо, назад
  });
  document.addEventListener('pointermove', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      dragging = true;
      cardEl.classList.add('dragging');
    }
    if (dragging) {
      // куда можно уйти - идет за пальцем, куда нельзя - только легкая "резинка"
      const canLeft = !Srs.isFinished(state), canRight = history.length > 0;
      const x = (dx < 0 ? (canLeft ? 1 : 0.15) : (canRight ? 1 : 0.15)) * dx;
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
    if (dx <= -threshold() && !Srs.isFinished(state)) slide(-1, answer);
    else if (dx >= threshold() && history.length) slide(1, undo);
    else cardEl.style.transform = ''; // не дотянули или некуда - назад на место
  });
  document.addEventListener('pointercancel', () => { tapStart = null; resetDrag(); });

  $('face').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); update(Srs.flip(state)); }
  });
  $('ipaBtn').addEventListener('click', () => update(Srs.toggleIpa(state)));
  // Карточка "Отлично!": пройти все слова списка еще раз или выбрать другой список.
  $('again').addEventListener('click', () => {
    notice = '';
    update(Srs.buildSession(subsetOf(listName), progress, now(), Math.random, 'all'));
  });
  $('other').addEventListener('click', () => showPicker());

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
        openList(preferred, { clearHistory: false }); // выбранный список появился после загрузки таблицы
      } else if (items.includes(listName)) {
        const subset = subsetOf(listName);
        if (state.practice && Srs.hasNew(subset, progress)) {
          // в таблицу добавили слова - из тренировки возвращаемся к плану на сегодня
          state = Srs.buildSession(subset, progress, now());
        } else {
          state = Srs.merge(state, subset, progress, now());
        }
        keepGoing();
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

  // Наступил новый день - новый план: подошли сроки повторений. Вчерашняя история и
  // вчерашние "вспомнил в тренировке" больше не действуют.
  function rollDay() {
    if (Srs.isStale(state, now())) { okToday = new Set(); notice = ''; openList(listName); persist(); render(); }
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
