# Проверка в настоящем Chromium: раскладка, установка service worker, работа без сети.
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

DIST = sys.argv[1]
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-b', '127.0.0.1'], cwd=DIST,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = 'http://127.0.0.1:8765/'  # localhost считается безопасным, service worker работает
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 760})
        pg = ctx.new_page()
        pg.goto(URL)
        pg.wait_for_function('navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(()=>true)')
        pg.evaluate('navigator.serviceWorker.ready')
        pg.reload()  # теперь страницей управляет service worker
        pg.wait_for_function('navigator.serviceWorker.controller !== null')
        print('SW active:', pg.evaluate('!!navigator.serviceWorker.controller'))

        # раскладка: слово на месте
        for _ in range(40):
            pg.click('#face')
            if pg.is_visible('#ipaBtn'): break
            pg.click('#face'); pg.click('#know')
        pg.click('#face')
        top = lambda: pg.eval_on_selector('#word', 'e => Math.round(e.getBoundingClientRect().top)')
        a = top(); pg.click('#face'); b_ = top(); pg.click('#ipaBtn'); c = top()
        assert a == b_ == c, (a, b_, c)
        print('word top stable:', a)
        pg.click('#know')
        counter_before = pg.text_content('#counter')

        # без сети: сервер выключаем и браузер переводим в офлайн
        srv.terminate(); srv.wait()
        ctx.set_offline(True)
        pg.reload()
        pg.wait_for_selector('#word')
        print('offline word:', pg.text_content('#word'), '| counter:', pg.text_content('#counter'))
        print('status:', pg.text_content('#status'))
        assert pg.text_content('#counter') == counter_before
        assert pg.text_content('#word')
        pg.screenshot(path='/tmp/offline.png')
        man = None
        b.close()
    print('OK')
finally:
    if srv.poll() is None:
        srv.terminate()
