// Собирает index.html: подставляет ядро src/engine.js в шаблон src/app.html.
const fs = require('fs');
const path = require('path');
const root = __dirname;
const tpl = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8').replace(/if \(typeof module[^\n]*\n?/, '');
const body = tpl.replace('/*ENGINE*/', () => engine);
const html = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('index.html собран');
