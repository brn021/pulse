const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nboot\(\);\s*$/, '\n');
new Function(script);
const cases = [
  ['UTC','2026-11-08T12:00:00Z','2026-11-08','2026-11-08',[['old','Gym B','2026-11-07'],['future','Gym B','2026-11-09'],['later','Gym C','2026-11-14']],[],'Gym B'],
  ['UTC','2026-11-11T12:00:00Z','2026-11-11','2026-11-08',[['past','Gym B','2026-11-08'],['today','Gym C','2026-11-11'],['later-same','Gym C','2026-11-12'],['future','Home Training','2026-11-12']],['past','today'],'Home Training'],
  ['UTC','2026-11-12T00:00:00Z','2026-11-12','2026-11-08',[['arrived','Gym C','2026-11-12']],['arrived'],'Gym B'],
  ['UTC','2026-11-14T23:59:59Z','2026-11-14','2026-11-08',['Gym B','Gym C','Home Training','Gym A'].map((w,i)=>[String(i),w,'2026-11-14']),['0','1','2','3'],null],
  ['UTC','2026-11-15T00:00:00Z','2026-11-15','2026-11-15',[['last-week','Gym B','2026-11-14'],['next-day','Gym C','2026-11-16']],[],'Gym B'],
  ['UTC','2026-12-31T12:00:00Z','2026-12-31','2026-12-27',[['past','Gym B','2026-12-27'],['next-year','Gym A','2027-01-01']],['past'],'Gym C'],
  ['Asia/Tokyo','2026-11-07T15:30:00Z','2026-11-08','2026-11-08',[['today','Gym B','2026-11-08'],['future','Gym C','2026-11-09']],['today'],'Gym C'],
  ['America/Los_Angeles','2026-11-08T07:30:00Z','2026-11-07','2026-11-01',[['today','Gym A','2026-11-07'],['tomorrow','Gym B','2026-11-08']],['today'],'Gym B'],
  ['Europe/London','2026-10-25T01:30:00Z','2026-10-25','2026-10-25',[['today','Gym B','2026-10-25'],['future','Gym C','2026-10-26']],['today'],'Gym C']
];
for (const [zone,time,expectedToday,start,rows,done,next] of cases) {
  process.env.TZ=zone;
  const sessions=rows.map(([id,workout,date])=>({id,workout,date,exercises:[]}));
  const context=vm.createContext({
    Date: class extends Date { constructor(...args){ super(...(args.length?args:[time])); } },
    window:{}, document:{addEventListener(){}},localStorage:{getItem(){return null;}},
    console,setTimeout,clearTimeout
  });
  vm.runInContext(script,context);
  context.fixtures=sessions;
  const result=JSON.parse(vm.runInContext(`SESSIONS=fixtures; JSON.stringify({today:today(),start:weekStart(),done:weekPlan().items.filter(x=>x.done).map(x=>x.done.id).sort(),next:weekPlan().next?.w||null,sessions:SESSIONS})`,context));
  assert.equal(result.today,expectedToday);assert.equal(result.start,start);
  assert.deepEqual(result.done,done.sort());assert.equal(result.next,next);
  assert.deepEqual(result.sessions,sessions);
}
console.log('PASS: JavaScript syntax; nine date regressions across four timezones, Sunday/Saturday, DST, year rollover, future/today/past combinations; unchanged history. No network.');
