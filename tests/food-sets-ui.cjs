// All API traffic is intercepted. These tests never read or change live training/food data.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const DAY = '2026-11-15';
const food = (EntryID, Date, Meal, Item, Kcal, Protein_g, Carbs_g, Fat_g) => ({ EntryID, Date, Time: '12:00', Meal, Item, Kcal, Protein_g, Carbs_g, Fat_g, Source: 'claude' });
const fixture = {
  workouts: [
    { SessionID: 'b-prev', Date: '2026-11-08', Workout: 'Gym B', Exercise: 'Seated Row', Weight: 53, Reps: 12, RIR: '' },
    { SessionID: 'b-prev', Date: '2026-11-08', Workout: 'Gym B', Exercise: 'Seated Row', Weight: 53, Reps: 11, RIR: '' },
    { SessionID: 'b-prev', Date: '2026-11-08', Workout: 'Gym B', Exercise: 'Seated Row', Weight: 53, Reps: 9, RIR: '' }
  ],
  weight: [], nutrition: [{ Date: DAY, Sleep_h: 7.5 }],
  food: [
    food('f1', DAY, 'Breakfast', 'Fixture yogurt', 380, 28, 42, 9),
    food('f2', DAY, 'Lunch', 'Fixture chicken and rice', 640, 62, 70, 10),
    food('f3', DAY, 'Snack', 'Fixture mousse', 140, 20, 9, 2),
    food('f4', '2026-11-14', 'Dinner', 'Fixture salmon', 720, 45, 55, 30),
    food('f5', '2026-11-13', 'Snack', 'Fixture banana', 105, 1, 27, 0),
    food('f6', '2026-11-12', 'Snack', 'Fixture oats', 300, 10, 50, 6),
    food('f7', '2026-11-12', 'Snack', 'Fixture coffee', 60, 3, 5, 3)
  ]
};
const expectedData = JSON.stringify(fixture);
let browser;
async function open(viewport) {
  const context = await browser.newContext({ viewport, timezoneId: 'Europe/Dublin' });
  const posts = [], errors = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (request.url() === 'https://pulse.test/') return route.fulfill({ contentType: 'text/html', body: html });
    if (request.url() === 'https://pulse.test/food-catalog-v1.js') return route.fulfill({ contentType: 'text/javascript', path: path.join(__dirname, '..', 'food-catalog-v1.js') });
    if (request.url().startsWith('https://script.google.com/')) {
      if (request.method() !== 'GET') { posts.push(request.postDataJSON()); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
      return route.fulfill({ contentType: 'application/json', body: expectedData });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date(DAY + 'T19:00:00Z') });
  await page.goto('https://pulse.test/');
  await page.waitForSelector('.wk');
  return { context, page, posts, errors };
}
const big = async locator => (await locator.evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }))).every(Boolean);

async function setsCase(viewport) {
  const { context, page, posts, errors } = await open(viewport);
  // Every exercise of every active workout offers one more set.
  for (const w of ['Gym B', 'Gym C', 'Home Training', 'Gym A']) {
    const counts = await page.evaluate(w => { go(w); return { ex: CUR.ex.length, btn: document.querySelectorAll('.ec .baddset').length }; }, w);
    assert.equal(counts.btn, counts.ex, `${w}: + set on every exercise`);
    assert(await big(page.locator('.baddset')), `${w}: + set touch targets`);
    await page.evaluate(() => { CUR = null; localStorage.removeItem('pulse-drafts-v7'); menu(); });
  }
  await page.evaluate(() => { localStorage.removeItem('pulse-drafts-v7'); go('Gym B'); });
  const idx = await page.evaluate(() => CUR.ex.findIndex(e => e.n === 'Seated Row'));
  const card = page.locator('.ec').nth(idx);
  const planned = await page.evaluate(i => CUR.ex[i].sets.length, idx);
  assert.equal(await card.locator('.brmset').count(), 0, 'planned sets cannot be removed');
  await card.locator('.baddset').click();
  let ex = await page.evaluate(i => ({ n: CUR.ex[i].sets.length, kg: CUR.ex[i].sets.at(-1).kg, last: CUR.ex[i].sets.at(-1).last }), idx);
  assert.equal(ex.n, planned + 1);
  assert.equal(String(ex.kg), String(await page.evaluate(i => CUR.ex[i].sets[0].kg, idx)), 'new set copies the load');
  assert.equal(String(ex.last), '9', 'new set shows the reps from the matching set last time');
  assert.match(await card.locator('.baddset').textContent(), new RegExp(`Set ${planned + 2}`));
  await card.locator('.brmset').click();
  assert.equal(await page.evaluate(i => CUR.ex[i].sets.length, idx), planned);
  await page.evaluate(i => { rmSet(i); rmSet(i); }, idx);
  assert.equal(await page.evaluate(i => CUR.ex[i].sets.length, idx), planned, 'rmSet never removes planned sets');
  for (let k = 0; k < 15; k++) await page.evaluate(i => addSet(i), idx);
  assert.equal(await page.evaluate(i => CUR.ex[i].sets.length, idx), 10, 'capped at 10 sets');
  assert.equal(await card.locator('.baddset').count(), 0);
  // The extra set survives a reload as part of the draft, and empty sets are not saved.
  await page.reload(); await page.waitForSelector('.wk');
  await page.evaluate(() => go('Gym B'));
  assert.equal(await page.evaluate(i => CUR.ex[i].sets.length, idx), 10, 'draft keeps the added sets');
  const payload = await page.evaluate(i => { CUR.ex[i].sets[3].reps = '8'; return buildPayload().exercises.find(e => e.name === 'Seated Row'); }, idx);
  assert.equal(payload.sets.length, 1, 'only sets with reps are saved');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(posts, []); assert.deepEqual(errors, []);
  await context.close();
}

async function foodCase(viewport) {
  const { context, page, posts, errors } = await open(viewport);
  await page.getByRole('button', { name: /Food today/ }).click();
  const body = await page.textContent('body');
  for (const t of ['Fixture yogurt', 'Fixture chicken and rice', 'Fixture mousse', '1160', '110', '/ 160 g', 'Sleep 7.5 h']) assert(body.includes(t), `food summary shows ${t}`);
  assert.equal(await page.locator('[id^="food-item-"]').count(), 3, 'three items today');
  assert.equal(await page.locator('.fmeal.none').count(), 1, 'Dinner shown as empty');
  assert.equal(await page.locator('.fnav').nth(1).isVisible(), false, 'no next day from today');
  assert.equal(await page.locator('.fmh').first().textContent(), 'Breakfast380 kcal · 28 g P');
  // Add again: first five, then all.
  assert.equal(await page.locator('[aria-label^="Add "][aria-label$=" again"]').count(), 5);
  await page.getByRole('button', { name: 'Show all 7' }).click();
  assert.equal(await page.locator('[aria-label^="Add "][aria-label$=" again"]').count(), 7);
  await page.getByRole('button', { name: 'Show fewer' }).click();
  // Item sheet: details, Close, Escape, backdrop.
  await page.locator('[id^="food-item-"]', { hasText: 'Fixture mousse' }).click();
  const sheet = await page.locator('#food-options').innerText();
  for (const t of ['Fixture mousse', 'Snack', '140', '20 g', '9 g', '2 g', 'Add again to Snack', 'Remove']) assert(sheet.includes(t), `sheet shows ${t}`);
  assert(await big(page.locator('#food-options button')), 'sheet touch targets');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#food-options').count(), 0);
  await page.locator('[id^="food-item-"]', { hasText: 'Fixture mousse' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click(); assert.equal(await page.locator('#food-options').count(), 0);
  // Viewing never writes.
  assert.deepEqual(posts, []);
  assert.equal(await page.evaluate(() => JSON.stringify(DATA)), expectedData);
  // Remove: cancel writes nothing, confirm sends deleteFood with this id only.
  await page.locator('[id^="food-item-"]', { hasText: 'Fixture mousse' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(posts, []);
  await page.locator('[id^="food-item-"]', { hasText: 'Fixture mousse' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.locator('.md').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.md'));
  assert.deepEqual(posts, [{ action: 'deleteFood', id: 'f3' }]);
  // Add again: same item, meal and macros, on the day shown.
  posts.length = 0;
  await page.locator('[id^="food-item-"]', { hasText: 'Fixture yogurt' }).click();
  await page.getByRole('button', { name: 'Add again to Breakfast' }).click();
  await page.waitForFunction(() => !document.querySelector('#food-options'));
  await page.waitForTimeout(50);
  assert.equal(posts.length, 1);
  const e = posts[0].entries[0];
  assert.deepEqual([posts[0].action, e.date, e.meal, e.item, e.kcal, e.protein, e.carbs, e.fat], ['logFood', DAY, 'Breakfast', 'Fixture yogurt', 380, 28, 42, 9]);
  // Previous day shows that day's entries and allows going forward again.
  await page.getByRole('button', { name: 'Previous day' }).click();
  assert.match(await page.textContent('body'), /Fixture salmon/);
  assert.equal(await page.locator('.fnav').nth(1).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: '← back', exact: true }).click();
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1280, height: 800 }]) {
      await setsCase(viewport);
      await foodCase(viewport);
      console.log(`PASS: ${viewport.width}px + set on every exercise (copy load, last reps, remove extra only, cap 10, draft reload, empty sets skipped) and food screen (summary, meals, add again list, item sheet Close/Escape, remove cancel/confirm, add again, day nav, no overflow).`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
