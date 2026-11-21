# Проверка в настоящем браузере: слово не сдвигается при перевороте и показе транскрипции.
import sys
from playwright.sync_api import sync_playwright

URL = 'file://' + sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 760})
    pg.goto(URL)
    for _ in range(40):  # ищем слово с транскрипцией
        pg.click('#face')
        if pg.is_visible('#ipaBtn'):
            break
        pg.click('#face'); pg.click('#know')
    pg.click('#face')  # обратно на русский
    box = lambda: pg.eval_on_selector('#word', 'e => Math.round(e.getBoundingClientRect().top)')
    ru = box(); pg.screenshot(path='/tmp/l1.png')
    pg.click('#face'); en = box(); pg.screenshot(path='/tmp/l2.png')
    pg.click('#ipaBtn'); ipa = box(); pg.screenshot(path='/tmp/l3.png')
    btn_visible = pg.is_visible('#ipaBtn')
    b.close()
print('top ru/en/ipa:', ru, en, ipa, 'button visible after click:', btn_visible)
assert ru == en == ipa, 'слово сдвинулось'
assert not btn_visible
print('OK')
