# Food v2 backend extension (not deployed)

`food-v2.gs` is an **opt-in module** for the existing Google Apps Script backend.
The currently deployed backend source is **not present in this repository**.
Do not replace it with this file. Review and integrate in a copy of that source,
and validate against a **duplicate spreadsheet with fictional data first**.
The frontend must only enable v2 mutations when GET advertises
`capabilities.foodV2 === true` and `foodV2.version === 1`.

## Integration contract

1. Keep the existing authentication/authorization, spreadsheet selection,
   routing, response format, workout, nutrition, body and Food handlers unchanged.
2. Add this file to the same Apps Script project. For recognized v2 POST actions,
   route **before any outer script lock** to `pulseFoodV2Post(ss, payload)` and
   serialize the returned object with the existing JSON response helper. A `null`
   result means an unrecognized action: use the existing router.
3. In GET, merge the returned keys from `pulseFoodV2Get(ss)` into the existing
   data response without overwriting workout/food/nutrition/body arrays. Invoke
   outside an existing script lock. The module acquires `getScriptLock()` itself.
4. **All legacy writers touching Food must use the same script lock** for their
   whole read/write operation, to prevent races with v2 edits. Do not nest locks.
   GET's legacy Food rows and v2 metadata should be read in the same critical
   section: extract the internal read logic if necessary, or return one complete
   server snapshot under the existing shared lock. Never claim atomic snapshots
   if integration reads these independently.
5. Preserve Date and Time normalization already used by the existing API. This
   module formats Date objects using the spreadsheet timezone. If Time cells are
   Date objects in the actual Sheet, normalize them consistently to `HH:mm` in
   both this module and the existing response before enabling the capability.
6. Deploy only after integration tests and owner authorization. Frontend commit
   and Apps Script deployment are separate; a Pages deployment does not install
   this backend module. No script credentials or personal Sheet IDs belong here.

### GET shape

```js
{
  capabilities: {foodV2: true},
  foodV2: {
    version: 1, revision: 0,
    products: [], recipes: [], targets: [], days: [],
    portions: {} // EntryID -> {quantity, unit}
  }
}
```

All mutations require the `expectedRevision` most recently read by the client.
A mismatch rejects the write with `ok:false`; refresh and re-open the editor.
Success returns `{ok:true, revision:<new revision>}`. A lost response is not
permission to repeat an append with a new ID. Refresh and reconcile existing IDs
first. Reuse the same IDs for safe `logFoodV2` retry.

- `logFoodV2`: `entries` array, each `{id,date,time,meal,item,kcal,protein,carbs,fat,source,quantity?,unit?}`.
  Existing ID with identical normalized content and portion is a no-op; different
  content is rejected. Revisions still advance, and stale revisions are rejected.
- `updateFood`: `id`, `expected:{date,time,meal,item,kcal,protein,carbs,fat,source}`,
  `entry:{date,time,meal,item,kcal,protein,carbs,fat,source,quantity,unit}`.
  Updates the existing row with the same EntryID, never deletes/re-appends it.
- `saveFoodProduct` / `saveFoodRecipe`: `record:{id,name,quantity,unit,kcal,protein,carbs,fat,ingredients?}`.
  A recipe's quantity is its final yield, and macros are for that whole yield.
  Ingredients is an array of `{name,kcal,protein,carbs,fat}` records (up to 100).
  The server recalculates whole-recipe totals from them. Missing macros remain
  unknown rather than being silently treated as zero. There is no external
  nutrition service. Ingredient names can include their portion descriptions.
- `setFoodDay`: `{date,closed,signature}`. Signature must match current Food.
- `setFoodTargets`: `record:{date,kcal,protein,carbs,fat}`. Date is the effective
  date; a new date preserves earlier targets. Saving the same date updates it.

`unit` is a nonempty safe string up to 30 characters, e.g. `g`, `ml`, `portion`,
`bar`. Quantities must be positive;
macros must be finite nonnegative numbers. Optional macros use `null`, not zero.

### Canonical day signature

For food on the selected date, normalize with the existing `foods()` mapping:
null/empty/nonfinite numeric values become `null`; otherwise `Number(value)`.
String fields use their normalized strings. Build arrays:

```js
[id,date,time,meal,item,kcal,protein,carbs,fat,source]
```

Sort by their JSON strings using **plain lexicographic `<` and `>`** (not
localeCompare); JSON.stringify the outer array. This includes time/source and
preserves the distinction between a blank macro and zero. GET returns
`closed:false` if rows change after closing, including manual Sheet edits.
Deleting and re-adding a row changes its ID, so also reopens the day.

## Storage, preservation and limits

Food headers are checked by name. Every required header must exist exactly once.
Existing Food rows, IDs, notes and unrelated columns are preserved. Unrelated
formula cells are re-written as formulas, not their calculated values. Formatting
is not changed. No workouts, nutrition, body or training plan are touched.

Only a dedicated `_PulseFoodV2` sheet is created, **on first successful mutation**,
with a format marker, a manifest in A2, and append-only snapshot chunks (up to
40,000 characters each) below it. Products/recipes, portions, complete status and
dated targets live there, not in fake Food entries. Existing rows are never
backfilled or guessed. Recipe/product edits do not change historical logs.

State JSON is capped at 2,000,000 characters. Each write first appends an immutable
snapshot and then updates the manifest. An interrupted chunk write leaves the old
manifest valid; orphan chunks are ignored. Reads validate chunk count, sequence,
length, revision and checksum, failing closed rather than loading partial data.
A literal `JSON:` prefix on every chunk prevents a split string being interpreted
as a spreadsheet formula. The checksum detects accidental corruption; it is not
a cryptographic authentication mechanism. Old snapshots are retained for recovery.
For long-running use, prune superseded generations only after a verified backup;
no automatic destructive cleanup is performed by this module. Include the whole
`_PulseFoodV2` sheet in backup/export procedures. Do not silently reset metadata on
parse, integrity or version errors.

Sheets does not provide a multi-range transaction. The module validates first,
locks operations, writes the Food row(s), then metadata; on metadata failure it
attempts to restore the original row / clear newly appended cells. A process
termination between writes cannot be rolled back automatically. Treat uncertain
saves as requiring a refresh/reconciliation, not a blind resend. Failures to
restore return an explicit stop-and-inspect error. Test this before deployment.

Formula-like user input is rejected (leading `=`, `+`, `-`, `@`) rather than
executed in cells. Long strings, invalid dates/units/numbers and reserved object
property IDs are rejected. This is input validation, **not authentication**.

## Validation before deployment

Run `node tests/food-v2-backend.cjs` for fixture-only tests. Integration verification
against a copy must additionally confirm:
- legacy log/delete routes use the same lock; duplicate/retry behavior;
- actual headers, IDs, time/date cell types and timezone normalization;
- source/note preservation and adjacent formulas;
- two-device stale revision and stale item conflict handling;
- interrupted write/recovery and permissions failures;
- closing/reopening days and historical targets;
- rollback/restore of the previous Apps Script version.
