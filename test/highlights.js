// Проверяем настоящий обработчик флажка и отрисовку без зависимостей и сети.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SG = require('../src/engine.js');
const html = fs.readFileSync(require('node:path').join(__dirname, '../src/app.html'), 'utf8');
const script = html.match(/<script>\s*(\(function \(\) \{[\s\S]*?)<\/script>/)[1];
const bee = ['Быстров Николай', 'Александров Андрей', 'Низамова Ирина', 'Баринов Никита', 'Ширяева Евгения'];
const pink = ['Филаткин Михаил', 'Калякин Юрий', 'Соловьев Дмитрий', 'Митин Александр'];
const names = [...bee, ...pink, 'Тестовый Участник', 'Пример Игрок', 'Другой Участник'];
const state = { v: 1, id: 'test', name: 'Проверка', players: names.map((name, i) => ({ id: 'p' + i, name, rating: 1200 - i })), tours: [], final: null };
function boot(storage) {
  const events = {};
  const app = { innerHTML: '', addEventListener: (type, fn) => { events[type] = fn; } };
  const sandbox = { SG, console, setTimeout, clearTimeout, navigator: { onLine: true },
    localStorage: { getItem: (key) => storage[key] || null, setItem: (key, value) => { storage[key] = value; } },
    document: { getElementById: (id) => id === 'app' ? app : null, activeElement: null },
    window: { addEventListener() {} }, addEventListener() {} };
  sandbox.window.self = sandbox.window.top = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, 'globalThis.test = { state, ui, playerBadge, viewPlayers, viewTour, viewTable, viewFinal, saveUi, store, gs, standingsSheet, finalSheet }; })();'), sandbox);
  return { ...sandbox.test, app, change: events.change, toggle: (checked) => events.change({ target: { id: 'highlightPlayers', checked, dataset: {} } }) };
}
const storage = { 'sg-swiss-state-v1': JSON.stringify(state) };
const app = boot(storage);
assert.equal(app.ui.highlightPlayers, false);
assert.equal(app.playerBadge(bee[0]), '');
const before = JSON.stringify(app.state);
const snapshot = JSON.stringify(SG.sheetSnapshot(app.state));
const sheet = JSON.stringify(app.standingsSheet());
app.toggle(true);
for (const [group, cls] of [[bee, /🐝/], [pink, /alt="Розовый слон"/]]) {
  for (const name of group) {
    for (const variant of [name, name.split(' ').reverse().join(' '), '  ' + name.toUpperCase().replace(' ', ' \t  ') + '  ']) assert.match(app.playerBadge(variant), cls, variant);
  }
}
assert.match(app.playerBadge('Дмитрий Соловьёв'), /alt="Розовый слон"/);
for (const name of ['Филаткин', 'Михаил', 'Филаткин Андрей', 'Филаткин Михаил Иванович', '', '<b>Быстров Николай</b>']) assert.equal(app.playerBadge(name), '');
assert.equal(JSON.stringify(app.state), before, 'флажок не меняет данные и savedAt');
assert.equal(JSON.stringify(SG.sheetSnapshot(app.state)), snapshot, 'снимок Google не меняется');
assert.equal(JSON.stringify(app.standingsSheet()), sheet, 'экспорт таблицы не меняется');
assert.equal(storage['sg-swiss-state-v1'], JSON.stringify(state), 'старый файл не перезаписан');
assert.equal(boot(storage).ui.highlightPlayers, true, 'выбор сохранён в браузере');
assert.match(app.viewPlayers(), /🐝/);
assert.match(app.viewPlayers(), /alt="Розовый слон"/);
// Синтетический этап с четырьмя турами и финалом, без случайной жеребьёвки.
for (let t = 0; t < 4; t++) app.state.tours.push({ battles: [0, 3, 6, 9].map((start) => {
  const ids = app.state.players.slice(start, start + 3).map((p) => p.id);
  return { players: ids, scores: Object.fromEntries(ids.map((id, i) => [id, 300 - start - i * 50])) };
}) });
app.state.final = { players: ['p0', 'p5', 'p9'], scores: { p0: 300, p5: 200, p9: 100 } };
for (const markup of [app.viewPlayers(), app.viewTour(0), app.viewTable(), app.viewFinal()]) {
  assert.match(markup, /🐝/);
  assert.match(markup, /alt="Розовый слон"/);
}
assert.match(app.viewFinal(), /class="pod">[\s\S]*?class="n">[\s\S]*?Быстров Николай<\/span><span class="player-badge"/);
const badgeCell = { innerHTML: '' };
const nameTarget = { id: 'pn-p0', dataset: { pname: 'p0' }, value: 'Михаил Филаткин', closest: () => ({ querySelector: () => badgeCell }) };
app.change({ target: nameTarget });
assert.match(badgeCell.innerHTML, /alt="Розовый слон"/, 'значок обновляется при переименовании');
nameTarget.value = 'Тестовый Игрок';
app.change({ target: nameTarget });
assert.equal(badgeCell.innerHTML, '', 'значок исчезает для другого имени');
app.store.canWrite = false;
app.toggle(false);
assert.equal(app.playerBadge(bee[0]), '', 'флажок работает и в режиме просмотра');
for (const markup of [app.viewPlayers(), app.viewTour(0), app.viewTable(), app.viewFinal()]) assert.doesNotMatch(markup, /player-badge|🐝|Розовый слон/);
assert.equal(boot(storage).ui.highlightPlayers, false);
console.log('Значки: имена, все виды, переключатель, сохранение выбора и неизменность экспорта — OK');

assert.doesNotMatch(html, /player-bee|player-pink|--player-bg/, 'цветные фоны удалены');
for (const file of ['index.html', 'dist/svoyak-zherebyevka.html']) {
  const built = fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
  assert.match(built, /const ELEPHANT_ICON = "data:image\/png;base64,/, 'значок встроен: ' + file);
  assert.doesNotMatch(built, /\/\*ELEPHANT_ICON\*\//);
}
