# Monty

**Monte Carlo for estimation.** A small, self-contained tool for forecasting
software delivery dates from team-sized estimates.

## What it does

You list your work items, give each one a T-shirt size and an uncertainty
score, set how many people are working on it, and Monty runs thousands of
simulated schedules to produce a range of plausible end dates - not a single
date that's almost certainly wrong.

Outputs include:

- Headline P50 / P80 / P90 dates for the whole programme and each release
- A Gantt chart showing every item's likely schedule with confidence ranges
- A distribution chart showing how end dates cluster across all simulations
- Per-item details, drag-to-reorder priority, customisable working calendar

The model is grounded in established estimation research: McConnell's
Cone of Uncertainty for the uncertainty profiles, asymmetric triangular
distributions to reflect optimism bias, and a power-law parallelism efficiency
to model coordination overhead (Brooks's law) without going off a cliff.

## Try it

Open `monty.html` in any modern browser. That's it - no install, no build, no
backend. State persists in your browser's localStorage between visits.

```
# clone, then:
open monty.html        # macOS
xdg-open monty.html    # Linux
start monty.html       # Windows
```

Or [host it on GitHub Pages](https://docs.github.com/en/pages) with one click
and share a URL with your team.

## How it works

Click the **"What is Monty and how does it work?"** panel at the top of the
page. It explains percentiles, Monte Carlo simulation, the duration model,
parallelism, and how to read the charts - written for someone who's never
seen this approach before.

For more depth on the design and roadmap, see [MONTY-ROADMAP.md](./MONTY-ROADMAP.md).

## A note on storage

Monty stores your scenario in your browser's localStorage, attached to the
specific file location. **If you rename or move `monty.html`, you'll get fresh
empty state** because localStorage is keyed by file path on `file://`. To
move state between file copies, use the JSON export/import buttons in the
Advanced section.

## Project structure

Single HTML file. All CSS and JavaScript inline. No external runtime
dependencies (Google Fonts is loaded from CDN; the file works without it,
just with system fonts).

The JavaScript is wrapped in an IIFE with twelve `// MODULE:` blocks for
clarity. The only public global is `window.Monty`, which exposes:

```js
window.Monty.run()       // trigger a simulation
window.Monty.render()    // re-render UI from current state
window.Monty.state       // read-mostly access to current scenario
window.Monty.config      // all defaults, presets, constants
```

Open the file in any editor and search for `MODULE:` to navigate. See
[MONTY-ROADMAP.md](./MONTY-ROADMAP.md) for the module map and planned changes.

## Roadmap

Three features are planned and specified in [MONTY-ROADMAP.md](./MONTY-ROADMAP.md):

1. **Stakeholder snapshot export** - one-click read-only HTML export
2. **Actuals capture** - track real delivery vs estimate; calibration metrics
3. **Forecast history** - snapshots over time with reasons; trajectory chart

If you'd like to contribute, the roadmap doc has implementation-level detail.

## Licence

MIT.
