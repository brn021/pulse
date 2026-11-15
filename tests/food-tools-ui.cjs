// Offline end-to-end fixture: all routes intercepted; actual v2 backend runs in a fake Sheet.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('./helpers/food-v2-fixture.cjs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const width of [320,390,1280]){
  const server=fixture(),ctx=await browser.newContext({viewport:{width,height:844}}),errors=[];
  await ctx.route('**/*',async route=>{const r=route.request();if(r.url()==='https://pulse.test/')return route.fulfill({contentType:'text/html',body:html});if(r.url().startsWith('https://script.google.com/'))return route.fulfill({contentType:'application/json',body:JSON.stringify(r.method()==='GET'?server.get():server.post(r.postDataJSON()))});return route.abort();});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-15T12:00:00Z')});await p.goto('https://pulse.test/');await p.waitForSelector('.wk');
  await p.getByRole('button',{name:/Food today/}).click();await p.evaluate(()=>editFoodItem('f1'));
  await p.getByLabel('Original quantity').fill('200');await p.getByLabel('New quantity').fill('100');await p.getByLabel('Unit (g / ml / portion)').fill('g');await p.getByRole('button',{name:'Save',exact:true}).click();await p.waitForFunction(()=>!FOOD_BUSY);assert.equal(server.get().food[0].Kcal,60);
  await p.getByRole('button',{name:'Products & recipes',exact:true}).click();await p.getByRole('button',{name:'+ Product',exact:true}).click();
  for(const [key,value] of Object.entries({name:'Yogurt',quantity:'100',unit:'g',kcal:'60',protein:'10',carbs:'3',fat:'0'}))await p.locator('#f_'+key).fill(value);
  await p.getByRole('button',{name:'Save',exact:true}).click();await p.waitForFunction(()=>!FOOD_BUSY);assert.equal(server.get().foodV2.products.length,1);
  await p.getByRole('button',{name:'Use portion',exact:true}).click();await p.locator('#f_quantity').fill('200');await p.getByRole('button',{name:'Add',exact:true}).click();await p.waitForFunction(()=>!FOOD_BUSY);assert.equal(server.get().food.at(-1).Kcal,120);
  await p.getByRole('button',{name:'← Food',exact:true}).click();await p.getByRole('button',{name:'Mark day complete',exact:true}).click();await p.getByRole('button',{name:'Mark complete',exact:true}).click();await p.waitForFunction(()=>!FOOD_BUSY);assert.equal(server.get().foodV2.days[0].closed,true);
  await p.getByRole('button',{name:'Targets',exact:true}).click();await p.locator('#f_kcal').fill('2700');await p.getByRole('button',{name:'Save',exact:true}).click();await p.waitForFunction(()=>!FOOD_BUSY);assert.equal(server.get().foodV2.targets[0].kcal,2700);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log('PASS food tools browser 320/390/1280: edit, product, portion, complete day, synced targets.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
