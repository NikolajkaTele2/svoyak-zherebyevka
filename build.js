// Сборка. Из шаблона src/app.html и ядра src/engine.js получаются:
//   index.html                     — приложение для GitHub Pages: устанавливается (PWA) и работает офлайн
//   dist/svoyak-zherebyevka.html   — один автономный файл: можно переслать и открыть в любом браузере без интернета
//   manifest.webmanifest, sw.js    — манифест и service worker для установки и офлайн-режима
//   build/artifact.html            — версия для артефакта claude.ai (шрифты с Google Fonts), в git не хранится
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const rd = (p, enc = 'utf8') => fs.readFileSync(path.join(root, p), enc);
const wr = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };

const tpl = rd('src/app.html');
const engine = rd('src/engine.js').replace(/if \(typeof module[^\n]*\n?/, '');
const withEngine = tpl.replace('/*ENGINE*/', () => engine);

const googleFonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Russo+One&family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">';

const inlineFonts = '<style>\n' + rd('fonts/fonts.css').replace(/url\(([^)]+\.woff2)\)/g, (_, f) =>
  'url(data:font/woff2;base64,' + rd('fonts/' + f, null).toString('base64') + ')') + '</style>';

const dataUri = (p, type) => 'data:' + type + ';base64,' + rd(p, null).toString('base64');

function page(body, headExtra) {
  const title = (body.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
  body = body.replace(title, '').trim();
  return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    title + '\n' +
    '<meta name="theme-color" content="#1A2A8F">\n' + headExtra +
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n' +
    '</head>\n<body>\n' + body + '\n</body>\n</html>\n';
}

// 1. Артефакт claude.ai
wr('build/artifact.html', withEngine.replace('<!--FONTS-->', googleFonts));

// 2. Автономный файл
const standaloneBody = withEngine.replace('<!--FONTS-->', inlineFonts);
wr('dist/svoyak-zherebyevka.html', page(standaloneBody,
  '<link rel="icon" type="image/png" href="' + dataUri('icons/favicon-32.png', 'image/png') + '">\n'));

// 3. Приложение для GitHub Pages (PWA)
const pwaHead =
  '<link rel="manifest" href="manifest.webmanifest">\n' +
  '<link rel="icon" type="image/png" href="icons/favicon-32.png">\n' +
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n' +
  '<meta name="apple-mobile-web-app-capable" content="yes">\n' +
  '<meta name="mobile-web-app-capable" content="yes">\n' +
  '<meta name="apple-mobile-web-app-title" content="Жеребьёвка">\n' +
  '<script>if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });</script>\n';
const indexHtml = page(standaloneBody, pwaHead);
wr('index.html', indexHtml);

wr('manifest.webmanifest', JSON.stringify({
  name: 'Своя игра: швейцарская жеребьёвка',
  short_name: 'Жеребьёвка',
  description: 'Жеребьёвка «Своей игры» по швейцарской системе: бои по 3–4 игрока, 4 тура без повторных встреч, таблица и финал.',
  lang: 'ru',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#0B1033',
  theme_color: '#1A2A8F',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
}, null, 2) + '\n');

const version = crypto.createHash('sha1').update(indexHtml).digest('hex').slice(0, 10);
wr('sw.js', `// Service worker: офлайн-режим. Генерируется build.js, версия меняется при каждой новой сборке.
const CACHE = 'svoyak-${version}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // страница: сначала сеть (чтобы получать обновления), без сети — из кэша
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`);

const kb = (p) => Math.round(fs.statSync(path.join(root, p)).size / 1024) + ' КБ';
console.log('Собрано: index.html (' + kb('index.html') + '), dist/svoyak-zherebyevka.html (' + kb('dist/svoyak-zherebyevka.html') + '), sw.js (версия ' + version + ')');
