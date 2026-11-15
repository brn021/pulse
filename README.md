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

## Food tools v2 (draft, not deployed)

Quantity/date editing, reusable products and recipe yields, completed-day weekly
averages and dated shared targets are gated on the backend's explicit `foodV2`
capability. Existing logs and actions remain available against the current backend.
No estimation badge was added. Weekly nutrient averages exclude days with missing
values instead of treating missing macros as zero.

See [backend integration instructions](backend/README.md). The existing Apps Script
source is **not in this repository**: review and integrate with its existing routes,
locking, authentication and snapshot reads before enabling this capability. This
addon is not a replacement backend. Do not enable the flag or deploy only the UI
and consider the features complete.

`npm run test:unit` includes an in-memory frontend/backend integration suite. All
fixtures are artificial; no live Sheet access. `npm test` also runs the browser
flows at 320, 390 and 1280 px. Browser execution must pass in CI before release.
