// Runs backend/food-agent.gs against an in-memory imitation of the Food tab. No network, no live Sheet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TZ = 'Europe/Dublin';
const code = fs.readFileSync(path.join(__dirname, '..', 'backend', 'food-agent.gs'), 'utf8');

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return Object.fromEntries(f.formatToParts(date).map(p => [p.type, p.value]));
}
function zoned(y, mo, d, h, mi, tz) { // the instant that reads y-mo-d h:mi on a wall clock in tz
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(t), tz), shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t += Date.UTC(y, mo - 1, d, h, mi) - shown;
  }
  return new Date(t);
}
const Utilities = {
  formatDate(date, tz, fmt) {
    const p = parts(date, tz);
    if (fmt === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
    if (fmt === 'HH:mm') return `${p.hour}:${p.minute}`;
    throw new Error('format ' + fmt);
  }
};
// Like typing into Sheets: date-like and time-like strings become Date cells.
function sheetValue(v) {
  if (typeof v !== 'string') return v;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return zoned(+m[1], +m[2], +m[3], 0, 0, TZ);
  m = /^(\d{2}):(\d{2})$/.exec(v);
  if (m) return zoned(1899, 12, 30, +m[1], +m[2], TZ);
  return v;
}
function makeSheet(rows, hooks = {}) {
  const cells = rows.map(r => r.slice());
  const counters = { setValue: 0, appendRow: 0 };
  const width = () => Math.max(...cells.map(r => r.length));
  const sheet = {
    cells, counters, hooks,
    getLastRow: () => cells.length,
    getLastColumn: () => width(),
    appendRow(row) {
      if (hooks.beforeAppend) hooks.beforeAppend(counters.appendRow);
      counters.appendRow++; cells.push(row.map(sheetValue));
    },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (cells[r - 1 + i] || [])[c - 1 + j] ?? '')),
        getValue: () => {
          if (hooks.beforeGetValue) hooks.beforeGetValue(r, c);
          return (cells[r - 1] || [])[c - 1] ?? '';
        },
        setValue: v => { counters.setValue++; while (cells.length < r) cells.push([]); cells[r - 1][c - 1] = sheetValue(v); },
      };
    },
  };
  return sheet;
}
function load(sheet, { locked = false } = {}) {
  let held = locked;
  const ctx = {
    Utilities,
    LockService: { getScriptLock: () => ({ tryLock: () => (held ? false : (held = true)), releaseLock: () => { held = false; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'food-agent.gs' });
  const ss = { getSheetByName: n => (n === 'Food' ? sheet : null), getSpreadsheetTimeZone: () => TZ };
  return payload => JSON.parse(JSON.stringify(ctx.pulseFoodAgentPost(ss, payload)));
}

const HEAD = ['EntryID', 'Date', 'Time', 'Meal', 'Item', 'Kcal', 'Protein_g', 'Carbs_g', 'Fat_g', 'Source', 'Notes'];
const seed = () => [
  HEAD,
  ['1794419023895-ymxac', sheetValue('2026-11-11'), sheetValue('17:43'), 'Snack', 'Carrick Glen collagen water 1 L', 50, 10, 0, 0, 'fav', 'keep me'],
  ['20261110-food-jantar-ribeye-227g', sheetValue('2026-11-10'), '', 'Dinner', 'Ribeye 227 g cru', 575, 42.7, 0, 44.9, 'JayDee', ''],
  ['20261110-food-presunto-80g', sheetValue('2026-11-10'), '', 'Snack', 'Presunto 80 g', 200, 24.08, 0.72, 10.96, 'JayDee', 'note'],
];
const food = (id, extra = {}) => ({ id, date: '2026-11-22', time: '08:30', meal: 'Breakfast', item: 'Item ' + id, kcal: 100, protein: 10, carbs: 5, fat: 3, ...extra });
const rowOf = (sheet, id) => sheet.cells.find(r => r[0] === id);
let n = 0; const ok = name => { n++; console.log('  ✓ ' + name); };

// saveFoods: first send, then the identical retry
{
  const sheet = makeSheet(seed()), call = load(sheet);
  const req = { action: 'saveFoods', source: 'JayDee', entries: [food('20261122-food-ovos', { item: '2 ovos (100 g)', kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 }), food('20261122-food-pao', { item: 'Pão 40 g', kcal: 90, protein: 0.84, carbs: 16.4, fat: 1.2, time: '8:30' })] };
  const r1 = call(req);
  assert.equal(r1.ok, true); assert.deepEqual(r1.results.map(r => [r.status, r.confirmed]), [['added', true], ['added', true]]);
  assert.deepEqual(r1.days['2026-11-22'], { items: 2, kcal: 233, protein: 13.4, carbs: 17.1, fat: 10.7 });
  assert.equal(sheet.cells.length, 6);
  const row = rowOf(sheet, '20261122-food-ovos');
  assert.equal(row[4], '2 ovos (100 g)'); assert.equal(row[9], 'JayDee'); assert.equal(row[10], '', 'unrelated column left empty');
  assert.equal(rowOf(sheet, '1794419023895-ymxac')[10], 'keep me');
  const r2 = call(req);
  assert.equal(r2.ok, true); assert.deepEqual(r2.results.map(r => r.status), ['unchanged', 'unchanged']);
  assert.equal(sheet.cells.length, 6, 'retry adds nothing');
  ok('saveFoods adds a batch, confirms it, totals the day; the same request again is unchanged');
}
// connection drops mid-batch, then the agent repeats the request
{
  const sheet = makeSheet(seed(), { beforeAppend: i => { if (i === 1) { sheet.hooks.beforeAppend = null; throw new Error('Service timed out'); } } });
  const call = load(sheet), req = { action: 'saveFoods', entries: [food('a1', { source: 'JayDee' }), food('a2', { source: 'JayDee' }), food('a3', { source: 'JayDee' })] };
  const r1 = call(req);
  assert.equal(r1.ok, false); assert.match(r1.note, /same request again/); assert.equal(r1.saved, undefined);
  assert.equal(sheet.cells.length, 5);
  const r2 = call(req);
  assert.equal(r2.ok, true); assert.deepEqual(r2.results.map(r => r.status), ['unchanged', 'added', 'added']);
  assert.equal(sheet.cells.filter(r => /^a\d$/.test(r[0])).length, 3, 'no duplicates');
  ok('a failure halfway is repaired by sending the same request; nothing is duplicated');
}
// conflicts, validation and limits never write
{
  const sheet = makeSheet(seed()), call = load(sheet), before = JSON.stringify(sheet.cells);
  const c = call({ action: 'saveFoods', entries: [food('20261110-food-jantar-ribeye-227g', { date: '2026-11-10', time: '', meal: 'Dinner', item: 'Ribeye 250 g', kcal: 633, source: 'JayDee' })] });
  assert.equal(c.ok, false); assert.equal(c.results[0].status, 'conflict'); assert.equal(c.results[0].current.kcal, 575);
  for (const [entries, msg] of [
    [[food('b1'), food('b2', { kcal: 'lots' })], /entries\[1\]\.kcal/],
    [[food('b1'), food('b1')], /repeated/],
    [[food('b1', { item: '=IMPORTXML("x")' })], /formula/],
    [[food('b 1')], /entries\[0\]\.id/],
    [[food('20261122')], /at least one letter/],
    [[food('b1', { date: '2026-02-30' })], /real date/],
    [[food('b1', { time: '25:00' })], /HH:mm/],
    [[food('b1', { protein: -1 })], /0 to 20000/],
    [Array.from({ length: 101 }, (_, i) => food('c' + i)), /at most 100/],
    [[], /at least one/],
  ]) {
    const r = call({ action: 'saveFoods', entries });
    assert.equal(r.ok, false); assert.equal(r.saved, false); assert.match(r.error, msg);
  }
  assert.equal(JSON.stringify(sheet.cells), before, 'nothing written');
  ok('a changed food under an existing ID is a conflict; invalid requests write nothing');
}
// small conveniences
{
  const sheet = makeSheet(seed()), call = load(sheet);
  const r = call({ action: 'saveFoods', source: 'JayDee', entries: [{ id: 'd1', date: '2026-11-22', meal: 'Outros', item: 'Azeite 13,5 g', kcal: '119', fat: '13,5' }] });
  assert.equal(r.ok, true);
  const row = rowOf(sheet, 'd1');
  assert.deepEqual([row[2], row[5], row[6], row[7], row[8], row[9]], ['', 119, '', '', 13.5, 'JayDee']);
  ok('numbers as text (comma decimals), optional time/protein/carbs, and a default source');
}
// updateFoods
{
  const sheet = makeSheet(seed()), call = load(sheet);
  const r = call({ action: 'updateFoods', entries: [{ id: '20261110-food-jantar-ribeye-227g', item: 'Ribeye 250 g cru', kcal: 633, protein: 47, fat: 49.4 }] });
  assert.equal(r.ok, true); assert.equal(r.results[0].status, 'updated'); assert.equal(r.results[0].confirmed, true);
  assert.equal(r.results[0].before.kcal, 575);
  const row = rowOf(sheet, '20261110-food-jantar-ribeye-227g');
  assert.deepEqual([row[3], row[4], row[5], row[6], row[7], row[8], row[9]], ['Dinner', 'Ribeye 250 g cru', 633, 47, 0, 49.4, 'JayDee']);
  assert.deepEqual(r.days['2026-11-10'], { items: 2, kcal: 833, protein: 71.1, carbs: 0.7, fat: 60.4 });
  assert.equal(sheet.cells.length, 4, 'updates never add rows');
  const writes = sheet.counters.setValue;
  const same = call({ action: 'updateFoods', entries: [{ id: '20261110-food-jantar-ribeye-227g', kcal: 633 }] });
  assert.equal(same.ok, true); assert.equal(same.results[0].status, 'unchanged'); assert.equal(sheet.counters.setValue, writes);
  const clear = call({ action: 'updateFoods', entries: [{ id: '20261110-food-presunto-80g', carbs: null, date: '2026-11-09' }] });
  assert.equal(clear.ok, true); assert.equal(rowOf(sheet, '20261110-food-presunto-80g')[7], ''); assert.equal(rowOf(sheet, '20261110-food-presunto-80g')[10], 'note');
  assert.deepEqual(Object.keys(clear.days).sort(), ['2026-11-09', '2026-11-10']);
  const missing = call({ action: 'updateFoods', entries: [{ id: 'nope', kcal: 1 }] });
  assert.equal(missing.ok, false); assert.equal(missing.results[0].status, 'not_found');
  for (const [entries, msg] of [[[{ id: 'nope' }], /at least one field/], [[{ id: '20261110-food-presunto-80g', kcal: null }], /kcal/]]) {
    const bad = call({ action: 'updateFoods', entries }); assert.equal(bad.ok, false); assert.match(bad.error, msg);
  }
  ok('updateFoods changes only the fields sent, can clear an optional macro or move the date, and reports unchanged/not_found');
}
// a row deleted by the app between reading and writing does not misplace the update
{
  const sheet = makeSheet(seed());
  sheet.hooks.beforeGetValue = () => { sheet.hooks.beforeGetValue = null; sheet.cells.splice(1, 1); };
  const call = load(sheet);
  const r = call({ action: 'updateFoods', entries: [{ id: '20261110-food-presunto-80g', kcal: 210 }] });
  assert.equal(r.ok, true); assert.equal(rowOf(sheet, '20261110-food-presunto-80g')[5], 210);
  assert.equal(rowOf(sheet, '20261110-food-jantar-ribeye-227g')[5], 575, 'neighbour untouched');
  ok('a row that moved before the write is found again by ID');
}
// reading a day, plus guards
{
  const sheet = makeSheet(seed()), call = load(sheet);
  const d = call({ action: 'foodDay', date: '2026-11-10' });
  assert.equal(d.ok, true); assert.deepEqual(d.entries.map(e => e.id), ['20261110-food-jantar-ribeye-227g', '20261110-food-presunto-80g']);
  assert.deepEqual(d.totals, { items: 2, kcal: 775, protein: 66.8, carbs: 0.7, fat: 55.9 });
  const t = call({ action: 'foodDay', date: '2026-11-11' });
  assert.equal(t.entries[0].time, '17:43'); assert.equal(t.entries[0].date, '2026-11-11');
  assert.equal(load(sheet)({ action: 'logFood', entries: [] }), null, 'other actions go to the existing router');
  const busy = load(sheet, { locked: true })({ action: 'saveFoods', entries: [food('e1')] });
  assert.equal(busy.ok, false); assert.equal(busy.saved, false); assert.match(busy.error, /busy/);
  const dupSheet = makeSheet([...seed(), ['20261110-food-presunto-80g', '2026-11-10', '', 'Snack', 'dup', 1, 1, 1, 1, 'x', '']]);
  const dup = load(dupSheet)({ action: 'saveFoods', entries: [food('20261110-food-presunto-80g')] });
  assert.equal(dup.results[0].status, 'conflict'); assert.match(dup.results[0].reason, /more than once/);
  const noHead = load(makeSheet([HEAD.filter(h => h !== 'Source')]))({ action: 'foodDay', date: '2026-11-10' });
  assert.equal(noHead.ok, false); assert.match(noHead.error, /"Source"/);
  ok('foodDay lists the day with totals; busy, unknown action, duplicate IDs in the tab and a missing header are handled');
}
console.log(`PASS food agent backend: ${n} groups. In-memory Food tab only; no network.`);
