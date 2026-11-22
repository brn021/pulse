# Pulse

A single-file training and food log, published with GitHub Pages.

## Regression checks

```sh
npm ci
npx playwright install chromium
npm test
```

For date and draft-safety checks without a browser, run `npm run test:unit`.
Use `CHROMIUM_PATH` to select a system Chromium executable, and optionally set
`SCREENSHOT_DIR` to save screenshots from the browser checks.

The tests use fictitious records and intercept every request. They never read or
change live Sheet data. Coverage includes local-date/week boundaries, future-dated
history, menu keyboard navigation and dismissal, move/skip/undo, draft persistence, discard/cancel/resume/fresh-start flows, saved-session protection,
contrast, touch targets, mobile/desktop layouts, the + set shortcut on every
exercise, and the food screen (item details, add again, remove with confirmation). GitHub Actions runs the same
checks for pull requests and main-branch updates.

## Food catalog

Food → **Food catalog** opens the checked-in starter catalog. Search accepts
English and Portuguese food terms, and categories filter rather than splitting
the catalog into separate lists. Tap a star to pin a favorite. Recently
successfully logged catalog items appear near the top. Both shortcuts are
specific to the current browser; the actual food entry still syncs to the Sheet.

Select the food, enter grams or a supported slice/piece/portion count, and
check the preview. Weighed grams override a count conversion. The source and
any package-based weight estimate appear with the preview. Generic USDA entries
are approximate references with fibre subtracted from total carbs to match the
label convention; the Charleville label's \<0.1 g carbohydrate per slice is
represented as 0.05 g per slice. Labels/variants can change.

For assistants/scripts, use the same versioned data and calculator as the UI:

```sh
node scripts/food-catalog.cjs list "arroz"
node scripts/food-catalog.cjs calculate charleville-medium-red-slices 2 slice
node scripts/food-catalog.cjs calculate rosie-jim-battered-chunks-400g 3 piece 104
node scripts/food-catalog.cjs line raspberries-raw 80 g "" 2026-01-01 Snack
```

The calculation is local and has no network or Sheet access. `line` returns a
standard Pulse paste line; it does not append it. Match the product/variant
first, then use supplied weighed grams when available. `calculate` outputs
the final numeric values (rounded to two decimal places); do not substitute
macro numbers from earlier food logs for exact catalog matches. If a food isn't
listed, use the existing manual or paste flow. Never invent a unit weight.

The browser appends a calculation snapshot through the existing `logFood`
action (same row fields and `source: "manual"` as Quick add). Nothing is recomputed from the
catalog when reading history. There is no backfill or schema change. Keep IDs
stable for the same product identity; create a separate ID for a new variant.
This does not depend on the Food Tools v2 draft (#6), install its backend, or
replace its proposed server-side products/recipes. Reconcile the Food screen
changes if continuing that draft.

## Food API for agents

`backend/food-agent.gs` adds three actions to the Apps Script web app so an
assistant can log food safely: `saveFoods` (a batch with stable IDs; repeating a
request never duplicates rows), `updateFoods` (correct rows by ID) and `foodDay`
(one day's rows and totals). See [AGENTS.md](AGENTS.md) for the request format.
`npm run test:unit` checks the module against an in-memory Food tab.
