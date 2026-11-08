# Pulse

A single-file training and food log, published with GitHub Pages.

## Regression checks

```sh
npm ci
npx playwright install chromium
npm test
```

For date-only checks without a browser, run `npm run test:unit`.
Use `CHROMIUM_PATH` to select a system Chromium executable, and optionally set
`SCREENSHOT_DIR` to save screenshots from the browser checks.

The tests use fictitious records and intercept every request. They never read or
change live Sheet data. Coverage includes local-date/week boundaries, future-dated
history, menu keyboard navigation and dismissal, move/skip/undo, draft persistence,
contrast, touch targets, and mobile/desktop layouts. GitHub Actions runs the same
checks for pull requests and main-branch updates.
