// Frontend/backend integration in VM with in-memory fake Sheets, never a live request.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const fixture=require('./helpers/food-v2-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nboot\(\);\s*$/, '\n');
const server=fixture(), store=new Map(),posts=[];
const ctx=vm.createContext({console,setTimeout,clearTimeout,document:{addEventListener(){},activeElement:{}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},fetch(){throw Error('No live network');}});
vm.runInContext('window=globalThis',ctx);vm.runInContext(source,ctx);
const run=s=>vm.runInContext(s,ctx), deep=x=>JSON.parse(JSON.stringify(x));
ctx.fakeGet=()=>server.get();ctx.fakePost=p=>{posts.push(deep(p));return server.post(p);};
run(`R=()=>{};apiGet=async()=>fakeGet();apiPost=async p=>fakePost(p);FDAY='2026-11-15';`);
(async()=>{
 await run('boot(true)');
 assert.equal(run('foodV2()'),true);
 assert.equal(run(`foodSignature(FDAY)`),server.ctx.pulseFoodV2Signature_(server.ctx.pulseFoodV2Food_(server.ss).records.map(r=>r.entry),'2026-11-15'));
 const old=server.get().food[0];
 run(`editFoodItem('f1')`);assert.equal(posts.length,0);run('closeModal()');assert.equal(posts.length,0);
 run(`editFoodItem('f1')`);assert.notEqual(run(`MODAL.validate({original:'0',quantity:'20',date:'2026-11-15',item:'x',unit:'g'})`),true);
 assert.equal(run(`MODAL.validate({original:'200',quantity:'100',date:'2026-11-15',item:'Fixture yogurt',unit:'g'})`),true);
 await run(`MODAL.cb({original:'200',quantity:'100',date:'2026-11-15',item:'Fixture yogurt',unit:'g',meal:'Lunch'});`);
 // cb starts mutation; await it independently through a microtask turn.
 await new Promise(r=>setImmediate(r));
 assert.equal(server.get().food[0].Kcal,60);assert.equal(server.get().food.length,1);assert.equal(server.get().food[0].EntryID,old.EntryID);
 assert.equal(server.get().foodV2.portions.f1.quantity,100);
 run('newFoodProduct()');await run(`MODAL.cb({name:'Yogurt',quantity:'100',unit:'g',kcal:'60',protein:'10',carbs:'3',fat:'0'})`);await new Promise(r=>setImmediate(r));
 assert.equal(server.get().foodV2.products.length,1);
 run('newFoodRecipe()');assert.notEqual(run(`MODAL.validate({name:'Cake',unit:'g',quantity:'500',ingredients:'bad line'})`),true);
 await run(`MODAL.cb({name:'Cake v1',unit:'g',quantity:'500',ingredients:'Eggs | 360 | 31.5 | 2 | 24\\nMousse | 168 | 20.4 | 7.8 | 5.4'})`);await new Promise(r=>setImmediate(r));
 assert.equal(server.get().foodV2.recipes[0].kcal,528);
 run(`portionDialog(foodState().recipes[0],'Cake')`);await run(`MODAL.cb({quantity:'50',date:'2026-11-15',meal:'Snack'})`);await new Promise(r=>setImmediate(r));
 assert.equal(server.get().food.at(-1).Kcal,52.8);assert.equal(server.get().foodV2.portions[server.get().food.at(-1).EntryID].quantity,50);
 const saved=JSON.stringify(server.get().food);run('newFoodRecipe(foodState().recipes[0])');await run(`MODAL.cb({name:'Cake v2',unit:'g',quantity:'500',ingredients:'Ingredient | 1000 | 100 | 100 | 30'})`);await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(server.get().food),saved);
 run('toggleFoodDay()');await run('MODAL.cb()');assert.equal(run('dayClosed(FDAY)'),true);
 assert.match(run('foodWeekSummary(FDAY)'),/1\/7 days complete/);
 server.sheets.Food.rows[1][5]=61;await run('boot(true)');assert.equal(run('dayClosed(FDAY)'),false);
 run('editFoodTargets()');await run(`MODAL.cb({date:'2026-11-15',kcal:'2700',protein:'160',carbs:'335',fat:'80'})`);
 assert.equal(run(`targetAt('2026-11-15').kcal`),2700);assert.equal(run(`targetAt('2026-11-14').protein`),160);
 // Snapshot revision protects dialogs opened before another device changed the library.
 run('newFoodProduct()');server.post({action:'setFoodTargets',expectedRevision:server.get().foodV2.revision,record:{date:'2026-12-01',kcal:2800,protein:170}});await run('boot(true)');
 await run(`MODAL.cb({name:'Stale',quantity:'100',unit:'g',kcal:'60',protein:'10',carbs:'3',fat:'0'})`);assert.equal(server.get().foodV2.products.length,1);
 assert.match(run('TT.msg'),/changed/);
 // Double tap yields one write and a stable operation ID. Retry after an uncertain reply is safe.
 run(`apiPost=async p=>{const r=fakePost(p);await Promise.resolve();return r;}`);
 const before=posts.length;await run(`Promise.all([foodAgain('f1'),foodAgain('f1')])`);await new Promise(r=>setImmediate(r));assert.equal(posts.length-before,1);
 const count=server.get().food.length;
 run(`apiPost=async p=>{fakePost(p);throw Error('Network after commit')}`);await run(`saveFood([{id:'uncertain',date:FDAY,time:'15:00',meal:'Snack',item:'Fiction',kcal:10,protein:1,carbs:1,fat:0,source:'test'}],'saved')`);
 assert.equal(server.get().food.length,count+1);assert.equal(run('FOOD_PENDING'),null,'GET reconciles ambiguous saved result');
 run(`apiPost=async p=>fakePost(p)`);await run(`saveFood([{id:'bad',date:'2026-02-30',item:'Invalid',kcal:1}],'saved')`);assert.equal(run('FOOD_PENDING'),null,'definitive rejection does not block later food');
 // Legacy backend stays readable; no unsupported mutations are sent.
 run('DATA.capabilities={};');const n=posts.length;run(`editFoodItem('f1');newFoodProduct();editFoodTargets()`);assert.equal(posts.length,n);assert.match(run('TT.msg'),/backend update/);
 assert.equal(run(`validDay('2026-02-30')`),false);
 console.log('PASS Food tools frontend/backend: edit/cancel/validation, recipe scaling and historical preservation, complete-day invalidation, targets, optimistic conflicts, double tap, ambiguous-save reconciliation, legacy capability gate.');
})().catch(e=>{console.error(e);process.exit(1)});
