/**
 * PULSE · food API for agents (JayDee, Claude, scripts).
 *
 * Three POST actions, routed from doPost before the existing router:
 *   saveFoods   – add several foods at once. Stable IDs make a repeated request safe:
 *                 an ID already saved with the same content comes back "unchanged",
 *                 never as a second row.
 *   updateFoods – correct existing rows by ID. Only the fields sent are changed.
 *   foodDay     – read one day's rows and totals.
 *
 * Writes only the ten Food columns below, found by header name. Never deletes rows,
 * never touches other tabs or other columns. Plain ES5 so it runs on any Apps Script runtime.
 */
var PULSE_FOOD_COLS = ['EntryID','Date','Time','Meal','Item','Kcal','Protein_g','Carbs_g','Fat_g','Source'];
var PULSE_FOOD_KEYS = ['id','date','time','meal','item','kcal','protein','carbs','fat','source'];
var PULSE_FOOD_ACTIONS = ['saveFoods','updateFoods','foodDay'];
var PULSE_FOOD_MAX_BATCH = 100;

/** Returns a response object for the three actions above, or null so the existing router handles the rest. */
function pulseFoodAgentPost(ss, payload) {
  if (!payload || PULSE_FOOD_ACTIONS.indexOf(payload.action) < 0) return null;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return {ok:false, saved:false, error:'busy: another save is running. Send the same request again in a few seconds.'};
  var state = {written:false};
  try {
    if (payload.action === 'foodDay') return pulseFoodDay_(ss, payload);
    if (payload.action === 'saveFoods') return pulseSaveFoods_(ss, payload, state);
    return pulseUpdateFoods_(ss, payload, state);
  } catch (e) {
    var out = {ok:false, error:String((e && e.message) || e)};
    if (state.written) out.note = 'Some rows may already be saved. Send the same request again: saved rows come back as unchanged.';
    else out.saved = false;
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ── actions ── */

function pulseSaveFoods_(ss, p, state) {
  var list = pulseFoodBatch_(p.entries), defSource = p.source == null ? '' : p.source;
  var clean = list.map(function (e, i) {
    var x = {};
    for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) x[k] = e[k];
    if (x.source == null || x.source === '') x.source = defSource;
    return pulseFoodClean_(x, i, false);
  });
  pulseFoodNoDuplicateIds_(clean);

  var t = pulseFoodTable_(ss), results = [], add = [];
  clean.forEach(function (c) {
    var m = pulseFoodFind_(t, c.id);
    if (m.length > 1) results.push({id:c.id, status:'conflict', reason:'This EntryID appears more than once in the Food tab.'});
    else if (m.length === 1 && pulseFoodSame_(m[0].entry, c)) results.push({id:c.id, status:'unchanged'});
    else if (m.length === 1) results.push({id:c.id, status:'conflict', reason:'This EntryID is already saved with different values. Use updateFoods to change it.', current:m[0].entry});
    else { results.push({id:c.id, status:'added'}); add.push(c); }
  });

  // appendRow is atomic per row, so a row added by the app at the same time is never overwritten.
  add.forEach(function (c) {
    var row = []; for (var i = 0; i < t.width; i++) row.push('');
    PULSE_FOOD_COLS.forEach(function (h, i) { var v = c[PULSE_FOOD_KEYS[i]]; row[t.col[h]] = v == null ? '' : v; });
    t.sheet.appendRow(row);
    state.written = true;
  });

  return pulseFoodConfirm_(ss, clean, results, clean.map(function (c) { return c.date; }));
}

function pulseUpdateFoods_(ss, p, state) {
  var list = pulseFoodBatch_(p.entries);
  var clean = list.map(function (e, i) {
    var c = pulseFoodClean_(e, i, true);
    if (Object.keys(c).length < 2) throw new Error('entries[' + i + ']: send the EntryID and at least one field to change.');
    return c;
  });
  pulseFoodNoDuplicateIds_(clean);

  var t = pulseFoodTable_(ss), results = [], want = [], dates = [];
  clean.forEach(function (c) {
    var m = pulseFoodFind_(t, c.id);
    if (!m.length) { results.push({id:c.id, status:'not_found'}); return; }
    if (m.length > 1) { results.push({id:c.id, status:'conflict', reason:'This EntryID appears more than once in the Food tab.'}); return; }
    var before = m[0].entry, after = {};
    PULSE_FOOD_KEYS.forEach(function (k) { after[k] = Object.prototype.hasOwnProperty.call(c, k) ? c[k] : before[k]; });
    dates.push(before.date, after.date);
    want.push(after);
    if (pulseFoodSame_(before, after)) { results.push({id:c.id, status:'unchanged'}); return; }
    // Re-check the row just before writing, in case a delete moved the rows.
    var row = m[0].row;
    if (String(t.sheet.getRange(row, t.col.EntryID + 1).getValue()).trim() !== c.id) {
      var again = pulseFoodFind_(pulseFoodTable_(ss), c.id);
      if (again.length !== 1) { results.push({id:c.id, status:'not_found'}); want.pop(); return; }
      row = again[0].row;
    }
    PULSE_FOOD_KEYS.forEach(function (k, i) {
      if (k === 'id' || pulseFoodEq_(before[k], after[k])) return;
      t.sheet.getRange(row, t.col[PULSE_FOOD_COLS[i]] + 1).setValue(after[k] == null ? '' : after[k]);
      state.written = true;
    });
    results.push({id:c.id, status:'updated', before:before});
  });

  return pulseFoodConfirm_(ss, want, results, dates);
}

function pulseFoodDay_(ss, p) {
  var date = pulseFoodValidDate_(p.date, 'date');
  var t = pulseFoodTable_(ss);
  return {ok:true, date:date, entries:pulseFoodOfDay_(t, date), totals:pulseFoodTotals_(t, date)};
}

/* ── confirmation: read the tab again after writing ── */

function pulseFoodConfirm_(ss, expected, results, dates) {
  var t = pulseFoodTable_(ss), ok = true;
  results.forEach(function (r) {
    if (r.status !== 'added' && r.status !== 'updated' && r.status !== 'unchanged') { ok = false; return; }
    var want = expected.filter(function (e) { return e.id === r.id; })[0], m = pulseFoodFind_(t, r.id);
    r.confirmed = m.length === 1 && !!want && pulseFoodSame_(m[0].entry, want);
    if (!r.confirmed) ok = false;
  });
  var days = {};
  dates.forEach(function (d) { if (d && !days[d]) days[d] = pulseFoodTotals_(t, d); });
  var count = {};
  results.forEach(function (r) { count[r.status] = (count[r.status] || 0) + 1; });
  return {ok:ok, results:results, summary:count, days:days};
}

/* ── reading the Food tab ── */

function pulseFoodTable_(ss) {
  var sh = ss.getSheetByName('Food');
  if (!sh) throw new Error('The Food tab is missing.');
  var lastRow = Math.max(sh.getLastRow(), 1), lastCol = Math.max(sh.getLastColumn(), 1);
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var head = values[0].map(function (h) { return String(h == null ? '' : h).trim(); }), col = {};
  PULSE_FOOD_COLS.forEach(function (h) {
    var n = head.filter(function (x) { return x === h; }).length;
    if (n !== 1) throw new Error('The Food tab must have exactly one "' + h + '" column.');
    col[h] = head.indexOf(h);
  });
  var tz = ss.getSpreadsheetTimeZone(), rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i], id = String(r[col.EntryID] == null ? '' : r[col.EntryID]).trim();
    if (id) rows.push({row:i + 1, entry:pulseFoodFromRow_(r, col, tz)});
  }
  return {sheet:sh, col:col, width:lastCol, rows:rows, tz:tz};
}

function pulseFoodFromRow_(r, col, tz) {
  var s = function (v) { return String(v == null ? '' : v).trim(); };
  return {
    id:s(r[col.EntryID]), date:pulseFoodCellDate_(r[col.Date], tz), time:pulseFoodCellTime_(r[col.Time], tz),
    meal:s(r[col.Meal]), item:s(r[col.Item]), kcal:pulseFoodCellNum_(r[col.Kcal]), protein:pulseFoodCellNum_(r[col.Protein_g]),
    carbs:pulseFoodCellNum_(r[col.Carbs_g]), fat:pulseFoodCellNum_(r[col.Fat_g]), source:s(r[col.Source])
  };
}
function pulseFoodCellDate_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim().slice(0, 10);
}
function pulseFoodCellTime_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz, 'HH:mm');
  var s = String(v == null ? '' : v).trim(), m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : s;
}
function pulseFoodCellNum_(v) {
  if (v === '' || v == null) return null;
  var n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  return isFinite(n) ? n : null;
}
function pulseFoodFind_(t, id) { return t.rows.filter(function (r) { return r.entry.id === id; }); }
function pulseFoodOfDay_(t, date) {
  return t.rows.filter(function (r) { return r.entry.date === date; })
    .sort(function (a, b) { return (a.entry.time || '99:99').localeCompare(b.entry.time || '99:99') || a.row - b.row; })
    .map(function (r) { return r.entry; });
}
function pulseFoodTotals_(t, date) {
  var day = pulseFoodOfDay_(t, date), out = {items:day.length, kcal:0, protein:0, carbs:0, fat:0};
  day.forEach(function (e) { ['kcal','protein','carbs','fat'].forEach(function (k) { out[k] += e[k] || 0; }); });
  ['kcal','protein','carbs','fat'].forEach(function (k) { out[k] = Math.round(out[k] * 10) / 10; });
  return out;
}

/* ── comparing ── */

function pulseFoodEq_(a, b) {
  // Requests are rounded to 2 decimals; rows typed elsewhere may carry more.
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0051;
  return (a == null ? '' : String(a)) === (b == null ? '' : String(b));
}
function pulseFoodSame_(a, b) {
  return PULSE_FOOD_KEYS.every(function (k) { return pulseFoodEq_(a[k], b[k]); });
}

/* ── validating requests: every entry is checked before anything is written ── */

function pulseFoodBatch_(entries) {
  if (Object.prototype.toString.call(entries) !== '[object Array]' || !entries.length) throw new Error('entries: send a list with at least one food.');
  if (entries.length > PULSE_FOOD_MAX_BATCH) throw new Error('entries: at most ' + PULSE_FOOD_MAX_BATCH + ' foods per request.');
  return entries;
}
function pulseFoodNoDuplicateIds_(list) {
  var seen = {};
  list.forEach(function (c, i) {
    if (seen['#' + c.id]) throw new Error('entries[' + i + '].id: "' + c.id + '" is repeated in this request.');
    seen['#' + c.id] = true;
  });
}
function pulseFoodClean_(e, i, partial) {
  var at = 'entries[' + i + ']';
  if (!e || typeof e !== 'object' || Object.prototype.toString.call(e) === '[object Array]') throw new Error(at + ': each food must be an object.');
  var has = function (k) { return Object.prototype.hasOwnProperty.call(e, k) && e[k] !== undefined; };
  var out = {id:pulseFoodId_(e.id, at + '.id')};
  if (!partial || has('date')) out.date = pulseFoodValidDate_(e.date, at + '.date');
  if (!partial || has('time')) out.time = pulseFoodValidTime_(e.time, at + '.time');
  if (!partial || has('meal')) out.meal = pulseFoodText_(e.meal, at + '.meal', 40, false);
  if (!partial || has('item')) out.item = pulseFoodText_(e.item, at + '.item', 300, false);
  if (!partial || has('kcal')) out.kcal = pulseFoodNumber_(e.kcal, at + '.kcal', false);
  if (!partial || has('protein')) out.protein = pulseFoodNumber_(e.protein, at + '.protein', true);
  if (!partial || has('carbs')) out.carbs = pulseFoodNumber_(e.carbs, at + '.carbs', true);
  if (!partial || has('fat')) out.fat = pulseFoodNumber_(e.fat, at + '.fat', true);
  if (!partial || has('source')) out.source = pulseFoodText_(e.source, at + '.source', 60, true);
  return out;
}
function pulseFoodId_(v, at) {
  var s = typeof v === 'number' && isFinite(v) ? String(v) : v;
  // At least one letter, so the Sheet never turns an ID into a number or a date.
  if (typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(s.trim()) || !/[A-Za-z]/.test(s)) {
    throw new Error(at + ': use 1–100 letters, digits, dots, colons, dashes or underscores, starting with a letter or digit and with at least one letter, e.g. 20261122-food-ovos.');
  }
  return s.trim();
}
function pulseFoodValidDate_(v, at) {
  var s = typeof v === 'string' ? v.trim() : '';
  var ok = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (ok) { var d = new Date(s + 'T12:00:00Z'); ok = !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }
  if (!ok) throw new Error(at + ': use a real date as YYYY-MM-DD.');
  return s;
}
function pulseFoodValidTime_(v, at) {
  if (v == null || v === '') return '';
  var m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(at + ': use HH:mm (24-hour), or leave it empty.');
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}
function pulseFoodText_(v, at, max, optional) {
  if (optional && (v == null || v === '')) return '';
  if (typeof v !== 'string' || !v.trim()) throw new Error(at + ': write some text.');
  var s = v.trim();
  if (s.length > max) throw new Error(at + ': at most ' + max + ' characters.');
  if (/^[=+\-@]/.test(s)) throw new Error(at + ': cannot start with =, +, - or @ (the Sheet would read it as a formula).');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw new Error(at + ': contains control characters.');
  return s;
}
function pulseFoodNumber_(v, at, optional) {
  if (optional && (v == null || v === '')) return null;
  var n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v) ? Number(v.trim().replace(',', '.')) : NaN);
  if (!isFinite(n) || n < 0 || n > 20000) throw new Error(at + ': use a number from 0 to 20000' + (optional ? ', or leave it empty' : '') + '.');
  return Math.round(n * 100) / 100;
}
