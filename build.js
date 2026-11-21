// Собирает dist/: index.html (самодостаточный), manifest, service worker, иконки.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const src = (f) => path.join(__dirname, 'src', f);
const read = (f) => fs.readFileSync(src(f), 'utf8');
const strip = (code) => code.replace(/^if \(typeof module.*$/m, '');
const dist = path.join(__dirname, 'docs');
fs.mkdirSync(dist, { recursive: true });

const html = read('template.html')
  .replace('/*DECK*/', () => strip(read('deck.js')))
  .replace('/*SHEET*/', () => strip(read('sheet.js')))
  .replace('/*LISTS*/', () => strip(read('lists.js')))
  .replace('/*CARDS*/', () => strip(read('cards.js')))
  .replace('/*UI*/', () => read('ui.js'));
fs.writeFileSync(path.join(dist, 'index.html'), html);

// Версия кэша = хэш страницы: каждое обновление само доезжает до телефона.
const hash = require('crypto').createHash('sha256').update(html).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(dist, 'sw.js'), read('sw.js').replace('__VERSION__', hash));
fs.copyFileSync(src('manifest.webmanifest'), path.join(dist, 'manifest.webmanifest'));
execFileSync('python3', [path.join(__dirname, 'make_icons.py'), dist]);
console.log('dist built, version', hash);
