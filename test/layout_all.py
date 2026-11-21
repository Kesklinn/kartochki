# Все слова таблицы в настоящем Chromium на узком экране: ничего не вылезает за карточку,
# а слово не сдвигается при показе транскрипции.
import json, sys
from playwright.sync_api import sync_playwright
csv = open(sys.argv[1], encoding='utf-8').read()
bad = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for width in (320, 360, 412):
        pg = b.new_page(viewport={'width': width, 'height': 740})
        pg.route('https://docs.google.com/**', lambda r: r.fulfill(status=200, body=csv, headers={'content-type': 'text/csv; charset=utf-8'}))
        pg.goto('file:///home/claude/kartochki/docs/index.html')
        pg.wait_for_function("document.getElementById('counter').textContent.endsWith('/ 74')")
        for i in range(74):
            res = pg.evaluate("""() => {
              const over = id => { const e = document.getElementById(id), c = document.querySelector('.card').getBoundingClientRect(), r = e.getBoundingClientRect();
                return e.scrollWidth > e.clientWidth + 1 || r.left < c.left - 1 || r.right > c.right + 1; };
              const top = () => Math.round(document.getElementById('word').getBoundingClientRect().top);
              const out = {ru: document.getElementById('word').textContent, ruOver: over('word')};
              document.getElementById('face').click();
              out.en = document.getElementById('word').textContent; out.enOver = over('word'); const t1 = top();
              const btn = document.getElementById('ipaBtn');
              if (!btn.hidden) { btn.click(); out.ipaOver = over('ipa') || over('read'); out.moved = top() !== t1; }
              document.getElementById('know').click();
              return out; }""")
            if res.get('ruOver') or res.get('enOver') or res.get('ipaOver') or res.get('moved'):
                bad.append((width, res))
        pg.close()
    b.close()
for x in bad: print(x)
print('problems:', len(bad))
