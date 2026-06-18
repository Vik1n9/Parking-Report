# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a static web app for converting parking lot status data into formatted reports. It targets security personnel and control-room staff at a specific facility in Taiwan.

Primary entrypoints:

1. `index.html` — control-room collection page for voice broadcast script (中控回報) and Excel Tab-separated values
2. `guard.html` — mobile-only guard reporting page with an on-page numeric keypad and LINE share/copy actions
3. `parking-core.js` — shared parking labels, parsing, formatting, LINE report, control report, Excel values, and tower usage helpers

There is no build system, no package manager, and no external dependencies. Open the HTML files directly in a browser.

## Development

Open `index.html` or `guard.html` directly in a browser — no server needed. All changes are immediately testable by refreshing the page.

Tests can be run with:

```bash
node parking-core.test.js
node guard-ui.test.js
```

## Architecture

Shared report-formatting logic lives in `parking-core.js`. The data flow is:

```
User input (textarea OR quick-field inputs)
  → parseText(str) → tokens[]  (length 10, one per zone)
    → zoneInfo(i, raw)      → zone status cards
    → buildControlReport(tokens, t) → voice broadcast text
    → buildLineReport(tokens, t)    → LINE group text
    → buildExcelValues(tokens)      → tab-separated Excel row values
```

### Core constants (hardcoded — changing these affects all output)

| Constant | Value | Purpose |
|---|---|---|
| `LABELS` | 10-element array | Zone names in fixed column order |
| `ALIAS_MAP` | `{A:"紡A", B:"紡B", …, R:"柏油路"}` | Shorthand letter aliases accepted in input |
| `IS_CAR[i]` | `[true,true,false,…]` | Whether a zone reports remaining parking spaces (`true`) vs. occupancy percentage (`false`) |
| `TOWER_TOTAL` | `1600` | Total tower capacity for utilization calculation |
| `STORAGE_KEY` | `"parking_history_v2"` | `localStorage` key for history |
| `MAX_HISTORY` | `40` | Maximum history entries retained |

Guard page history uses a separate `localStorage` key: `"parking_guard_history_v1"`.

### Input value encoding

| Input value | Meaning |
|---|---|
| Integer (e.g. `423`) | Remaining spaces (IS_CAR zones) or tenths availability (非IS_CAR) |
| `8` (in non-IS_CAR zone) | 8-tenths available |
| `0.1`–`0.9` | 1–9 cars present (counter-intuitive: slice after `.` gives car count) |
| `0` | Full / no spaces |
| `x` | Zone not in use |
| `key=value` | Named assignment, key can be full label or alias |

### Parsing modes

`parseText()` splits tokens on whitespace. Tokens containing `=` go into `pairs` (named); the rest go into `plains` (positional, mapped by index to `LABELS`). Both can be mixed freely.

### Two input surfaces — kept in sync

- **Text area** (`#dataInput`): primary input, triggers `updateAll('text')`, which calls `syncTextToQf(tokens)` to mirror values into the quick-field inputs.
- **Quick-field inputs** (`#qf0`–`#qf9`): one per zone, trigger `syncQfToText()` which writes back to the text area, then `updateAll('qf')`.

### History persistence

History is stored in `localStorage` under `STORAGE_KEY`. `addHistoryEntry()` is called on every `updateAll()`. Duplicate consecutive inputs are skipped. The history card is rendered dynamically by `renderHistoryList()` into `#historyCardContainer`.

### Responsive layout

- Desktop (≥761 px): two-column grid; Excel shown as `<table>`; copy buttons inline.
- Mobile (≤760 px): single column; Excel shown as `#excelList` (vertical list); copy buttons in a fixed sticky bar.
- Very narrow (≤420 px): quick-field grid collapses to 2 columns.

### Tower utilization card

`buildTowerPctCard(tokens)` uses `tokens[0]` (一樓以上) and `tokens[1]` (一樓以下) to compute `(TOWER_TOTAL − remaining) / TOWER_TOTAL`. It is injected at index 2 of the zone grid (`zoneCards.splice(2, 0, towerCard)`), spanning full width.

## Known Limitations (documented in README)

- Zone names and field order are hardcoded; adding/removing zones requires careful edits to `LABELS`, `IS_CAR`, `ALIAS_MAP`, and any hardcoded indices (e.g. `tokens[0]`, `tokens[1]` in the tower calculation).
- The `0.1`–`0.9` car-count encoding is unintuitive by design (avoids parser conflicts with integer values).
- No input validation UI; unexpected values silently fall through to the default branch of `zoneInfo()`.
- No data persistence beyond `localStorage`; clearing browser storage loses all history.
