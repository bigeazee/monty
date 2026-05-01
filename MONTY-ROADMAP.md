# Monty - Roadmap & Implementation Notes

This document captures the next planned features for Monty, along with enough
design context that work can resume after a long break, in a different tool, or
by a different person without losing intent.

The current state of the app is **a single HTML file (~135 KB)** with all
styles and JavaScript inline, persisting state in `window.localStorage`. The
constraint going forward is: **it must continue to work by opening one HTML
file, with no build step or runtime dependencies**. Future refactors away from
the single-file architecture remain on the table, but are deliberately deferred.

---

## Current architecture

- **Single HTML file** containing inline CSS and JS, wrapped in an IIFE
- **State storage**: `window.localStorage` under key `monty_state_v1`
- **No external runtime dependencies** beyond Google Fonts (Nunito Sans, JetBrains Mono)
- **Charts**: hand-rolled inline SVG, no charting library
- **Drag-and-drop**: native HTML5, no library
- **Imports/exports**: CSV (items) and JSON (full state)
- **Single global**: `window.Monty` (everything else is private to the IIFE)

---

## Code structure (current)

The JS is wrapped in a single outer IIFE and uses `'use strict'`. All
module-level functions, constants, and `state` are private to the IIFE.
The only public surface is `window.Monty`:

```js
window.Monty = {
  run: runForecast,    // trigger a Monte Carlo simulation
  render: render,      // re-render all UI from current state
  state: state,        // read-mostly; do not mutate from outside
  config: MONTY_CONFIG // all defaults, presets, constants
};
```

When new features are added (snapshot export, history, actuals), expose
their entry points through `window.Monty` rather than reaching into the IIFE.

### Module map

The script is divided into 12 module blocks, each prefixed with a
standardised header comment listing what it reads from / writes to
external state. Order down the file:

1. **MODULE: config** — `MONTY_CONFIG` (single source of truth for all
   defaults, presets, constants). All other modules reference into it
   via short aliases like `SIZES`, `WORKING_DAYS_PER_WEEK`, `STATE_KEY`.
2. **MODULE: profile-helpers** — `isProfileSymmetric`, `profilesEqual`,
   `getCurrentPresetName`. Pure utilities.
3. **MODULE: state** — the `state` object itself.
4. **MODULE: persistence** — `saveState`, `loadState`. Schema migrations
   live here. External dep: `window.storage` (Anthropic Artifacts storage API).
5. **MODULE: csv** — `parseCSV`, `importCSV`, plus version normalisers.
6. **MODULE: sampling** — `sampleTriangular`, `sampleUniform`,
   `sampleEffort`, `resolvePeopleNeeded`. Pure functions.
7. **MODULE: calendar** — `isWeekend`, `isWorkingDay`,
   `buildWorkingCalendar`, `workingIdxToCalDays`, `formatDate`.
8. **MODULE: simulation** — `scheduleOnce`, `pct`, `monteCarlo`. The
   Monte Carlo engine.
9. **MODULE: rendering (controls, items, duration model)** — `renderControls`,
   `renderItems`, `renderDurationModel` (and helpers: bases, profile, ranges,
   parallelism, model intro, profile warning).
10. **MODULE: rendering (results, gantt, histogram, version cards)** —
    `renderResults`, `renderGantt`, `renderHistogram`, `renderItemTable`,
    `renderVersionsBlock`, `attachGanttTooltip`. Plus small utilities
    (`escapeHtml`, `escapeXml`, `uncertaintyPill`).
11. **MODULE: events** — `attachHandlers`. Wires DOM events to state mutations.
12. **MODULE: app (orchestration)** — `runForecast`, `render`, `init`. Plus
    the `window.Monty` exposure and the boot sequence.

### Single source of truth: `MONTY_CONFIG`

All defaults, presets, and tunable constants live in one object:

```js
const MONTY_CONFIG = {
  workingDaysPerWeek: 5,
  sizes: ["XS","S","M","L","XL"],
  uncertainties: ["Low","Medium","High"],
  defaults: {
    items: [],
    bases: { XS: 2.5, S: 5, M: 15, L: 25, XL: 50 },  // person-days
    params: { headcount: 4, peoplePerJob: 2, /*...*/ },
    holidays: [ /* ... */ ],
  },
  profiles: {
    asymmetric: { /* McConnell cone */ },
    symmetric:  { /* equal-spread fallback */ },
  },
  storageKeys: {
    state: "monty_state_v1",
    // history: "monty_history_v1",  // future: feature 2
    // actuals: "monty_actuals_v1",  // future: feature 3
  },
  schemaVersions: { state: 3 },
};
```

Short aliases (`SIZES`, `DEFAULT_BASES`, etc) are bound just below
`MONTY_CONFIG` and used throughout for readability. When `MONTY_CONFIG`
is eventually extracted to its own file (likely the first split when
the file outgrows a single-file architecture), the aliases can either
be re-imported or replaced with full `MONTY_CONFIG.foo.bar` references.

### Adding new modules

When a new feature lands:

1. Add a new `// MODULE: feature-name` block with the standardised
   read/write contract header.
2. If it has its own storage, add a key to `MONTY_CONFIG.storageKeys`
   and a schema version to `MONTY_CONFIG.schemaVersions`.
3. Expose its entry points on `window.Monty`.
4. Update this document's module map to keep it accurate.

---

## Storage notes (read this before touching state)

`window.localStorage` characteristics worth knowing:

- **Persists across hard refreshes**, browser restarts, and crashes. That's its job.
- **Survives indefinitely on `file://` URLs** (Safari's 7-day eviction policy
  applies only to served URLs).
- **Wiped by**: user clearing site data, uninstalling the browser, or
  incognito/private mode windows closing.
- **Capacity**: typically 5-10 MB per origin. Snapshots at ~2 KB each give
  thousands of snapshots before this is a concern.

**The one significant gotcha**: localStorage is keyed by file path on `file://`.
So if a user renames `Monty.html` to `Monty-v2.html` they get fresh empty state.
This is one of the strongest arguments for keeping JSON export/import polished -
it's the only safe migration path between file copies.

**Storage adapter**: `saveState` and `loadState` go through a small
`storageAdapter` shim defined at the top of the persistence module. The shim
prefers `window.storage` (the Anthropic Artifacts async key/value API) when
present, and falls back transparently to native `localStorage`. Both paths
expose the same async surface, so callers don't need to branch. This means
the file works in three deployment modes without code changes: opened from
`file://`, served from a static web host (e.g. GitHub Pages), or hosted in
the Anthropic Artifacts environment.

**Document this in the user-facing UI** (currently it's not mentioned anywhere).
Add a short note in the Advanced section: "State is stored in your browser
attached to this exact file. If you rename or move the file, export your state
as JSON first."

**Schema versioning**: The state object includes a `schemaVersion` field. Bumps
happen when the shape of stored data changes. Migration logic lives in
`loadState`. The current state schema is **v3**:

- v1 (legacy): had a `matrix` of duration ranges (now superseded by `bases` +
  `uncertaintyProfile`). Loaded values are silently discarded.
- v2: introduced `bases` and `uncertaintyProfile`. Bases were briefly stored as
  person-weeks and then reverted to person-days. There was a buggy migration
  attempting to convert these; it was removed.
- v3 (current): `bases` stored in **person-days** internally, displayed as
  **weeks** in the UI (renderBases divides by 5 on display, multiplies by 5 on
  input).

When adding feature 2/3, use **separate storage keys** rather than extending the
state object - see "Storage location for new features" in each feature below.

---

## Feature 1: Stakeholder snapshot export

A "Export for stakeholder" button that produces a single self-contained HTML
file. Stakeholders open it, see the forecast, can interact with all the
visualisations (tooltips, expand/collapse explainer, hover bars and milestones)
but cannot rerun, edit inputs, or change anything.

### What gets shown / hidden in review mode

| Section | Show? | Editable? |
|---|---|---|
| Header / wordmark | Yes | n/a |
| "What is Monty" explainer | Yes | n/a (already collapsible) |
| Quickstart (CSV import) | **Hidden** | n/a |
| Controls (start date, headcount, etc) | **Partial** - show team size, sims, distribution as readonly text | No |
| Results (headline cards, version cards) | Yes | n/a |
| Gantt with tooltips and milestones | Yes | n/a (interaction = hover only) |
| Distribution chart | Yes | n/a |
| Per-item table | Yes | n/a |
| Items input table | Yes, **read-only** (no drag handles, no edits, no delete buttons) | No |
| Duration model section | Yes, **read-only** (greyed inputs) | No |
| Advanced (export/reset) | **Hidden** | n/a |
| Footer | Yes | n/a |

### Snapshot banner

A prominent banner at the top of the page (just below header, above explainer):

```
┌─────────────────────────────────────────────────────────────┐
│ 📌 Snapshot · "Q2 readout for NHSE"                          │
│ Built by Edwin Clark · 30 Apr 2026 at 14:32 · Read only     │
└─────────────────────────────────────────────────────────────┘
```

Teal-tinted background, similar to the priority hint banner.

### Export flow

1. User clicks "Export for stakeholder" (new button, perhaps near "Export state JSON")
2. Modal asks for two fields:
   - **Title** (required) - what this snapshot represents
   - **Author** (defaults to "Edwin Clark", editable)
3. On confirm, Monty:
   a. Ensures `state.results` is populated (runs the forecast if not - or refuses if no items)
   b. Captures the current full state + results as a JSON object
   c. Reads its own HTML via `document.documentElement.outerHTML`
   d. Embeds the JSON as a base64-encoded string in a `<script>` tag with id `monty-snapshot-data`
   e. Triggers download as `monty-snapshot-YYYY-MM-DD-{slugified-title}.html`

### Detection on load

At app start, check for `document.getElementById('monty-snapshot-data')`. If
present:

- Set a global flag `IS_SNAPSHOT = true`
- Decode and parse the embedded JSON, populate `state` from it
- Render normally, then apply review-mode CSS class to `<body>`
- Suppress all event handlers that mutate state (or wrap them in
  `if (!IS_SNAPSHOT)`)
- Render the banner with title/author/timestamp from the snapshot data

### Implementation notes

- The embedded JSON includes the **already-computed `state.results`** -
  stakeholders never re-run the simulation. The numbers are frozen.
- Inline SVG, fonts (CDN), and all logic survive the duplication. The HTML is
  fully self-contained.
- File size: original ~130 KB + state JSON (typically 50-200 KB depending on
  simCount × items, since `r.overall.all` contains every simulated end time).
  Consider stripping `r.overall.all` from the embedded snapshot - the
  histogram only needs the binned counts. This saves significant size.
  - **Decision needed**: strip the raw simulation array, or keep it so the
    histogram retains full fidelity? Recommend stripping and pre-binning the
    histogram to ~24 bins as part of snapshot creation.
- Test on `file://` opening, not just via dev server, since that's how
  stakeholders will use it.

### CSS for review mode

```css
body.review-mode .controls,
body.review-mode #quickstart-section,
body.review-mode #advanced-section,
body.review-mode .priority-hint,
body.review-mode .actions,
body.review-mode .delete-btn,
body.review-mode .drag-handle .drag-grip {
  display: none !important;
}
body.review-mode input,
body.review-mode select {
  pointer-events: none;
  background: var(--surface-2);
  color: var(--ink-2);
}
body.review-mode .controls-summary {
  /* the "show team size, sims, distribution as readonly text" replacement */
  display: flex;
  gap: 24px;
  padding: 12px 16px;
  background: var(--surface-2);
  border-radius: 4px;
}
```

---

## Feature 2: Forecast history with reasons

Manual snapshots tied to meaningful planning events, with a chart showing how
the forecast has moved over time and a free-text reason for each change.

### Storage location

**New localStorage key**: `monty_history_v1`. Separate from main state for three reasons:

- Main state is hot (written on every keystroke); history is cold (written on
  manual snapshot). Different write patterns, separate keys.
- Separate keys mean separate export/import paths. Sharing current state with a
  colleague shouldn't drag along your full history.
- Schema migrations stay isolated.

Schema:

```js
{
  schemaVersion: 1,
  snapshots: [
    {
      id: 'snap_2026_03_15_a',         // ISO date + suffix
      timestamp: '2026-03-15T14:32:00Z',
      label: 'Sprint 4 planning',       // short
      reason: 'Refined L items after spike on Multiple Uploads',  // long-form, optional
      author: 'Edwin Clark',
      state: { /* full snapshot of state.items, .bases, .uncertaintyProfile, .params */ },
      results: { /* condensed: just overall {p50, p80, p90}, versions, items[].end */ },
    },
    // ...
  ],
}
```

### UI

A new section "History" sits between Results and Items:

- **Trajectory chart** (small inline SVG): x-axis = snapshot timestamps,
  y-axis = end date. Three lines: P50 (Slate), P80 (Teal), P90 (Coral).
  Per-version trajectories available via a dropdown filter.
- **Snapshot timeline**: vertical list of snapshots with their label, date,
  reason. Each row clickable.
- **"Save snapshot" button** in the Results section header (next to or
  replacing the existing run button workflow).

### Save flow

1. User clicks "Save snapshot"
2. Modal asks for `label` (required, ~40 char) and `reason` (optional, free text)
3. On save: run forecast if needed, package state + results, push to
   `history.snapshots`, save to localStorage, render the trajectory chart and
   timeline.

### Load flow

Click any snapshot in the timeline. Banner appears: "Viewing snapshot from 15 Mar
2026 - 'Sprint 4 planning'. [Return to current]". Loading a snapshot doesn't
overwrite the live state - it shows the snapshot's state in a read-only
preview mode, similar to feature 1's review mode but in-app.

### Diff view

Clicking two snapshots gives a diff. Show:

- Items added / removed / reordered
- Items where size, uncertainty, or people changed
- Bases or profile changes
- P50/P80/P90 deltas overall and per version

### Trajectory chart specifics

- Use the same colour palette as the headline cards (Slate / Teal / Coral)
- Mark each snapshot with a dot, connected by lines
- Tooltip on hover shows label, reason, and the percentile values
- Vertical "today" marker for orientation

### Implementation order

1. localStorage schema + save/load wiring
2. Save snapshot modal
3. Timeline list rendering
4. Trajectory chart
5. View-snapshot mode
6. Diff view (least urgent, can be a v2)

---

## Feature 3: Actuals capture and accuracy assessment

Per-item actual delivery data, used to compute calibration metrics and suggest
empirically-grounded base values.

### Storage location

**New localStorage key**: `monty_actuals_v1`. Reasoning same as feature 2 -
separate write pattern, separate export, isolated migrations.

Schema:

```js
{
  schemaVersion: 1,
  actuals: [
    {
      itemKey: 'auto_release_notes_2026_01',   // user-defined or generated; tracks identity across estimate revisions
      itemName: 'Automatically generate release notes',
      version: '1.0',
      size: 'L',                          // estimated size at close
      uncertainty: 'High',                 // estimated uncertainty at close
      peopleAssignedAtEstimate: 2,         // what we'd estimated
      // Captured fields:
      actualDurationDays: 18,              // working days from start to ship
      actualEffortPersonDays: 32,          // total person-days actually spent
      actualPeople: 2,                     // (often same as estimate, but can differ)
      startDate: '2026-01-08',
      endDate: '2026-02-02',
      closedDate: '2026-02-03',
      notes: 'Lake formation complications added 5d',
    },
    // ...
  ],
}
```

### Why capture both duration and effort

- **Duration alone** doesn't tell you whether the estimate was wrong. If an L
  item took 18d and you'd estimated 14d, was the estimate bad, or did you have
  fewer people on it than planned?
- **Effort alone** doesn't capture the parallelism dynamics.
- **Both together** let you derive the *implied parallelism efficiency* (the
  α value Brooks's law captures): `α_implied = log(estimated_effort/actual_duration) / log(actual_people)`.
  Reveals whether your team's actual α is closer to 0.5 or 0.85.

If only one can realistically be captured, prioritise **effort in person-days**
since duration can usually be inferred from start/end dates.

### UI

#### 1. Capture - new column on items table

Items get a new "Actual" column with a status indicator:

- **Open** (default): no actuals captured. Subtle grey dot.
- **In progress**: start date set but not closed. Yellow dot.
- **Closed**: all actuals captured. Green dot. Greys out the row's editable inputs (since the estimate is now historical).

Click the dot to open a modal with fields: start date, end date, actual
person-days of effort, actual people, notes. "Mark closed" button confirms.

#### 2. Calibration table

A new section "Calibration" sits in or below Results when there are at least 5
closed items. Renders a 5×3 grid (one cell per size × uncertainty combination):

```
              Low           Medium          High
   ┌──────────────────────────────────────────────────────┐
XS │  est: 0.5d   │  est: 1d     │  est: 2.5d            │
   │  act: 0.6d   │  act: 1.4d   │  -- no data --        │
   │  +20% (n=3)  │  +40% (n=2)  │                       │
   ├──────────────────────────────────────────────────────┤
S  │ ...          │ ...          │ ...                   │
```

Cells with consistent over-estimation by >30% highlighted yellow; cells with
under-estimation by >50% highlighted red. Click a cell to see the underlying
items.

A button: "Suggest new bases from actuals" - runs least-squares regression on
the closed items to recommend new base values per size, ignoring uncertainty
multipliers (since those are about distribution shape, not central tendency).

#### 3. Calibration curve

Line chart: x-axis = predicted percentile (10, 20, ..., 90), y-axis = empirical
hit rate (% of closed items that finished by their P-x date). A 45° reference
line shows perfect calibration. Bowed below the line = overconfident; above =
underconfident.

Requires at least ~20 closed items to be statistically meaningful. Show a "need
more data" message below this threshold.

#### 4. Per-size accuracy histogram

For each size, a small histogram of `actual_effort / estimated_mean_effort`
ratios. Reveals whether some sizes are systematically miscalibrated.

### Frameworks and methods (background reading)

Listed with priority for what to actually implement:

#### Implement (in priority order)

1. **MMRE (Mean Magnitude of Relative Error)** - the classic estimation
   accuracy metric: `mean(|actual - estimated| / actual)`. Track per-size and
   per-uncertainty cell. Cells with MMRE > 0.4 are flagging miscalibration.
   This is what powers the calibration table.

2. **Calibration curve / hit rate** - what % of items finished by their P50?
   P80? P90? Tetlock-style calibration assessment. This is what powers the
   calibration curve view.

3. **Bias decomposition** - split error into bias (mean signed error;
   systematic over/under-estimation) and noise (standard deviation of error).
   High bias = recalibrate bases. High noise = team isn't aligned on what
   sizes mean. Show as two numbers per size cell.

#### Background concepts (don't necessarily build, but understand)

4. **Reference-class forecasting** (Kahneman, Flyvbjerg) - the philosophical
   underpinning. Instead of estimating from first principles, anchor on how
   long similar items have *actually* taken. With enough actuals, Monty's
   "size selector" could secondary-display "your last 5 L items took: 18d, 22d,
   41d, 16d, 28d" inline. Reveals when the estimate is contradicting evidence.

5. **CRPS (Continuous Ranked Probability Score)** - a proper scoring rule for
   probabilistic forecasts. Rigorous but mathematically dense. Probably overkill
   for v1 but worth knowing about as a north star metric for "is Monty getting
   better at predicting?"

6. **Brier score** - simpler version of CRPS for binary outcomes (did we hit
   the P80 date or not?). Could be useful as a single dashboard number tracking
   forecast skill over time.

### Implementation order

1. Storage schema + save/load wiring
2. New "Actual" column on items table with status dot
3. Capture modal
4. Calibration table (most actionable)
5. Per-size accuracy histogram
6. Calibration curve (needs ~20 items first)
7. "Suggest new bases" button

---

## Recommended sequencing

If approaching this fresh:

1. ~~**Structural prep** - module markers, IIFE, MONTY_CONFIG~~ **Done.** See "Code structure" above for the resulting layout.
2. **Feature 1: stakeholder export** - well-scoped, immediately useful, pressure-tests the snapshot mechanism that 2 and 3 will reuse. ~1 day.
3. **Feature 3: actuals capture** - the highest-value feature long term. Schema and capture flow first, calibration views progressively. ~3-5 days for full version.
4. **Feature 2: history** - with actuals in place, history becomes "snapshots tied to learning events" rather than "every run we ever did", which is more signal. ~2-3 days.

Counter-intuitive ordering note: feature 3 before feature 2. Reasoning - actuals
are an active learning loop; history is a passive log. Once actuals are in
place, the change log from feature 2 falls out naturally ("we adjusted M base
from 3 to 4 weeks because actuals showed +30% bias" becomes a snapshot-with-reason).

---

## Open design questions deferred to implementation time

These don't need answers now but should be revisited when the relevant feature
is being built:

- **Feature 1**: Strip `r.overall.all` from snapshots and pre-bin? (Recommend yes)
- **Feature 1**: Should the snapshot HTML embed Google Fonts directly (rather
  than via CDN) for offline use? Adds ~50 KB but ensures snapshots work
  air-gapped.
- **Feature 2**: Should snapshots auto-include the active item set as a CSV
  attachment, so they can be loaded back even if the JSON schema migrates later?
- **Feature 2**: Diff between snapshots - text-only, or visual side-by-side
  Gantt comparison? Visual is much more work but much more useful.
- **Feature 3**: How to handle items where size/uncertainty changed mid-flight?
  The calibration table currently assumes the estimate at-close is the
  estimate-of-record. Pre-revision estimates would need their own snapshot
  capture (which is feature 2's domain). May want feature 2's snapshot history
  to *also* track per-item estimate changes separately.
- **Feature 3**: Effort logging is hard for teams that don't track time.
  Consider a "rough" mode where effort is inferred as `duration × people` if
  not captured directly.

---

## Things to NOT change without thought

These are deliberate decisions made over the course of development. Document
your reasoning if you change them.

1. **Bases stored in person-days internally**, displayed as weeks. The
   double-conversion bug that caused this took an embarrassing number of turns
   to find. The internal unit and the display unit are intentionally separate.

2. **Uncertainty profile is symmetric in storage**, never asymmetric in storage.
   The asymmetry is encoded as multipliers; the mode is always 1.0. Don't add
   asymmetry by storing different mode values.

3. **localStorage key is `monty_state_v1`.** Renaming this key in future will
   wipe all users' saved state. If a future schema change forces a key change,
   plan a migration window: read the old key and write the new one for at
   least one release before retiring the old.

4. **Power-law parallelism uses Math.pow, not a piecewise function.** The
   smooth monotonic curve is intentional. A "Brooks's law" implementation with
   communication overhead growing as O(n²) would create a U-shape (more people
   = slower past some point), which is true in extremis but confuses the UI.
   Skip it.

5. **Triangular sampler is the default.** Uniform exists as a "no information"
   alternative. PERT/Beta distributions were considered and deferred - they'd
   add complexity for marginal benefit.

6. **Distribution chart x-axis is calendar dates**, not working-day indices.
   The conversion is non-linear because of weekends. Don't simplify back.

7. **Items run in priority order (top first), constrained by the people pool.**
   Drag handles let users reprioritise. Don't add automatic dependency edges -
   that's a much bigger model.

---

## Tech debt and known issues

- The `WORKING_DAYS_PER_WEEK = 5` constant is hardcoded. Some teams (4-day weeks,
  non-standard schedules) might want to override. Low priority.

- The histogram chart re-bins the entire `r.overall.all` array on every render.
  Fine for current sim counts but if someone runs 100k sims it'll get slow.
  Cache the binning.

- Some explainer copy still describes hypothetical UI ("the headline cards
  show...") rather than referencing actual elements. Consider linking explainer
  paragraphs to specific UI sections via anchors.

- `escapeHtml` and `escapeXml` are similar but not identical. Could be unified.

---

## Visual / brand notes

The palette pairs a confident mid-blue with a dark slate for primary text,
plus a magenta-pink reserved for risk/critical signal. Chosen to feel
professional and trustworthy without being corporate or alarming. CSS custom
properties live in `:root` and can be tuned centrally.

- **Brand blue** `#005eb8` — primary actions, P80 percentile, accent throughout
- **Blue deep** `#003d7a` — hover/pressed states
- **Blue soft** `#cce4f3` — fills under chart curves, tinted backgrounds
- **Blue tint** `#e6eef7` — `--surface-3`, used for subtle differentiated areas
- **Dark** `#2b2f3b` — `--ink`, P50 percentile, dark text
- **Pink** `#df007d` — P90 percentile, "high uncertainty" semantic, critical
- **Green** `#26913d` — "today" indicator, positive status
- **Amber** `#ffb300` — warnings (deliberately distinct from the pink)
- **Type**: Nunito Sans (sans), JetBrains Mono (monospace)
- **Logo**: asymmetric triangular distribution curve with three percentile ticks
  on the baseline (P50 dark, P80 blue, P90 pink). Designed to read at small
  sizes; reused in footer at 22px.

The chart-side JS uses constants `C_DARK`, `C_BLUE`, `C_BLUE_SOFT`, `C_PINK`,
`C_GREEN` — names match the brand vocabulary so colour intent is clear at the
call site. (These are duplicated in two locations because chart code is split
between Gantt and histogram; consider unifying when refactoring.)

Hard rule: keep the palette tight. Adding new accent colours dilutes the visual
language. If a new view needs colour-coding, derive from the existing palette
(alpha overlays, light/dark variants of the brand colours).
