// All API traffic is intercepted. These tests never read or change live training/food data.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const fixture = {
  workouts: [
    { SessionID: 'b-done', Date: '2026-11-08', Workout: 'Gym B', Exercise: 'Preacher Curl', Weight: 18, Reps: 10, Note: 'Past fixture' },
    { SessionID: 'c-future', Date: '2026-11-12', Workout: 'Gym C', Exercise: 'Leg Extension', Weight: 46, Reps: 12, Note: 'Future fixture' },
    { SessionID: 'a-last-week', Date: '2026-11-07', Workout: 'Gym A', Exercise: 'Machine Chest Press', Weight: 51, Reps: 9, Note: 'History fixture' },
    { SessionID: 'home-done', Date: '2026-11-11', Workout: 'Home Training', Exercise: 'Pull-ups', BW: 'Y', Reps: 7, Note: 'Today fixture' }
  ], weight: [], nutrition: [], food: [
    { EntryID: 'food-fixture', Date: '2026-11-11', Time: '12:00', Meal: 'Lunch', Item: 'Test lunch', Kcal: 600, Protein_g: 40 }
  ]
};
const expectedData = JSON.stringify(fixture);
let browser;
async function open(viewport, timezoneId = 'UTC', time = '2026-11-11T12:00:00Z') {
  const context = await browser.newContext({ viewport, timezoneId });
  const posts = [], errors = [], blocked = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (request.url() === 'https://pulse.test/') return route.fulfill({ contentType: 'text/html', body: html });
    if (request.url().startsWith('https://script.google.com/')) {
      if (request.method() !== 'GET') {
        posts.push(request.postDataJSON());
        return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
      }
      return route.fulfill({ contentType: 'application/json', body: expectedData });
    }
    blocked.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date(time) });
  await page.goto('https://pulse.test/');
  await page.waitForSelector('.wk');
  return { context, page, posts, errors, blocked };
}
async function planCase(timezone, time, expectedToday, expectedStart, sessions, done, next) {
  const { context, page, posts, errors } = await open({ width: 390, height: 844 }, timezone, time);
  const before = JSON.stringify(sessions);
  const result = await page.evaluate(sessions => {
    SESSIONS = sessions;
    const plan = weekPlan();
    return { today: today(), start: weekStart(), done: plan.items.filter(x => x.done).map(x => x.done.id).sort(), next: plan.next?.w || null, sessions: JSON.stringify(SESSIONS) };
  }, sessions);
  assert.equal(result.today, expectedToday);
  assert.equal(result.start, expectedStart);
  assert.deepEqual(result.done, done.sort());
  assert.equal(result.next, next);
  assert.equal(result.sessions, before, 'weekly calculation must not mutate history');
  assert.deepEqual(posts, []); assert.deepEqual(errors, []);
  await context.close();
}
const session = (id, workout, date) => ({ id, workout, date, exercises: [] });
async function dateTests() {
  const cases = [
    ['UTC', '2026-11-08T12:00:00Z', '2026-11-08', '2026-11-08', [session('old','Gym B','2026-11-07'), session('future','Gym B','2026-11-09'),session('later','Gym C','2026-11-14')], [], 'Gym B'],
    ['UTC', '2026-11-11T12:00:00Z', '2026-11-11', '2026-11-08', [session('past','Gym B','2026-11-08'),session('today','Gym C','2026-11-11'),session('later-same','Gym C','2026-11-12'),session('future','Home Training','2026-11-12')], ['past','today'], 'Home Training'],
    ['UTC', '2026-11-12T00:00:00Z', '2026-11-12', '2026-11-08', [session('arrived','Gym C','2026-11-12')], ['arrived'], 'Gym B'],
    ['UTC', '2026-11-14T23:59:59Z', '2026-11-14', '2026-11-08', ['Gym B','Gym C','Home Training','Gym A'].map((w,i)=>session(String(i),w,'2026-11-14')), ['0','1','2','3'], null],
    ['UTC', '2026-11-15T00:00:00Z', '2026-11-15', '2026-11-15', [session('last-week','Gym B','2026-11-14'),session('next-day','Gym C','2026-11-16')], [], 'Gym B'],
    ['UTC', '2026-12-31T12:00:00Z', '2026-12-31', '2026-12-27', [session('past','Gym B','2026-12-27'),session('next-year','Gym A','2027-01-01')], ['past'], 'Gym C'],
    ['Asia/Tokyo', '2026-11-07T15:30:00Z', '2026-11-08', '2026-11-08', [session('today','Gym B','2026-11-08'),session('future','Gym C','2026-11-09')], ['today'], 'Gym C'],
    ['America/Los_Angeles', '2026-11-08T07:30:00Z', '2026-11-07', '2026-11-01', [session('today','Gym A','2026-11-07'),session('tomorrow','Gym B','2026-11-08')], ['today'], 'Gym B'],
    ['Europe/London', '2026-10-25T01:30:00Z', '2026-10-25', '2026-10-25', [session('today','Gym B','2026-10-25'),session('future','Gym C','2026-10-26')], ['today'], 'Gym C']
  ];
  for (const args of cases) await planCase(...args);
  console.log('PASS: nine date cases, local day boundaries, Sunday/Saturday, DST, year rollover, duplicate dates and unchanged history.');
}
const row = (page, name) => page.locator('.wrow').filter({ has: page.locator('.wnm', { hasText: name }) });
const options = (page, name) => page.getByRole('button', { name: `Options for ${name}`, exact: true });
async function focused(page, id) { assert.equal(await page.evaluate(() => document.activeElement.id), id); }
async function closed(page, id = 'week-options-1') {
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  assert.equal(await page.locator('.pg').evaluate(el => el.inert), false);
  await focused(page, id);
}
async function uiTests(viewport) {
  const { context, page, posts, errors } = await open(viewport);
  assert.equal(await page.textContent('.wkc'), '2 of 4 done');
  assert.equal(await page.locator('.wrow.next .wnm').textContent(), 'Gym C');
  assert.equal(await page.locator('.bh').count(), 4, 'future sessions remain visible in history');
  const originalStorage = await page.evaluate(() => JSON.stringify(localStorage));
  await options(page,'Gym C').click();
  assert.equal(await page.getByRole('dialog', { name: 'Gym C', exact: true }).count(), 1);
  await focused(page,'sheet-close');
  assert.equal(await page.locator('.pg').evaluate(el=>el.inert), true);
  assert.equal(await page.locator('#sheet-day-3').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#sheet-day-3').getAttribute('aria-current'), 'date');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent), 'Skip this week');
  await page.keyboard.press('Tab'); await focused(page,'sheet-close');
  await page.keyboard.press('Escape'); await closed(page);
  for (let i=0;i<2;i++) {
    await options(page,'Gym C').click();
    await page.getByRole('button',{name:'Close',exact:true}).click(); await closed(page);
  }
  await options(page,'Gym C').click();
  await page.mouse.click(2,2); await closed(page);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)), originalStorage, 'dismissal must not change data');

  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Friday',exact:true}).click(); await closed(page);
  assert.match(await row(page,'Gym C').locator('.wd').textContent(), /^Fri/);
  assert.equal(await page.evaluate(()=>loadMoves()['2026-11-08|Gym C']),5);
  await options(page,'Gym C').click();
  await page.locator('#sheet-day-5').focus();
  await page.clock.runFor(2700); // Toast removal rerenders; retain keyboard position in the menu.
  await focused(page,'sheet-day-5');
  await page.keyboard.press('Escape'); await closed(page);
  await row(page,'Gym C').locator('.wmain').click();
  await page.locator('input[placeholder="reps"]').first().fill('5');
  await page.getByRole('button',{name:'← menu',exact:true}).click();
  const draft = await page.evaluate(()=>JSON.stringify(loadDrafts()['Gym C']));
  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Skip this week',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Skip this workout?',exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip this week');
  await page.keyboard.press('Escape'); await closed(page);
  assert.equal(await page.evaluate(()=>skippedThisWeek('Gym C')),false);
  assert.equal(await page.evaluate(()=>JSON.stringify(loadDrafts()['Gym C'])),draft);
  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Skip this week',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); await closed(page);
  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Skip this week',exact:true}).click();
  await page.getByRole('button',{name:'Skip this week',exact:true}).click(); await closed(page);
  assert.equal(await page.evaluate(()=>skippedThisWeek('Gym C')),true);
  assert.equal(await page.locator('.wrow.next .wnm').textContent(),'Gym A');
  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Undo skip',exact:true}).click(); await closed(page);
  assert.equal(await page.evaluate(()=>JSON.stringify(loadDrafts()['Gym C'])),draft);
  await page.reload(); await page.waitForSelector('.wk');
  assert.match(await row(page,'Gym C').locator('.wd').textContent(),/^Fri/);
  assert.match(await row(page,'Gym C').textContent(),/Resume/);
  assert.equal(await page.evaluate(()=>JSON.stringify(loadDrafts()['Gym C'])),draft);

  // Completed-session options keep history access and starting another draft intact.
  await options(page,'Gym B').click();
  await page.getByRole('button',{name:'Open session',exact:true}).click();
  assert.match(await page.textContent('body'),/Past fixture/);
  await page.getByRole('button',{name:'← back',exact:true}).click();
  await options(page,'Gym B').click();
  await page.getByRole('button',{name:'Start again',exact:true}).click();
  assert.equal(await page.locator('.sheet').count(),0);
  await page.getByRole('button',{name:'← menu',exact:true}).click();
  await page.locator('.bh').filter({hasText:'Gym C'}).click();
  assert.match(await page.textContent('body'),/Future fixture/);
  await page.getByRole('button',{name:'← back',exact:true}).click();
  await page.getByRole('button',{name:/Food today/}).click();
  assert.match(await page.textContent('body'),/Test lunch/);
  await page.getByRole('button',{name:'← back',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.stringify(DATA)),expectedData);
  assert.deepEqual(posts,[], 'all options/history checks must be read-only for the API');
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const sizes = await page.locator('.wmore').evaluateAll(es=>es.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));
  assert(sizes.every(s=>s.w>=44&&s.h>=44),'options touch targets');
  // Composite parent backgrounds before measuring WCAG text contrast.
  const contrasts=await page.locator('.wk .wd,.wk .wmore,.wk .wsub,.wk .wd b').evaluateAll(elements=>{
    const rgba=s=>(s.match(/[\d.]+/g)||[]).map(Number);
    const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    return elements.map(el=>{
      const chain=[]; for(let n=el;n;n=n.parentElement)chain.unshift(n);
      let bg=[255,255,255];
      for(const n of chain){const c=rgba(getComputedStyle(n).backgroundColor),a=c.length===4?c[3]:1;bg=bg.map((v,i)=>(c[i]||0)*a+v*(1-a));}
      const fg=rgba(getComputedStyle(el).color),l1=lum(fg.slice(0,3)),l2=lum(bg);
      return {text:el.textContent,ratio:(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
    });
  });
  assert(contrasts.every(c=>c.ratio>=4.5),JSON.stringify(contrasts));
  if(process.env.SCREENSHOT_DIR){
    fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`weekly-${viewport.width}.png`),fullPage:true});
    await options(page,'Gym C').click();
    await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`menu-${viewport.width}.png`),fullPage:true});
  }
  console.log(`PASS: ${viewport.width}×${viewport.height} UI, Close/Escape/backdrop, tab trap/return, repeated opens, toast rerender, move/skip/cancel/undo, draft reload, history/food preservation, 44px targets and >=4.5:1 contrast (minimum ${Math.min(...contrasts.map(c=>c.ratio)).toFixed(2)}).`);
  await context.close();
}
async function draftTests(viewport) {
  const { context, page, posts, errors } = await open(viewport);
  await page.evaluate(() => {
    const d=loadDrafts();
    d['Gym A']=newSession('Gym A'); d['Gym A'].ex[0].note='Other draft';
    d[editKey('b-done')]=sessionToDraft(SESSIONS.find(s=>s.id==='b-done'));
    saveDrafts(d);
    localStorage.setItem(MOVES_KEY,JSON.stringify({[weekSkipKey('Gym C')]:5}));
    localStorage.setItem(SKIPS_KEY,JSON.stringify({[weekSkipKey('Gym A')]:true}));
    R();
  });
  const protectedData=()=>page.evaluate(()=>JSON.stringify({DATA,SESSIONS,moves:loadMoves(),skips:loadSkips(),pending:loadPending(),other:loadDrafts()['Gym A'],edit:loadDrafts()[editKey('b-done')]}));
  const before=await protectedData();
  const bannerDiscard=()=>page.getByRole('button',{name:'Discard Gym C draft',exact:true});
  const draftValue=()=>page.evaluate(()=>JSON.stringify(loadDrafts()['Gym C']));
  await row(page,'Gym C').locator('.wmain').click();
  await page.getByRole('button',{name:'← menu',exact:true}).click();
  assert.match(await row(page,'Gym C').textContent(),/Resume/);
  assert.equal(await bannerDiscard().count(),1,'Next workout exposes Discard next to Resume');
  const blank=await draftValue(), discardId=await bannerDiscard().getAttribute('id');
  for (const dismissal of ['Cancel','Escape','backdrop']) {
    await bannerDiscard().click();
    assert.equal(await page.getByRole('dialog',{name:'Discard Gym C?',exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
    assert.equal(await page.locator('.pg').evaluate(el=>el.inert),true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Discard');
    if(dismissal==='Cancel') await page.getByRole('button',{name:'Cancel',exact:true}).click();
    else if(dismissal==='Escape') await page.keyboard.press('Escape');
    else await page.mouse.click(2,2);
    await closed(page,discardId);
    assert.equal(await draftValue(),blank,'Dismissal preserves the draft');
  }
  await bannerDiscard().click();
  await page.getByRole('button',{name:'Discard',exact:true}).click();
  await closed(page);
  assert.equal(await draftValue(),undefined);
  assert.match(await row(page,'Gym C').textContent(),/Start/);
  assert.doesNotMatch(await row(page,'Gym C').textContent(),/In progress|Resume|Skipped/);
  assert.equal(await protectedData(),before);
  await page.reload(); await page.waitForSelector('.wk');
  assert.equal(await draftValue(),undefined,'Discard remains discarded after reload');

  // Filled entries and notes survive both cancellation and resuming.
  await row(page,'Gym C').locator('.wmain').click();
  await page.locator('input[oninput*="\'reps\'"]').first().fill('8');
  await page.locator('.ikg').first().fill('42');
  await page.getByRole('button',{name:'+ note',exact:true}).first().click();
  await page.locator('#f_note').fill('Fictitious note');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'← menu',exact:true}).click();
  const filled=await draftValue();
  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Discard draft',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); await closed(page);
  assert.equal(await draftValue(),filled);
  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Resume workout',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.stringify(CUR)),filled);
  await page.getByRole('button',{name:'← menu',exact:true}).click();
  await page.reload(); await page.waitForSelector('.wk');
  assert.equal(await draftValue(),filled);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const sizes=await page.locator('.draft-actions button').evaluateAll(es=>es.map(e=>({w:e.offsetWidth,h:e.offsetHeight})));
  assert(sizes.every(s=>s.w>=44&&s.h>=44),'Draft actions have 44px touch targets');
  if(process.env.SCREENSHOT_DIR){
    fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`draft-${viewport.width}.png`),fullPage:true});
  }
  await options(page,'Gym C').click();
  await page.getByRole('button',{name:'Discard draft',exact:true}).click();
  if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`discard-${viewport.width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Discard',exact:true}).click(); await closed(page);
  assert.equal(await draftValue(),undefined);
  assert.equal(await protectedData(),before);
  await row(page,'Gym C').locator('.wmain').click();
  assert.equal(await page.locator('input[oninput*="\'reps\'"]').first().inputValue(),'');
  assert.equal(await page.evaluate(()=>CUR.ex.some(e=>e.note)),false);
  await page.getByRole('button',{name:'Discard this workout',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await focused(page,'session-discard');
  await page.getByRole('button',{name:'Discard this workout',exact:true}).click();
  await page.getByRole('button',{name:'Discard',exact:true}).click(); await closed(page);
  await page.getByRole('button',{name:/Food today/}).click();
  assert.match(await page.textContent('body'),/Test lunch/);
  await page.getByRole('button',{name:'← back',exact:true}).click();

  // A second draft of a completed workout must not discard its saved session or edit.
  await options(page,'Gym B').click();
  assert.equal(await page.getByRole('button',{name:'Discard draft',exact:true}).count(),0);
  await page.getByRole('button',{name:'Start again',exact:true}).click();
  await page.getByRole('button',{name:'← menu',exact:true}).click();
  await options(page,'Gym B').click();
  assert.equal(await page.getByRole('button',{name:'Start again',exact:true}).count(),0);
  await page.getByRole('button',{name:'Discard draft',exact:true}).click();
  await page.getByRole('button',{name:'Discard',exact:true}).click(); await closed(page,'week-options-0');
  assert.equal(await page.locator('.bh').count(),4);
  assert.equal(await protectedData(),before);
  await page.locator('.bh').filter({hasText:'Gym B'}).click();
  assert.match(await page.textContent('body'),/Past fixture/);
  await page.getByRole('button',{name:'← back',exact:true}).click();
  await page.getByRole('button',{name:'Discard Gym A draft',exact:true}).click();
  await page.getByRole('button',{name:'Discard',exact:true}).click();
  assert.equal(await page.evaluate(()=>skippedThisWeek('Gym A')),true,'Discard does not alter an existing skip');
  assert.equal(await page.evaluate(()=>loadDrafts()['Gym A']),undefined);
  assert.deepEqual(posts,[],'Discard never writes or deletes Sheet records');
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${viewport.width}px draft UI: empty/filled cancel, Escape/backdrop, focus, resume/reload, confirmed discard/fresh start, saved-session/edit protection, unchanged schedules/history/food, no API writes.`);
  await context.close();
}
(async()=>{
  const executablePath=process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  try{
    await dateTests();
    for(const viewport of [{width:390,height:844},{width:320,height:568},{width:1280,height:800}]){ await uiTests(viewport); await draftTests(viewport); }
    console.log('PASS: JavaScript syntax and all weekly UI regressions. Every API request was mocked.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
