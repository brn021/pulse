// Fictitious data only. Any attempt to contact the Sheet fails this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nboot\(\);\s*$/, '\n');
function setup() {
  const storage = new Map();
  const context = vm.createContext({
    document: { addEventListener() {}, activeElement: { id: 'draft-discard-1' } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    fetch() { throw Error('Draft discard must not contact the Sheet'); },
    console, setTimeout, clearTimeout
  });
  vm.runInContext('window = globalThis', context);
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  run(`R=()=>{}; window.scrollTo=()=>{};
    DATA.workouts=[{SessionID:'saved',Date:'2026-11-08',Workout:'Gym B',Exercise:'Preacher Curl',Weight:18,Reps:10}];
    DATA.food=[{EntryID:'meal',Item:'Fictitious lunch'}]; reconstruct();
    localStorage.setItem(MOVES_KEY,JSON.stringify({'2026-11-08|Gym C':5}));
    localStorage.setItem(SKIPS_KEY,JSON.stringify({'2026-11-08|Gym A':true}));
    saveDrafts({'Gym C':newSession('Gym C'),'Gym A':newSession('Gym A'),'edit:saved':sessionToDraft(SESSIONS[0])});
    V='menu';
  `);
  const protectedData = () => run(`JSON.stringify({DATA,SESSIONS,moves:loadMoves(),skips:loadSkips(),pending:loadPending(),other:loadDrafts()['Gym A'],edit:loadDrafts()['edit:saved']})`);
  return { context, run, protectedData };
}
for (const populated of [false,true]) {
  const { run, protectedData } = setup();
  if(populated) run(`const d=loadDrafts();d['Gym C'].ex[0].sets[0].reps='8';d['Gym C'].ex[0].note='Keep until confirmed';saveDrafts(d);`);
  const before=protectedData(), draft=run(`JSON.stringify(loadDrafts()['Gym C'])`);
  run(`askDiscard('Gym C')`);
  assert.equal(run('MODAL.ok'),'Discard');
  assert.equal(run(`JSON.stringify(loadDrafts()['Gym C'])`),draft);
  run('closeModal()');
  assert.equal(run(`JSON.stringify(loadDrafts()['Gym C'])`),draft,'Cancel preserves all draft data');
  run(`go('Gym C')`);
  assert.equal(run('JSON.stringify(CUR)'),draft,'Resume preserves all draft data');
  run(`askDiscard('Gym C');modalConfirm()`);
  assert.equal(run(`loadDrafts()['Gym C']`),undefined);
  assert.equal(run('CUR'),null);
  assert.equal(run('V'),'menu');
  assert.equal(protectedData(),before,'Discard preserves history, food, schedule and other drafts');
  run(`menu();go('Gym C')`);
  assert.equal(run(`CUR.ex.some(e=>e.note||e.sets.some(s=>s.reps!==''))`),false,'Starting again has no discarded entries');
}
for (const field of ['op','drop']) {
  const { run, protectedData } = setup();
  run(field==='op' ? `const d=loadDrafts();d['Gym C'].op={id:'possibly-saved',n:1,sig:'old'};saveDrafts(d);`
    : `const d=loadDrafts();d['Gym C'].drop=['possibly-saved'];saveDrafts(d);`);
  const before=protectedData(), draft=run(`JSON.stringify(loadDrafts()['Gym C'])`);
  run(`askDiscard('Gym C')`);
  assert.equal(run('MODAL.ok'),'Resume');
  run('modalConfirm()');
  assert.equal(run('V'),'go');
  assert.equal(run('JSON.stringify(CUR)'),draft);
  assert.equal(protectedData(),before,'Uncertain save must not delete or queue history');
}
{
  const { run, protectedData } = setup(), before=protectedData();
  run(`askDiscard('edit:saved');askDiscard('missing')`);
  assert.equal(run('MODAL'),null,'Ordinary discard cannot target an edit or missing draft');
  run(`BUSY=true;askDiscard('Gym C')`);
  assert.equal(run('MODAL'),null,'An active save cannot be discarded');
  assert.equal(protectedData(),before);
}
{
  const { run, protectedData } = setup(), before=protectedData();
  run(`askDiscard('Gym C');const d=loadDrafts();d['Gym C'].op={id:'new-attempt'};saveDrafts(d);modalConfirm()`);
  assert.equal(run('MODAL.ok'),'Resume','Recheck uncertain saves at confirmation time');
  assert.equal(run(`loadDrafts()['Gym C'].op.id`),'new-attempt');
  assert.equal(protectedData(),before);
}
{
  const { run, protectedData } = setup(), before=protectedData(), draft=run(`JSON.stringify(loadDrafts()['Gym C'])`);
  run(`localStorage.setItem=()=>{throw Error('Storage unavailable')};askDiscard('Gym C');modalConfirm()`);
  assert.equal(run('TT.err'),true,'Failed persistence must not claim success');
  assert.equal(run(`JSON.stringify(loadDrafts()['Gym C'])`),draft);
  assert.equal(protectedData(),before);
}
console.log('PASS: empty/populated draft cancel, resume, confirm and fresh restart; unchanged history/food/schedule/other drafts; uncertain-save, active-save, edited-session and storage-failure protections. No network.');
