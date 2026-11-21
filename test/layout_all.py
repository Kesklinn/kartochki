# Все слова таблицы в настоящем Chromium на узких экранах:
#  - русская сторона каждого слова (проход смахиваниями пальцем до начала тренировки);
#  - английская сторона и транскрипция каждого слова (каждое открывается отдельно);
#  - тап сразу после смахивания переворачивает карточку.
# Ничего не должно вылезать за карточку, слово не должно сдвигаться при показе транскрипции.
# Запуск: python3 test/layout_all.py words.csv [320,360,412]
import csv as csvmod, io, sys
from playwright.sync_api import sync_playwright

csv = open(sys.argv[1], encoding='utf-8').read()
rows = [r for r in csvmod.reader(io.StringIO(csv))][1:]
rows = [r for r in rows if len(r) >= 2 and r[0].strip() and r[1].strip()]
keys = list(dict.fromkeys(r[1].strip().lower() + '|' + r[0].strip().lower() for r in rows))
n_words = len(keys)
widths = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else '320,360,412').split(',')]
URL = 'file:///home/claude/kartochki/docs/index.html'

STATE = """() => {
  const card = document.querySelector('.card').getBoundingClientRect();
  const over = id => { const e = document.getElementById(id), r = e.getBoundingClientRect();
    return e.scrollWidth > e.clientWidth + 1 || r.left < card.left - 1 || r.right > card.right + 1; };
  return { word: document.getElementById('word').textContent, over: over('word'),
           ipaOver: !document.getElementById('ipaBox').hidden && (over('ipa') || over('read')),
           top: Math.round(document.getElementById('word').getBoundingClientRect().top),
           side: document.getElementById('face').dataset.side, ipaBtn: !document.getElementById('ipaBtn').hidden };
}"""

# Занятие из одного заданного слова (формат сохранения приложения)
START = """(key) => {
  const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const sess = { v: 4, day, practice: false, queue: [key], steps: {}, total: 1, done: 0 };
  localStorage.setItem('nnn-srs-sessions-v1', JSON.stringify({ current: '__all__', sessions: { __all__: JSON.stringify(sess) } }));
  localStorage.setItem('nnn-srs-progress-v1', '{}');
}"""


def new_page(b, width):
    ctx = b.new_context(viewport={'width': width, 'height': 740}, has_touch=True)
    pg = ctx.new_page()
    pg.route('https://docs.google.com/**', lambda r: r.fulfill(status=200, body=csv, headers={'content-type': 'text/csv; charset=utf-8'}))
    return ctx, pg


def ready(pg):
    pg.wait_for_function('!!window.flashcardsReady')
    pg.evaluate('window.flashcardsReady')


def swipe(pg):
    cdp = pg.context.new_cdp_session(pg)
    pts = lambda x: [{'x': x, 'y': 400}]
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(330)})
    for x in range(310, 60, -25):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(x)})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    pg.wait_for_timeout(200)


def tap(pg):
    box = pg.locator('.card').bounding_box()
    pg.touchscreen.tap(box['x'] + box['width'] / 2, box['y'] + box['height'] - 40)


bad, seen_ru, seen_en = [], set(), set()
with sync_playwright() as p:
    b = p.chromium.launch()
    for width in widths:
        # 1) русские стороны: смахиваем все слова, не переворачивая
        ctx, pg = new_page(b, width)
        pg.goto(URL)
        pg.wait_for_function("document.getElementById('counter').textContent.endsWith('/ %d')" % n_words)
        for _ in range(n_words + 5):
            r = pg.evaluate(STATE)
            if pg.text_content('#mode'):  # план выполнен - началась тренировка
                break
            seen_ru.add(r['word'])
            if r['over']:
                bad.append((width, 'ru вылезает', r['word']))
            swipe(pg)
        else:
            bad.append((width, 'смахиваниями занятие не закончилось'))
        ctx.close()
        # 2) тап сразу после смахивания
        ctx, pg = new_page(b, width)
        pg.goto(URL); ready(pg)
        swipe(pg); tap(pg)
        if pg.evaluate(STATE)['side'] != 'en':
            bad.append((width, 'тап сразу после смахивания не перевернул'))
        ctx.close()
        # 3) английские стороны: каждое слово открываем отдельно
        ctx, pg = new_page(b, width)
        pg.goto(URL); ready(pg)  # слова таблицы сохраняются в телефоне до перебора
        en_of = {k: r[1].strip() for k, r in zip(keys, rows)}
        for key in keys:
            for _ in range(3):  # перезагрузка страницы в тесте иногда не успевает подхватить START - повтор
                pg.evaluate(START, key); pg.reload(); ready(pg)
                tap(pg)
                if pg.text_content('#word') == en_of[key]:
                    break
            r = pg.evaluate(STATE)
            seen_en.add(r['word'])
            if r['side'] != 'en':
                bad.append((width, 'тап не перевернул', key)); continue
            if r['over']:
                bad.append((width, 'en вылезает', r['word']))
            if r['ipaBtn']:
                pg.click('#ipaBtn')
                r2 = pg.evaluate(STATE)
                if r2['ipaOver']:
                    bad.append((width, 'транскрипция вылезает', r['word']))
                if r2['top'] != r['top']:
                    bad.append((width, 'слово сдвинулось', r['word']))
        ctx.close()
    b.close()
for x in bad:
    print(x)
print('слов:', n_words, '| русских:', len(seen_ru), '| английских:', len(seen_en), '| проблем:', len(bad))
sys.exit(1 if bad or len(seen_ru) != n_words or len(seen_en) != n_words else 0)
