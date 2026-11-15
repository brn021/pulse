// Pure fixture-only Apps Script contract tests. No network or live spreadsheet.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
class Sheet {
  constructor(rows=[]){this.rows=rows;this.failWrite=false;}
  getLastRow(){let n=this.rows.length;while(n && this.rows[n-1].every(x=>x===''))n--;return n;}
  getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}
  getDataRange(){return this.getRange(1,1,Math.max(this.rows.length,1),this.getLastColumn());}
  getRange(r,c,n=1,m=1){const self=this;return {
    getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.rows[r+i-1]?.[c+j-1]??''));},
    getFormulas(){return this.getValues().map(row=>row.map(v=>typeof v==='string'&&v.startsWith('=')?v:''));},
    getValue(){return this.getValues()[0][0];},
    setValue(v){return this.setValues([[v]]);},
    setValues(values){if(self.failWrite || self.failRow===r)throw Error('fixture storage failure');for(let i=0;i<n;i++){self.rows[r+i-1]??=[];for(let j=0;j<m;j++)self.rows[r+i-1][c+j-1]=values[i][j];}return this;},
    clearContent(){return this.setValues(Array.from({length:n},()=>Array(m).fill('')));}
  };}
}
const H=['EntryID','Date','Time','Meal','Item','Kcal','Protein_g','Carbs_g','Fat_g','Source','Unrelated'];
const original=['f1','2026-11-15','12:00','Lunch','Fixture food',100,10,'',5,'label','=1+1'];
const sheets={Food:new Sheet([H,original.slice()])};
const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet()),getSpreadsheetTimeZone:()=> 'Europe/Dublin'};
let locked=false;
const ctx=vm.createContext({console,LockService:{getScriptLock:()=>({tryLock(){assert(!locked);locked=true;return true;},waitLock(){assert(!locked);locked=true;},releaseLock(){locked=false;}})},Utilities:{formatDate:d=>d.toISOString().slice(0,10),getUuid:()=>Math.random().toString(36).slice(2)}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../backend/food-v2.gs'),'utf8'),ctx);
const get=()=>ctx.pulseFoodV2Get(ss).foodV2;
const post=p=>ctx.pulseFoodV2Post(ss,{expectedRevision:get().revision,...p});
const deep=x=>JSON.parse(JSON.stringify(x));
assert.equal(get().revision,0);assert.equal(sheets._PulseFoodV2,undefined,'reads do not create metadata');
const snap=()=>JSON.stringify(sheets.Food.rows);
const sig=()=>ctx.pulseFoodV2Signature_(ctx.pulseFoodV2Food_(ss).records.map(r=>r.entry),'2026-11-15');
assert.equal(post({action:'setFoodDay',date:'2026-11-15',closed:true,signature:'wrong'}).ok,false);
assert.equal(post({action:'setFoodDay',date:'2026-11-15',closed:true,signature:sig()}).ok,true);
assert.equal(get().days[0].closed,true);
const expected={date:'2026-11-15',time:'12:00',meal:'Lunch',item:'Fixture food',kcal:100,protein:10,carbs:null,fat:5,source:'label'};
const entry={...expected,time:'12:00',kcal:200,protein:20,fat:10,quantity:200,unit:'g'};
assert.equal(post({action:'updateFood',id:'f1',expected,entry}).ok,true);
assert.equal(sheets.Food.rows.length,2);assert.equal(sheets.Food.rows[1][0],'f1');assert.equal(sheets.Food.rows[1][5],200);
assert.equal(sheets.Food.rows[1][10],'=1+1','unrelated formulas preserved');
assert.deepEqual(deep(get().portions.f1),{quantity:200,unit:'g'});assert.equal(get().days[0].closed,false);
let before=snap();assert.equal(post({action:'updateFood',id:'f1',expected,entry}).ok,false,'stale food rejected');assert.equal(snap(),before);
assert.equal(post({action:'saveFoodProduct',expectedRevision:0,record:{}}).ok,false,'stale revision rejected');
const product={id:'p1',name:'Fixture yogurt',quantity:100,unit:'g',kcal:60,protein:10,carbs:3,fat:0};
assert.equal(post({action:'saveFoodProduct',record:product}).ok,true);
assert.equal(post({action:'saveFoodRecipe',record:{...product,id:'r1',ingredients:[{name:'200 g yogurt',kcal:120,protein:20,carbs:6,fat:0}],quantity:250}}).ok,true);
assert.equal(get().recipes.length,1);assert.equal(get().recipes[0].kcal,120,'recipe totals derived from ingredients');assert.equal(get().recipes[0].protein,20);assert.equal(get().products.length,1);assert.equal(snap(),before,'library does not rewrite past food');
assert.equal(post({action:'saveFoodProduct',record:{...product,name:'=IMPORTXML("bad")'}}).ok,false);
assert.equal(post({action:'saveFoodProduct',record:{...product,id:'__proto__'}}).ok,false);
assert.equal(post({action:'saveFoodProduct',record:{...product,quantity:0}}).ok,false);
assert.equal(post({action:'saveFoodProduct',record:{...product,kcal:-1}}).ok,false);
assert.equal(post({action:'saveFoodProduct',record:{...product,kcal:Infinity}}).ok,false);
assert.equal(post({action:'setFoodTargets',record:{date:'2026-02-30',protein:160}}).ok,false);
assert.equal(post({action:'setFoodTargets',record:{date:'2026-11-15',protein:160,kcal:2700,carbs:335,fat:80}}).ok,true);
assert.equal(post({action:'setFoodTargets',record:{date:'2026-12-01',protein:170,kcal:2800}}).ok,true);
assert.equal(get().targets.length,2);
assert.equal(post({action:'setFoodDay',date:'2026-11-15',closed:true,signature:sig()}).ok,true);
sheets.Food.rows[1][5]=201;assert.equal(get().days[0].closed,false,'manual edit invalidates completed day');
const fresh={id:'f2',date:'2026-11-15',time:'13:00',meal:'Snack',item:'Fixture snack',kcal:50,protein:3,carbs:2,fat:1,source:'manual',quantity:1,unit:'unit'};
assert.equal(post({action:'logFoodV2',entries:[fresh]}).ok,true);assert.equal(sheets.Food.getLastRow(),3);
assert.equal(post({action:'logFoodV2',entries:[fresh]}).ok,true);assert.equal(sheets.Food.getLastRow(),3,'same ID retry no duplicate');
assert.equal(post({action:'logFoodV2',entries:[{...fresh,kcal:60}]}).ok,false);
assert.equal(post({action:'logFoodV2',entries:[{...fresh,id:'f3'},{...fresh,id:'f3'}]}).ok,false);
assert.equal(sheets.Food.getLastRow(),3);
// Metadata failure rolls back the Food edit without deleting its row.
const current=ctx.pulseFoodV2Food_(ss).records[0].entry;before=snap();
sheets._PulseFoodV2.failWrite=true;
const failure=ctx.pulseFoodV2Post(ss,{action:'updateFood',expectedRevision:get().revision,id:'f1',expected:current,entry:{...current,kcal:300,quantity:300,unit:'g'}});
assert.equal(failure.ok,false);assert.equal(snap(),before,'rollback preserves old row');
sheets._PulseFoodV2.failWrite=false;
assert.equal(locked,false,'lock released on error');
assert.equal(ctx.pulseFoodV2Post(ss,{action:'logWorkout'}),null,'legacy routes not intercepted');
// Manifest failure keeps the prior metadata snapshot and rolls back appended food.
const revision=get().revision, count=sheets.Food.getLastRow();
sheets._PulseFoodV2.failRow=2;
const interrupted=ctx.pulseFoodV2Post(ss,{action:'logFoodV2',expectedRevision:revision,entries:[{...fresh,id:'f-lost'}]});
assert.equal(interrupted.ok,false);assert.equal(get().revision,revision);
assert.equal(sheets.Food.getLastRow(),count);
sheets._PulseFoodV2.failRow=null;
// A large library uses multiple chunks safely; corruption is detected, not reset.
const large=get();large.products=Array.from({length:500},(_,i)=>({...product,id:'large-'+i,name:'Fixture long product '+i+'x'.repeat(150)}));
ctx.pulseFoodV2WriteState_(ss,large);
assert.equal(get().products.length,500);
const manifest=JSON.parse(sheets._PulseFoodV2.rows[1][0]);
assert(manifest.count>1);
const chunk=sheets._PulseFoodV2.rows.find(r=>r[0]===manifest.generation&&r[1]===0);
assert(chunk[2].startsWith('JSON:'));
const savedChunk=chunk[2];chunk[2]+='!';
assert.throws(()=>get(),/integrity/);assert.equal(locked,false);
chunk[2]=savedChunk;
assert.equal(get().products.length,500);
// Missing or duplicated schema headers reject writes and never invent a new Food schema.
sheets.Food.rows[0][0]='Other';assert.throws(()=>get(),/schema/);sheets.Food.rows[0][0]='EntryID';
console.log('PASS Food v2 backend: fixtures only; optimistic conflicts, schema/validation, same-row edits, library/history, complete-day signatures, append idempotency, and rollback.');
