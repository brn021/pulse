# Pulse for agents

Instructions for assistants that log data for Bruno (JayDee, Claude, scripts).
The Google Sheet **PULSE DB** is the source of truth. The Pulse app only reads and
writes it through the Apps Script web app.

## Logging food

Use the web app, not direct Sheet edits. Its address is `API_URL` at the top of
`index.html`. Send every request as a POST with the header
`Content-Type: text/plain;charset=utf-8` and a JSON body. The reply is JSON.

### Add foods: `saveFoods`

```json
{
  "action": "saveFoods",
  "source": "JayDee",
  "entries": [
    {"id": "20261122-food-ovos-mexidos", "date": "2026-11-22", "time": "08:30", "meal": "Breakfast",
     "item": "Ovos mexidos: 2 ovos (100 g)", "kcal": 143, "protein": 12.6, "carbs": 0.7, "fat": 9.5},
    {"id": "20261122-food-pao-promise-40g", "date": "2026-11-22", "time": "08:30", "meal": "Breakfast",
     "item": "Pão sem glúten Promise: 1 fatia de 40 g (rótulo)", "kcal": 90, "protein": 0.84, "carbs": 16.4, "fat": 1.2}
  ]
}
```

- Up to 100 foods per request. All of them are checked before anything is written:
  one invalid food means nothing is saved (`"saved": false`).
- `id`, `date`, `meal`, `item` and `kcal` are required. `time`, `protein`, `carbs`,
  `fat` and `source` are optional. `source` on the request is used for every food
  that does not carry its own.
- Each food comes back with a status:
  - `added`: a new row was written.
  - `unchanged`: this ID is already saved with exactly these values. This is the
    normal result when you repeat a request.
  - `conflict`: this ID is already saved with different values. Nothing was changed
    for it. The reply includes `current` (what the Sheet holds). Use `updateFoods`
    if it is a correction, or a new ID if it is a different food.
- `ok` is `true` only when every food is now in the Sheet exactly as sent.
  The server reads the tab again after writing, so `confirmed: true` on each result
  means it was checked. `days` gives the totals for each date in the request.

### Correct foods: `updateFoods`

```json
{"action": "updateFoods", "entries": [
  {"id": "20261110-food-jantar-ribeye-227g", "item": "Ribeye: 250 g cru (rótulo)", "kcal": 633, "protein": 47, "fat": 49.4}
]}
```

Send the ID and only the fields that change. To clear an optional field
(`time`, `protein`, `carbs`, `fat`, `source`), send `null`. The row stays in place
and the ID never changes. Statuses: `updated` (the reply includes `before`),
`unchanged` or `not_found`.

### Read a day: `foodDay`

```json
{"action": "foodDay", "date": "2026-11-22"}
```

Returns that day's `entries` in time order and its `totals`.

### Rules

- **IDs:** one stable ID per food eaten, `YYYYMMDD-food-<short-slug>`. Use lowercase
  letters, digits and dashes. Keep the same ID when retrying or correcting. A second
  portion of the same food on the same day is a new food, so add `-2`.
- **Retrying:** if the connection drops or no reply arrives, send the *same* request
  again with the *same* IDs. Saved foods come back `unchanged`, missing ones `added`.
  Never invent new IDs to retry.
- **Meals:** `Breakfast`, `Lunch`, `Snack` or `Dinner`. Any other label (for example
  `Outros`) is saved, but the app shows it as a separate group after the four meals.
- **Date and time:** the day Bruno ate it, in Europe/Dublin. `time` is `HH:mm`
  (24-hour) when known.
- **Numbers:** grams and kcal for the portion eaten, at most 2 decimals. Use the
  label when there is one, and say "rótulo" or "estimativa" in `item`.
- **Text:** `item`, `meal` and `source` cannot start with `=`, `+`, `-` or `@`.
- **Deleting:** only when Bruno asks: `{"action": "deleteFood", "id": "<EntryID>"}`.
- **Food catalog:** for foods in `food-catalog-v1.js`, use
  `node scripts/food-catalog.cjs` to calculate the values (see README).

### Errors

| Reply | Meaning | What to do |
|---|---|---|
| `"ok": false, "saved": false` | The request was rejected before writing | Fix the field named in `error` and send again |
| `"ok": false` with `note` | Something failed after some rows were written | Send the same request again |
| `"error": "busy: …"` | Another save was running | Wait a few seconds and send the same request |
| `status: "conflict"` | The ID holds different values | Read `current`, then update or use a new ID |

## Other data

Workouts, weight and sleep are logged in the Pulse app. The Food tab columns are
`EntryID | Date | Time | Meal | Item | Kcal | Protein_g | Carbs_g | Fat_g | Source`.
Do not rename them or add rows to other tabs.
