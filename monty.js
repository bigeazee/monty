(function () {
  'use strict';

  // ============================================================
  // MODULE: config
  // Single source of truth for all defaults, presets, and constants.
  // No external dependencies; pure data.
  // When this file is eventually split, MONTY_CONFIG is the first
  // module to extract.
  // ============================================================

  const MONTY_CONFIG = {
    // Working days per week. Used to convert between person-weeks
    // (the UI input unit) and person-days (the storage unit). Most
    // teams will leave this at 5; non-standard schedules might tune it.
    workingDaysPerWeek: 5,

    // T-shirt sizes and uncertainty levels, in display order.
    sizes: ["XS", "S", "M", "L", "XL"],
    uncertainties: ["Low", "Medium", "High"],

    // Default scenario the app starts with on first load.
    defaults: {
      // Empty list — user imports CSV or adds rows manually.
      items: [],

      // Base ("most-likely") effort per T-shirt size, in PERSON-DAYS.
      // The bases UI displays and accepts these as weeks (1 week = 5 working days)
      // for easier sizing — conversion happens in renderBases.
      // Week equivalents shown in comments.
      bases: {
        XS: 2.5,   // 0.5 person-weeks
        S:  5,     // 1 person-week
        M:  15,    // 3 person-weeks
        L:  25,    // 5 person-weeks
        XL: 50,    // 10 person-weeks
      },

      params: {
        // startDate is set dynamically (today) at init time, not here
        headcount: 4,
        peoplePerJob: 2,
        distribution: "triangular",
        // Power-law exponent: duration = effort / people^alpha.
        // 1.0 = linear (2 people = half time)
        // 0.75 = moderate diminishing returns (typical software, default)
        // 0.0 = adding people doesn't help at all
        parallelismAlpha: 0.75,
        simCount: 1000,
      },

      // UK bank holidays (England & Wales). Editable in the Advanced section.
      holidays: [
        // 2026
        "2026-01-01","2026-04-03","2026-04-06","2026-05-04","2026-05-25",
        "2026-08-31","2026-12-25","2026-12-28",
        // 2027
        "2027-01-01","2027-03-26","2027-03-29","2027-05-03","2027-05-31",
        "2027-08-30","2027-12-27","2027-12-28",
        // 2028
        "2028-01-03","2028-04-14","2028-04-17","2028-05-01","2028-05-29",
        "2028-08-28","2028-12-25","2028-12-26",
      ],
    },

    // Two preset uncertainty profiles. Users can also stay on "Custom"
    // with their own values. Profile multipliers are applied to the size's
    // base value to produce (min, mode, max) of the duration distribution.
    profiles: {
      // Asymmetric (default): McConnell's Cone of Uncertainty.
      //   - Low    ~ "detailed design"        : ~0.85x to 1.20x  (P10/P90 ratio ~1.4x)
      //   - Medium ~ "requirements clarified" : ~0.75x to 1.75x  (~2.3x)
      //   - High   ~ "early concept/design"   : ~0.50x to 2.50x  (~5x)
      // Max further from mode than min reflects empirical optimism bias —
      // projects slip more often than they finish early.
      asymmetric: {
        Low:    { min: 0.85, mode: 1.00, max: 1.20 },
        Medium: { min: 0.75, mode: 1.00, max: 1.75 },
        High:   { min: 0.50, mode: 1.00, max: 2.50 },
      },
      // Symmetric: linearly symmetric around mode (max-mode == mode-min).
      // Spreads chosen as the average of the asymmetric profile's up- and
      // down-gaps. Intended companion to the Uniform sampler. No widely
      // agreed industry standard exists for symmetric software estimation;
      // these are a pragmatic equal-spread fallback, not peer-reviewed.
      symmetric: {
        Low:    { min: 0.825, mode: 1.00, max: 1.175 },  // ±17.5%
        Medium: { min: 0.625, mode: 1.00, max: 1.375 },  // ±37.5%
        High:   { min: 0.250, mode: 1.00, max: 1.750 },  // ±75%
      },
    },

    // localStorage keys. The state key uses the "monty" prefix; future
    // history and actuals keys (added in features 2/3) follow the same.
    storageKeys: {
      state:   "monty_state_v1",
      // Future:
      // history: "monty_history_v1",
      // actuals: "monty_actuals_v1",
    },

    // Schema versions. Bumped when the shape of stored data changes.
    // Migration logic lives in loadState / state import handler.
    //   v1 (legacy): had a "matrix" of duration ranges (now replaced by
    //                bases + uncertaintyProfile). Discarded silently.
    //   v2: introduced bases + uncertaintyProfile. Briefly stored bases
    //       as person-weeks; reverted. Buggy migration removed.
    //   v3: bases stored in person-days, displayed as weeks (current).
    schemaVersions: {
      state: 3,
    },
  };

  // Convenience aliases used heavily throughout — keep these as short names
  // so call sites stay readable. They reference into MONTY_CONFIG.
  const SIZES = MONTY_CONFIG.sizes;
  const UNCERTAINTIES = MONTY_CONFIG.uncertainties;
  const WORKING_DAYS_PER_WEEK = MONTY_CONFIG.workingDaysPerWeek;
  const DEFAULT_ITEMS = MONTY_CONFIG.defaults.items;
  const DEFAULT_BASES = MONTY_CONFIG.defaults.bases;
  const DEFAULT_HOLIDAYS = MONTY_CONFIG.defaults.holidays;
  const PROFILE_ASYMMETRIC = MONTY_CONFIG.profiles.asymmetric;
  const PROFILE_SYMMETRIC = MONTY_CONFIG.profiles.symmetric;
  const DEFAULT_UNCERTAINTY_PROFILE = PROFILE_ASYMMETRIC;
  const STATE_KEY = MONTY_CONFIG.storageKeys.state;
  const CURRENT_SCHEMA_VERSION = MONTY_CONFIG.schemaVersions.state;

  const todayISO = () => new Date().toISOString().slice(0, 10);

  // DEFAULT_PARAMS needs startDate set dynamically (today) at app load.
  const DEFAULT_PARAMS = {
    startDate: todayISO(),
    ...MONTY_CONFIG.defaults.params,
  };

  // True when this page is loaded from a stakeholder snapshot HTML
  // (detected at boot via the embedded #monty-snapshot-data tag).
  // Mutating event handlers and persistence are skipped while this is set.
  let IS_SNAPSHOT = false;
  let SNAPSHOT_META = null;

  // ============================================================
  // MODULE: profile-helpers
  // Pure utilities for working with uncertainty profiles.
  // Reads:  none (operates on arguments only)
  // Writes: none
  // ============================================================

  // A profile is "symmetric" if max-mode ≈ mode-min for every level
  // (within rounding tolerance).
  function isProfileSymmetric(profile) {
    const TOL = 0.02;
    for (const u of Object.keys(profile)) {
      const p = profile[u];
      const upGap = p.max - p.mode;
      const downGap = p.mode - p.min;
      if (Math.abs(upGap - downGap) > TOL) return false;
    }
    return true;
  }

  function profilesEqual(a, b) {
    for (const u of Object.keys(a)) {
      if (!b[u]) return false;
      for (const k of ["min", "mode", "max"]) {
        if (Math.abs(a[u][k] - b[u][k]) > 0.005) return false;
      }
    }
    return true;
  }

  // Returns "asymmetric" / "symmetric" / "custom" based on current state.
  // Reads: state.uncertaintyProfile
  function getCurrentPresetName() {
    if (profilesEqual(state.uncertaintyProfile, PROFILE_ASYMMETRIC)) return "asymmetric";
    if (profilesEqual(state.uncertaintyProfile, PROFILE_SYMMETRIC)) return "symmetric";
    return "custom";
  }

  // ============================================================
  // MODULE: state
  // The single source of truth for the current scenario.
  // Mutated by event handlers; persisted to localStorage by saveState();
  // hydrated by loadState() at app start.
  // ============================================================

  const state = {
    items: structuredClone(DEFAULT_ITEMS),
    bases: structuredClone(DEFAULT_BASES),
    uncertaintyProfile: structuredClone(DEFAULT_UNCERTAINTY_PROFILE),
    params: structuredClone(DEFAULT_PARAMS),
    holidays: [...DEFAULT_HOLIDAYS],
    results: null,
    lastRun: null,
  };

  // ============================================================
  // MODULE: persistence
  // Read/write state to localStorage. Schema migrations live here.
  // Reads:  state (when saving), MONTY_CONFIG.storageKeys.state
  // Writes: state (when loading)
  // External deps: window.storage (Anthropic Artifacts) preferred,
  //   with a transparent fallback to native localStorage for plain
  //   `file://` opens and any static web host.
  // ============================================================

  // Storage adapter: prefers window.storage (the Artifacts async key/value
  // store) when present, otherwise uses native localStorage. Both paths
  // expose the same async surface so callers don't need to branch.
  const storageAdapter = (function () {
    if (typeof window !== "undefined" && window.storage &&
        typeof window.storage.get === "function") {
      return {
        async get(k) {
          const r = await window.storage.get(k);
          return r && r.value ? r.value : null;
        },
        async set(k, v) { await window.storage.set(k, v); },
      };
    }
    if (typeof localStorage !== "undefined") {
      return {
        async get(k) { return localStorage.getItem(k); },
        async set(k, v) { localStorage.setItem(k, v); },
      };
    }
    // No storage available (e.g. some sandboxed contexts) — every call no-ops.
    return {
      async get() { return null; },
      async set() { /* no-op */ },
    };
  })();

  async function saveState() {
    try {
      const payload = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        items: state.items,
        bases: state.bases,
        uncertaintyProfile: state.uncertaintyProfile,
        params: state.params,
        holidays: state.holidays,
      };
      await storageAdapter.set(STATE_KEY, JSON.stringify(payload));
    } catch (e) { /* ignore — persistence is best-effort */ }
  }

  async function loadState() {
    try {
      const raw = await storageAdapter.get(STATE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      // schemaVersion currently only exists at v3; older shapes are ignored.
      if (saved.items) state.items = saved.items;
      // Bases stored in person-days (UI shows weeks). No version conversion needed.
      if (saved.bases) {
        state.bases = { ...DEFAULT_BASES, ...saved.bases };
      }
      if (saved.uncertaintyProfile) {
        state.uncertaintyProfile = { ...DEFAULT_UNCERTAINTY_PROFILE, ...saved.uncertaintyProfile };
      }
      if (saved.params) {
        const { lowSpread, ...rest } = saved.params;  // strip removed param
        state.params = { ...DEFAULT_PARAMS, ...rest };
      }
      if (saved.holidays) state.holidays = saved.holidays;
    } catch (e) { /* fallback to defaults */ }
  }

  // ============================================================
  // MODULE: csv
  // CSV parsing and import normalisation.
  // Reads:  none (pure functions on string input)
  // Writes: none (returns parsed objects to caller)
  // ============================================================

  function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i+1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += c; i++;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(cell); cell = ""; i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
      if (c === '\r') { i++; continue; }
      cell += c; i++;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 0 && r.some(c => c && c.trim()));
}

function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.toLowerCase().trim());
  const findCol = (...keys) => header.findIndex(h => keys.some(k => h.includes(k)));
  const nameIdx = findCol("entity_name","name","feature","item");
  const verIdx = findCol("dwgs version","version","release","milestone");
  const uncIdx = findCol("uncertainty");
  const sizeIdx = findCol("t-shirt","tshirt","size");
  const peopleIdx = findCol("people","ppl","headcount","assignees");
  const notesIdx = findCol("notes","note","estimate notes");

  const norm = s => (s || "").trim();
  const normSize = s => {
    const v = norm(s).toUpperCase();
    return SIZES.includes(v) ? v : "";
  };
  const normUnc = s => {
    const v = norm(s);
    if (!v) return "";
    const lower = v.toLowerCase();
    if (lower.startsWith("l")) return "Low";
    if (lower.startsWith("m")) return "Medium";
    if (lower.startsWith("h")) return "High";
    return "";
  };
  const normPeople = s => {
    const v = norm(s);
    if (!v) return null;
    const n = parseInt(v);
    return (!isNaN(n) && n >= 1) ? n : null;
  };

  return rows.slice(1).map(r => ({
    name: norm(r[nameIdx]),
    version: normalizeVersion(norm(r[verIdx])),
    uncertainty: normUnc(r[uncIdx]),
    size: normSize(r[sizeIdx]),
    peopleNeeded: peopleIdx >= 0 ? normPeople(r[peopleIdx]) : null,
    notes: norm(r[notesIdx]).replace(/\\([.,])/g, '$1'),
  })).filter(it => it.name);
}

function normalizeVersion(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return s + ".0";
  return s;
}

function displayVersion(v) { return v ? "v" + v : ""; }

function compareVersions(a, b) {
  const ap = a.split('.').map(Number);
  const bp = b.split('.').map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const ai = ap[i] || 0, bi = bp[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

  // ============================================================
  // MODULE: sampling
  // Random sampling primitives + size/uncertainty → effort sampler.
  // Reads:  none (pure functions on arguments)
  // Writes: none
  // External deps: Math.random
  // ============================================================

function sampleTriangular(min, max, mode) {
  if (max - min < 1e-9) return min;
  const u = Math.random();
  const f = (mode - min) / (max - min);
  if (u < f) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function sampleUniform(min, max) { return min + Math.random() * (max - min); }

// Returns sampled effort in person-days. Bases are stored in person-days internally
// (the bases input UI displays them as weeks for user-friendliness, dividing by 5 on
// render and multiplying by 5 on input). The uncertainty profile multipliers stretch
// the (min, mode, max) range. Duration is computed downstream by dividing sampled
// effort by the number of people assigned to the item.
function sampleEffort(item, bases, profile, params) {
  if (!item.size || !item.uncertainty) return null;
  const base = bases[item.size];
  const prof = profile[item.uncertainty];
  if (base == null || !prof) return null;
  const min = base * prof.min;
  const max = base * prof.max;
  const mode = base * prof.mode;
  if (max - min < 1e-9) return Math.max(0.1, mode);
  const sampler = params.distribution === "uniform" ? sampleUniform : sampleTriangular;
  const v = params.distribution === "uniform" ? sampler(min, max) : sampler(min, max, mode);
  return Math.max(0.1, v);
}

// Resolve people-needed for an item: per-item override if set, otherwise the global default.
function resolvePeopleNeeded(item, defaultPpl) {
  const v = item.peopleNeeded;
  if (v != null && v !== "" && !isNaN(v) && v >= 1) return Math.floor(v);
  return Math.max(1, defaultPpl);
}

  // ============================================================
  // MODULE: calendar
  // Working-day arithmetic — converts between working-day indices
  // (used by the simulation) and calendar dates (used by charts and UI).
  // Reads:  none (pure functions on arguments)
  // Writes: none
  // ============================================================

function isWeekend(d) { const w = d.getUTCDay(); return w === 0 || w === 6; }

function isWorkingDay(d, holidaySet) {
  if (isWeekend(d)) return false;
  const iso = d.toISOString().slice(0,10);
  return !holidaySet.has(iso);
}

// Builds an array of `count` working day Date objects starting on/after startDate.
function buildWorkingCalendar(startDate, count, holidays) {
  const holidaySet = new Set(holidays);
  const days = [];
  const d = new Date(startDate + "T00:00:00.000Z");
  while (!isWorkingDay(d, holidaySet)) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  for (let i = 0; i < count; i++) {
    days.push(new Date(d));
    do { d.setUTCDate(d.getUTCDate() + 1); }
    while (!isWorkingDay(d, holidaySet));
  }
  return days;
}

function formatDate(d) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Convert a fractional working-day index to calendar days from start.
// `kind` = "start" treats integer idx as start-of-working-day.
// `kind` = "end" treats integer idx as end-of-previous-working-day (so back-to-back items
// sit cleanly either side of weekends rather than the previous one's end visually
// crossing the weekend).
function workingIdxToCalDays(idx, calendar, kind) {
  if (idx <= 0) return Math.max(0, idx);
  if (kind === "end" && Number.isInteger(idx)) {
    const i = idx - 1;
    if (i >= calendar.length) {
      const last = calendar.length - 1;
      return (calendar[last] - calendar[0]) / 86400000 + 1 + (i - last);
    }
    return (calendar[i] - calendar[0]) / 86400000 + 1;
  }
  const i = Math.floor(idx);
  const frac = idx - i;
  if (i >= calendar.length) {
    const last = calendar.length - 1;
    return (calendar[last] - calendar[0]) / 86400000 + (idx - last);
  }
  return (calendar[i] - calendar[0]) / 86400000 + frac;
}

  // ============================================================
  // MODULE: simulation
  // The Monte Carlo engine. Repeatedly samples item efforts and
  // schedules them through a people-pool, then aggregates per-item
  // and per-version percentiles.
  // Reads:  state.items, state.bases, state.uncertaintyProfile, state.params (via params arg)
  // Writes: state.results (set by the caller, typically runForecast)
  // ============================================================

// Schedule items in a people-aware way: each item consumes its `peopleNeeded` from a
// pool of `headcount` available people, until the pool is exhausted. The next item starts
// when whichever earlier item finishes first frees enough people. Items always start in
// list order (item N never starts before item N-1), but they may run in parallel up to
// the pool limit. If an item needs more people than headcount allows, it's clamped to
// the headcount (so a single XL with 6 people but headcount=4 will run with 4).
//
// Duration follows a power law: duration = effort / people^alpha. Alpha=1 gives linear
// scaling (2 people = half time); alpha=0.75 gives moderate diminishing returns
// (2 people = ~59% of time, ~40% faster). This captures Brooks's communication overhead
// without making the function non-monotonic.
function scheduleOnce(items, efforts, peopleNeeded, headcount, alpha) {
  const result = items.map(() => null);
  const running = []; // {idx, end, ppl}
  let nextIdx = 0;
  let time = 0;
  let freePeople = headcount;

  while (nextIdx < items.length || running.length > 0) {
    // Try to start as many items as possible (in order) while we have headcount
    while (nextIdx < items.length) {
      const eff = efforts[nextIdx];
      if (eff == null) {
        result[nextIdx] = null;
        nextIdx++;
        continue;
      }
      const need = Math.min(peopleNeeded[nextIdx], headcount); // clamp to available pool
      if (need > freePeople) break; // not enough people right now
      // Power law: 1 person → eff days. n people → eff / n^alpha days.
      const dur = eff / Math.pow(need, alpha);
      const start = time;
      const end = start + dur;
      result[nextIdx] = { start, end, ppl: need };
      running.push({ idx: nextIdx, end, ppl: need });
      freePeople -= need;
      nextIdx++;
    }
    if (running.length === 0) break;
    // Advance time to the earliest finishing item, freeing its people
    running.sort((a, b) => a.end - b.end);
    const next = running.shift();
    time = next.end;
    freePeople += next.ppl;
  }
  return result;
}

function pct(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a,b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function monteCarlo(items, bases, profile, params, n) {
  const headcount = Math.max(1, params.headcount);
  const defaultPpl = Math.max(1, params.peoplePerJob);
  const alpha = (params.parallelismAlpha != null) ? params.parallelismAlpha : 0.75;
  const peopleNeeded = items.map(it => resolvePeopleNeeded(it, defaultPpl));
  const itemStarts = items.map(() => []);
  const itemEnds = items.map(() => []);
  const overall = [];
  let totalEffort = 0;
  let totalEffortCount = 0;

  // Per-version tracking
  const versions = [...new Set(items.filter(i => i.version).map(i => i.version))];
  versions.sort(compareVersions);
  const versionEnds = {};
  versions.forEach(v => versionEnds[v] = []);

  for (let s = 0; s < n; s++) {
    const efforts = items.map(it => sampleEffort(it, bases, profile, params));
    const sched = scheduleOnce(items, efforts, peopleNeeded, headcount, alpha);
    let maxEnd = 0;
    let simEffort = 0;
    const versionMaxes = {};
    versions.forEach(v => versionMaxes[v] = 0);
    sched.forEach((r, i) => {
      if (r) {
        itemStarts[i].push(r.start);
        itemEnds[i].push(r.end);
        if (r.end > maxEnd) maxEnd = r.end;
        simEffort += efforts[i];
        const v = items[i].version;
        if (v && versionMaxes[v] !== undefined && r.end > versionMaxes[v]) {
          versionMaxes[v] = r.end;
        }
      }
    });
    overall.push(maxEnd);
    totalEffort += simEffort;
    totalEffortCount++;
    versions.forEach(v => versionEnds[v].push(versionMaxes[v]));
  }

  const itemResults = items.map((it, i) => {
    if (itemStarts[i].length === 0) {
      return { name: it.name, version: it.version, size: it.size, uncertainty: it.uncertainty, notes: it.notes, peopleNeeded: peopleNeeded[i], estimable: false };
    }
    return {
      name: it.name, version: it.version, size: it.size, uncertainty: it.uncertainty, notes: it.notes, peopleNeeded: peopleNeeded[i], estimable: true,
      start: { p10: pct(itemStarts[i], 0.10), p50: pct(itemStarts[i], 0.50), p80: pct(itemStarts[i], 0.80), p90: pct(itemStarts[i], 0.90) },
      end:   { p10: pct(itemEnds[i],   0.10), p50: pct(itemEnds[i],   0.50), p80: pct(itemEnds[i],   0.80), p90: pct(itemEnds[i],   0.90) },
      meanDuration: itemEnds[i].reduce((a,b,k)=>a + (b - itemStarts[i][k]),0) / itemEnds[i].length,
    };
  });

  // Aggregate per-version stats
  const versionStats = {};
  versions.forEach(v => {
    const ends = versionEnds[v].filter(e => e > 0);
    const itemsInVersion = items.filter(it => it.version === v);
    const estimableInVersion = itemsInVersion.filter(it => it.size && it.uncertainty);
    if (ends.length === 0 || estimableInVersion.length === 0) {
      versionStats[v] = {
        empty: true,
        itemCount: estimableInVersion.length,
        totalCount: itemsInVersion.length,
      };
      return;
    }
    versionStats[v] = {
      p10: pct(ends, 0.10),
      p50: pct(ends, 0.50),
      p80: pct(ends, 0.80),
      p90: pct(ends, 0.90),
      itemCount: estimableInVersion.length,
      totalCount: itemsInVersion.length,
    };
  });

  return {
    overall: {
      p10: pct(overall, 0.10),
      p50: pct(overall, 0.50),
      p80: pct(overall, 0.80),
      p90: pct(overall, 0.90),
      all: overall,
      max: Math.max(...overall),
      min: Math.min(...overall),
    },
    items: itemResults,
    versions: versionStats,
    headcount,
    avgTotalEffort: totalEffort / Math.max(1, totalEffortCount),
  };
}

  // ============================================================
  // MODULE: rendering (controls, items, duration model)
  // Renders the input-side of the app: parameter controls, the items
  // table (with drag-and-drop), and the duration model (bases, profile,
  // ranges, parallelism slider).
  // Reads:  state.* (everything except results)
  // Writes: state.* (via input event handlers — wires changes back to state)
  // External deps: DOM
  // ============================================================

const $ = id => document.getElementById(id);

function renderControls() {
  $("startDate").value = state.params.startDate;
  $("headcount").value = state.params.headcount;
  $("peoplePerJob").value = state.params.peoplePerJob;
  $("simCount").value = state.params.simCount;
  $("distribution").value = state.params.distribution;
  $("slotsCalc").textContent = `${state.params.headcount} ppl pool, default ${state.params.peoplePerJob}/item`;
  $("holidaysText").value = state.holidays.join("\n");
  $("meta-items").textContent = state.items.filter(i => i.size && i.uncertainty).length + "/" + state.items.length;
}

function renderItems() {
  const tbody = $("itemsBody");
  tbody.innerHTML = "";
  if (state.items.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="items-empty"><strong>No items yet.</strong> Import a CSV from the top of the page, or click "Add row" to start.</td>`;
    tbody.appendChild(tr);
    return;
  }
  const defaultPeople = state.params.peoplePerJob;
  state.items.forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.rowIdx = idx;
    const unscored = !item.size || !item.uncertainty;
    if (unscored) tr.classList.add("unscored");
    const peopleVal = item.peopleNeeded != null && item.peopleNeeded !== "" ? item.peopleNeeded : "";
    tr.innerHTML = `
      <td class="row-num drag-handle" title="Drag to reorder"><div class="drag-handle-inner"><span class="drag-grip">⋮⋮</span><span class="row-num-label">${idx + 1}</span></div></td>
      <td>
        <input type="text" class="name-input" data-idx="${idx}" data-field="name" value="${escapeHtml(item.name)}" />
      </td>
      <td class="c">
        <input type="text" class="ver-input" data-idx="${idx}" data-field="version" value="${escapeHtml(item.version || '')}" placeholder="—" style="text-align: center; max-width: 64px; font-family: var(--font-mono); font-size: 12px;" />
      </td>
      <td class="c">
        <select data-idx="${idx}" data-field="size">
          <option value="">—</option>
          ${SIZES.map(s => `<option value="${s}" ${item.size === s ? 'selected' : ''}>${s}</option>`).join("")}
        </select>
      </td>
      <td class="c">
        <select data-idx="${idx}" data-field="uncertainty">
          <option value="">—</option>
          ${UNCERTAINTIES.map(u => `<option value="${u}" ${item.uncertainty === u ? 'selected' : ''}>${u}</option>`).join("")}
        </select>
      </td>
      <td class="c">
        <input type="number" class="people-input" data-idx="${idx}" data-field="peopleNeeded" value="${peopleVal}" min="1" max="20" step="1" placeholder="${defaultPeople}" title="People working on this item — leave blank to use the default (${defaultPeople})" />
      </td>
      <td>
        <input type="text" class="notes-cell" data-idx="${idx}" data-field="notes" value="${escapeHtml(item.notes)}" placeholder="" />
      </td>
      <td class="c">
        <button class="delete-btn" data-delete="${idx}" title="Delete row">×</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // In snapshot mode the table is read-only — skip wiring up edit, delete,
  // and drag handlers entirely.
  if (IS_SNAPSHOT) return;

  tbody.querySelectorAll("input[data-field], select[data-field]").forEach(el => {
    el.addEventListener("change", e => {
      const idx = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      let value = e.target.value;
      if (field === "version") value = normalizeVersion(value);
      if (field === "peopleNeeded") {
        const trimmed = value.trim();
        if (trimmed === "") value = null;
        else {
          const n = parseInt(trimmed);
          value = (!isNaN(n) && n >= 1) ? n : null;
        }
      }
      state.items[idx][field] = value;
      saveState();
      renderItems();
      $("meta-items").textContent = state.items.filter(i => i.size && i.uncertainty).length + "/" + state.items.length;
    });
  });
  tbody.querySelectorAll("[data-delete]").forEach(el => {
    el.addEventListener("click", e => {
      const idx = parseInt(e.currentTarget.dataset.delete);
      state.items.splice(idx, 1);
      saveState();
      renderItems();
    });
  });

  // Drag-and-drop reordering
  attachItemDragHandlers(tbody);
}

function attachItemDragHandlers(tbody) {
  let dragSrcIdx = null;
  let dragOverIdx = null;

  const rows = tbody.querySelectorAll("tr[data-row-idx]");
  rows.forEach(tr => {
    // Make the row only draggable when the drag actually starts from the handle.
    // We toggle `draggable` on mousedown over the handle, and clear it after.
    const handle = tr.querySelector(".drag-handle");
    if (handle) {
      handle.addEventListener("mousedown", () => { tr.draggable = true; });
      tr.addEventListener("mouseleave", () => { tr.draggable = false; });
    }
    // Default: not draggable until handle is grabbed
    tr.draggable = false;

    tr.addEventListener("dragstart", e => {
      // If draggable was set by handle mousedown, this fires; otherwise it shouldn't reach here
      dragSrcIdx = parseInt(tr.dataset.rowIdx);
      tr.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", String(dragSrcIdx)); } catch (_) {}
    });
    tr.addEventListener("dragend", () => {
      tr.classList.remove("dragging");
      tr.draggable = false;
      tbody.querySelectorAll(".drop-above, .drop-below").forEach(r => {
        r.classList.remove("drop-above", "drop-below");
      });
      dragSrcIdx = null;
      dragOverIdx = null;
    });
    tr.addEventListener("dragover", e => {
      if (dragSrcIdx == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const targetIdx = parseInt(tr.dataset.rowIdx);
      if (targetIdx === dragSrcIdx) return;
      const rect = tr.getBoundingClientRect();
      const above = (e.clientY - rect.top) < rect.height / 2;
      tbody.querySelectorAll(".drop-above, .drop-below").forEach(r => {
        r.classList.remove("drop-above", "drop-below");
      });
      tr.classList.add(above ? "drop-above" : "drop-below");
      dragOverIdx = above ? targetIdx : targetIdx + 1;
    });
    tr.addEventListener("drop", e => {
      e.preventDefault();
      if (dragSrcIdx == null || dragOverIdx == null) return;
      let target = dragOverIdx;
      if (dragSrcIdx < target) target -= 1;
      if (target === dragSrcIdx) return;
      const [moved] = state.items.splice(dragSrcIdx, 1);
      state.items.splice(target, 0, moved);
      saveState();
      renderItems();
    });
  });
}

function renderDurationModel() {
  renderModelIntro();
  renderProfilePresetSelect();
  renderBases();
  renderProfile();
  renderRanges();
  renderParallelism();
  renderProfileWarning();
}

function renderParallelism() {
  const slider = $("parallelismAlpha");
  const valEl = $("parallelismAlphaVal");
  const preview = $("parallelismPreview");
  if (!slider || !valEl || !preview) return;
  const alpha = state.params.parallelismAlpha != null ? state.params.parallelismAlpha : 0.75;
  slider.value = Math.round(alpha * 100);
  valEl.textContent = `α = ${alpha.toFixed(2)}`;
  // Build a preview showing how duration scales for 1, 2, 3, 4, 6, 8 people
  const peopleSamples = [1, 2, 3, 4, 6, 8];
  const baseline = 1; // duration with 1 person, normalised
  const rows = peopleSamples.map(p => {
    const factor = baseline / Math.pow(p, alpha);
    const fasterPct = p === 1 ? 0 : Math.round((1 - factor) * 100);
    const widthPct = factor * 100;
    const fasterText = p === 1 ? "baseline" : `${fasterPct}% faster`;
    return `
      <div class="parallelism-preview-row">
        <span class="parallelism-preview-people">${p} ${p === 1 ? 'person' : 'people'}</span>
        <span class="parallelism-preview-bar"><span class="parallelism-preview-fill" style="width: ${widthPct.toFixed(1)}%"></span></span>
        <span class="parallelism-preview-multiplier">${fasterText}</span>
      </div>
    `;
  }).join("");
  preview.innerHTML = `
    <div class="parallelism-preview-title">Duration vs people (relative to 1 person)</div>
    ${rows}
  `;
}

function renderModelIntro() {
  const el = $("modelIntroText");
  if (!el) return;
  const dist = state.params.distribution;
  const preset = getCurrentPresetName();
  const isSym = isProfileSymmetric(state.uncertaintyProfile);

  // Lead sentence describes the sampler shape
  let lead;
  if (dist === "triangular") {
    lead = `Each item's effort is sampled from a <strong>triangular distribution</strong>: <span class="num">triangular(min, mode, max)</span>. The mode is the base value for the size; min and max come from the uncertainty profile.`;
  } else {
    lead = `Each item's effort is sampled from a <strong>uniform distribution</strong> across <span class="num">[min, max]</span> derived from the size's base and the uncertainty profile. The mode is ignored — every value in the range is equally likely.`;
  }

  // Second sentence describes the shape of the current profile
  let shape;
  if (preset === "asymmetric") {
    shape = `The profile is <strong>asymmetric</strong> with a longer right tail, reflecting empirical optimism bias — projects slip more often than they finish early.`;
  } else if (preset === "symmetric") {
    shape = `The profile is <strong>symmetric</strong> — equal range either side of the mode. There is no widely-agreed industry-standard symmetric profile for software estimation; these values are a pragmatic equal-spread version of the asymmetric defaults.`;
  } else if (isSym) {
    shape = `The profile is custom and currently <strong>symmetric</strong> — equal range either side of the mode.`;
  } else {
    shape = `The profile is custom with an asymmetric shape — values either side of the mode differ.`;
  }

  // Third sentence: effort vs duration
  const effort = `Sampled values are <strong>person-weeks of effort</strong>; duration for each item is computed as effort divided by the number of people assigned (column "People" in the items table), then converted to working days for the schedule.`;

  el.innerHTML = `${lead} ${shape} ${effort}`;
}

function renderProfilePresetSelect() {
  const sel = $("profilePreset");
  if (!sel) return;
  sel.value = getCurrentPresetName();
}

function renderProfileWarning() {
  const el = $("profileWarning");
  if (!el) return;
  const dist = state.params.distribution;
  const sym = isProfileSymmetric(state.uncertaintyProfile);

  // Two cases of inconsistency to warn about:
  let msg = null;
  let actionLabel = null;
  let actionHandler = null;

  if (dist === "uniform" && !sym) {
    msg = `<strong>Uniform sampler with an asymmetric profile.</strong> The Uniform sampler ignores the mode and treats all values between min and max as equally likely, so the asymmetry you've encoded has no effect on the forecast. For a coherent model, switch to symmetric multipliers or change the sampler back to Triangular.`;
    actionLabel = "Use symmetric profile";
    actionHandler = () => {
      state.uncertaintyProfile = structuredClone(PROFILE_SYMMETRIC);
      saveState();
      renderProfile();
      renderRanges();
      renderProfilePresetSelect();
      renderProfileWarning();
      renderModelIntro();
    };
  } else if (dist === "triangular" && sym) {
    msg = `<strong>Triangular sampler with a symmetric profile.</strong> This is internally consistent but discards the optimism-bias signal. Real software estimates skew right - finishing earlier than the mode is harder than slipping past it. Consider switching to the asymmetric profile to capture this.`;
    actionLabel = "Use asymmetric profile";
    actionHandler = () => {
      state.uncertaintyProfile = structuredClone(PROFILE_ASYMMETRIC);
      saveState();
      renderProfile();
      renderRanges();
      renderProfilePresetSelect();
      renderProfileWarning();
      renderModelIntro();
    };
  }

  if (!msg) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  el.style.display = "flex";
  el.innerHTML = `
    <span class="warn-icon">⚠</span>
    <div class="warn-body">
      ${msg}
      <div class="warn-actions">
        <button class="subtle" id="warnFixBtn">${actionLabel}</button>
        <button class="subtle" id="warnDismissBtn">Dismiss</button>
      </div>
    </div>
  `;
  $("warnFixBtn").addEventListener("click", actionHandler);
  $("warnDismissBtn").addEventListener("click", () => {
    el.style.display = "none";
  });
}

function renderBases() {
  const grid = $("basesGrid");
  if (!grid) return;
  // Format weeks: trim trailing zeros (e.g. "1" not "1.00", "0.5" not "0.50")
  const fmtWeeks = days => {
    const w = days / WORKING_DAYS_PER_WEEK;
    return parseFloat(w.toFixed(2)).toString();
  };
  grid.innerHTML = SIZES.map(s => `
    <div class="base-cell">
      <span class="base-label">${s}</span>
      <div class="base-input-wrap">
        <input type="number" data-size="${s}" value="${fmtWeeks(state.bases[s])}" step="0.1" min="0.1" />
      </div>
      <span class="base-unit">weeks</span>
    </div>
  `).join("");
  grid.querySelectorAll("input").forEach(el => {
    el.addEventListener("change", e => {
      const s = e.target.dataset.size;
      const weeks = parseFloat(e.target.value);
      if (!isNaN(weeks) && weeks > 0) {
        state.bases[s] = weeks * WORKING_DAYS_PER_WEEK;
        saveState();
        renderRanges();
      } else {
        e.target.value = fmtWeeks(state.bases[s]);
      }
    });
  });
}

function renderProfile() {
  const grid = $("profileGrid");
  if (!grid) return;
  let html = `
    <div class="profile-cell head"></div>
    <div class="profile-cell head">Min ×</div>
    <div class="profile-cell head">Mode ×</div>
    <div class="profile-cell head">Max ×</div>
  `;
  UNCERTAINTIES.forEach(u => {
    const p = state.uncertaintyProfile[u];
    html += `<div class="profile-cell row-head">${u}</div>`;
    ["min","mode","max"].forEach(k => {
      const isMode = k === "mode";
      html += `<div class="profile-cell">
        <input type="number" data-unc="${u}" data-key="${k}" value="${p[k].toFixed(2)}" step="0.05" min="0.05" max="10" ${isMode ? 'readonly title="Mode is always the base value (anchor point of the distribution)"' : ''} />
      </div>`;
    });
  });
  grid.innerHTML = html;
  grid.querySelectorAll("input:not([readonly])").forEach(el => {
    el.addEventListener("change", e => {
      const u = e.target.dataset.unc;
      const k = e.target.dataset.key;
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) {
        state.uncertaintyProfile[u][k] = v;
        // Sanity: keep min ≤ mode ≤ max
        const p = state.uncertaintyProfile[u];
        if (p.min > p.mode) p.min = p.mode;
        if (p.max < p.mode) p.max = p.mode;
        saveState();
        renderProfile();
        renderRanges();
        renderProfilePresetSelect();
        renderProfileWarning();
        renderModelIntro();
      } else {
        e.target.value = state.uncertaintyProfile[u][k].toFixed(2);
      }
    });
  });
}

function renderRanges() {
  const grid = $("rangesGrid");
  if (!grid) return;
  let html = `<div class="ranges-cell head"></div>`;
  UNCERTAINTIES.forEach(u => html += `<div class="ranges-cell head">${u}</div>`);
  // Weeks: trim trailing zeros, show 2 decimals max
  const fmtW = days => {
    const w = days / WORKING_DAYS_PER_WEEK;
    if (w < 0.1) return w.toFixed(2);
    return parseFloat(w.toFixed(2)).toString();
  };
  // Days: integer if >=10, one decimal if >=1, two decimals otherwise
  const fmtD = n => {
    if (n < 1) return n.toFixed(2);
    if (n < 10) return n.toFixed(1);
    return n.toFixed(0);
  };
  SIZES.forEach(s => {
    html += `<div class="ranges-cell row-head">${s}</div>`;
    UNCERTAINTIES.forEach(u => {
      const base = state.bases[s] || 0;
      const p = state.uncertaintyProfile[u];
      const min = base * p.min;
      const mode = base * p.mode;
      const max = base * p.max;
      const totalDays = `${fmtD(min)}–${fmtD(max)}d`;
      html += `<div class="ranges-cell">
        <div class="ranges-weeks"><span class="ranges-side">${fmtW(min)}</span><span class="ranges-sep">—</span><span class="ranges-mode">${fmtW(mode)}</span><span class="ranges-sep">—</span><span class="ranges-side">${fmtW(max)}</span><span class="ranges-unit">w</span></div>
        <div class="ranges-days">${totalDays}</div>
      </div>`;
    });
  });
  grid.innerHTML = html;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function uncertaintyPill(u) {
  if (!u) return "";
  return `<span class="pill ${u.toLowerCase()}">${u}</span>`;
}

  // ============================================================
  // MODULE: rendering (results, gantt, histogram, version cards)
  // Renders the output-side of the app: headline cards, version cards,
  // Gantt chart (with tooltips and milestones), distribution histogram,
  // per-item table.
  // Reads:  state.results, state.params, state.holidays, state.items
  // Writes: none (read-only render of computed results)
  // External deps: DOM
  // ============================================================

function renderResults() {
  const r = state.results;
  const root = $("results-content");
  if (!r) {
    root.innerHTML = `
      <div class="empty">
        <div class="big">No forecast yet</div>
        <div>Adjust parameters above and run the simulation.</div>
      </div>`;
    return;
  }

  // Build calendar
  const calendar = buildWorkingCalendar(state.params.startDate, Math.ceil(r.overall.max) + 30, state.holidays);
  const dateAt = idx => {
    const i = Math.min(calendar.length - 1, Math.max(0, Math.floor(idx)));
    return calendar[i];
  };
  const dateAtEnd = idx => {
    const i = Math.min(calendar.length - 1, Math.max(0, Math.ceil(idx) - 1));
    return calendar[Math.max(0, i)];
  };

  const startDateObj = calendar[0];
  const fmtDays = n => `${Math.round(n)}d`;
  const fmtDaysFrac = n => Number.isFinite(n) ? `${n.toFixed(1)}d` : "—";
  const dayShort = d => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()];
  const splitDate = d => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  const p50End = dateAtEnd(r.overall.p50);
  const p80End = dateAtEnd(r.overall.p80);
  const p90End = dateAtEnd(r.overall.p90);
  const p80Slip = Math.round(r.overall.p80 - r.overall.p50);
  const p90Slip = Math.round(r.overall.p90 - r.overall.p50);
  const slipBadge = n => n > 0
    ? `<span class="slip-badge">+${n}d slip</span>`
    : `<span class="slip-badge zero">±0d</span>`;

  const estimableCount = r.items.filter(i => i.estimable).length;
  // Build a summary of people allocation across items
  const estimableItems = r.items.filter(i => i.estimable);
  const peopleVarying = estimableItems.length > 0 && estimableItems.some(it => it.peopleNeeded !== estimableItems[0].peopleNeeded);
  const peopleSummary = peopleVarying
    ? `${estimableCount}/${r.items.length} items · ${r.headcount} ppl pool`
    : (estimableItems.length > 0
        ? `${estimableCount}/${r.items.length} items · ${estimableItems[0].peopleNeeded} ppl/item · ${r.headcount} ppl pool`
        : `${estimableCount}/${r.items.length} items · ${r.headcount} ppl pool`);

  const headline = `
    <div class="headline-grid">
      <div class="stat stat-p50">
        <div class="stat-head">
          <span class="eyebrow">P50 end</span>
        </div>
        <div class="stat-day">${dayShort(p50End)}</div>
        <div class="stat-date">${splitDate(p50End)}</div>
        <div class="stat-meta">${fmtDays(r.overall.p50)} working days from start</div>
      </div>
      <div class="stat stat-p80">
        <div class="stat-head">
          <span class="eyebrow">P80 end</span>
          ${slipBadge(p80Slip)}
        </div>
        <div class="stat-day">${dayShort(p80End)}</div>
        <div class="stat-date">${splitDate(p80End)}</div>
        <div class="stat-meta">${fmtDays(r.overall.p80)} working days from start</div>
      </div>
      <div class="stat stat-p90">
        <div class="stat-head">
          <span class="eyebrow">P90 end</span>
          ${slipBadge(p90Slip)}
        </div>
        <div class="stat-day">${dayShort(p90End)}</div>
        <div class="stat-date">${splitDate(p90End)}</div>
        <div class="stat-meta">${fmtDays(r.overall.p90)} working days from start</div>
      </div>
      <div class="stat stat-effort">
        <div class="stat-head">
          <span class="eyebrow">Effort</span>
        </div>
        <div class="stat-effort-num">${(r.avgTotalEffort / 5).toFixed(1)}</div>
        <div class="stat-effort-unit">person-weeks, mean across sims</div>
        <div class="stat-meta">${peopleSummary}</div>
      </div>
    </div>
  `;

  const ganttHtml = renderGantt(r, calendar);
  const histHtml = renderHistogram(r, calendar);
  const tableHtml = renderItemTable(r, calendar);
  const versionsHtml = renderVersionsBlock(r, calendar);

  root.innerHTML = `
    ${headline}
    ${versionsHtml}
    <div style="margin-top: 24px;">
      ${ganttHtml}
    </div>
    <div style="margin-top: 24px;">
      ${histHtml}
    </div>
    <div style="margin-top: 24px;">
      ${tableHtml}
    </div>
  `;

  // Wire up Gantt tooltips
  attachGanttTooltip(r, calendar);
}

function renderVersionsBlock(r, calendar) {
  const versionKeys = Object.keys(r.versions || {});
  if (versionKeys.length === 0) return "";
  const dateAtEnd = idx => calendar[Math.min(calendar.length - 1, Math.max(0, Math.ceil(idx) - 1))];
  versionKeys.sort(compareVersions);
  const cards = versionKeys.map(v => {
    const stats = r.versions[v];
    if (stats.empty) {
      return `
        <div class="version-card empty-card">
          <div class="version-label">${escapeHtml(displayVersion(v))}</div>
          <div class="vrow"><span class="vlabel">P50</span><span class="vdate">—</span></div>
          <div class="vrow"><span class="vlabel">P80</span><span class="vdate">—</span></div>
          <div class="vrow"><span class="vlabel">P90</span><span class="vdate">—</span></div>
          <div class="vmeta">${stats.itemCount}/${stats.totalCount} items estimable</div>
        </div>`;
    }
    return `
      <div class="version-card">
        <div class="version-label">${escapeHtml(displayVersion(v))}</div>
        <div class="vrow p50"><span class="vlabel">P50</span><span class="vdate">${formatDate(dateAtEnd(stats.p50))}</span></div>
        <div class="vrow p80"><span class="vlabel">P80</span><span class="vdate">${formatDate(dateAtEnd(stats.p80))}</span></div>
        <div class="vrow p90"><span class="vlabel">P90</span><span class="vdate">${formatDate(dateAtEnd(stats.p90))}</span></div>
        <div class="vmeta">${stats.itemCount}/${stats.totalCount} items · ${Math.round(stats.p80)}d to P80</div>
      </div>`;
  }).join("");
  return `
    <div style="margin-top: 28px;">
      <div class="versions-block-head">
        <span class="eyebrow">By release version</span>
      </div>
      <div class="versions-grid">${cards}</div>
    </div>
  `;
}

// (legacy stub for older state — no-op now that versions render inline)
function renderVersionsSection() {}

function attachGanttTooltip(r, calendar) {
  const svg = document.getElementById("ganttSvg");
  const tip = document.getElementById("ganttTooltip");
  if (!svg || !tip) return;

  const dateAtStart = idx => calendar[Math.min(calendar.length - 1, Math.max(0, Math.floor(idx)))];
  const dateAtEnd = idx => calendar[Math.min(calendar.length - 1, Math.max(0, Math.ceil(idx) - 1))];
  const dayShort = d => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()];
  const fmtDateWithDay = d => `${dayShort(d)} ${formatDate(d)}`;

  function renderTipContent(item, idx) {
    const noteHtml = item.notes ? `<div class="tt-notes">${escapeHtml(item.notes)}</div>` : "";
    if (!item.estimable) {
      return `
        <div class="tt-name">${escapeHtml(item.name)}</div>
        <div class="tt-meta">Item ${idx + 1} · not estimable</div>
        <div class="tt-warn">Add a T-shirt size and uncertainty score to include this item in the forecast.</div>
        ${noteHtml}
      `;
    }
    const startP50 = item.start.p50;
    const endP50 = item.end.p50;
    const endP80 = item.end.p80;
    const endP90 = item.end.p90;
    const spread = item.end.p90 - item.end.p10;
    const verPill = item.version ? `<span class="pill version">${escapeHtml(displayVersion(item.version))}</span>` : '';
    return `
      <div class="tt-name">${escapeHtml(item.name)}</div>
      <div class="tt-meta">Item ${idx + 1} of ${r.items.length}</div>
      <div class="tt-pills">${verPill}${uncertaintyPill(item.uncertainty)} <span class="pill">${item.size}</span></div>
      <div class="tt-row">
        <span class="tt-label"><span class="tt-dot" style="background: #2b2f3b;"></span>Start P50</span>
        <span class="tt-value">${formatDate(dateAtStart(startP50))}<span class="tt-days">· ${Math.round(startP50)}d</span></span>
      </div>
      <div class="tt-divider"></div>
      <div class="tt-row">
        <span class="tt-label"><span class="tt-dot" style="background: #2b2f3b;"></span>End P50</span>
        <span class="tt-value">${formatDate(dateAtEnd(endP50))}<span class="tt-days">· ${Math.round(endP50)}d</span></span>
      </div>
      <div class="tt-row">
        <span class="tt-label"><span class="tt-dot" style="background: #005eb8;"></span>End P80</span>
        <span class="tt-value">${formatDate(dateAtEnd(endP80))}<span class="tt-days">· ${Math.round(endP80)}d</span></span>
      </div>
      <div class="tt-row">
        <span class="tt-label"><span class="tt-dot" style="background: #df007d;"></span>End P90</span>
        <span class="tt-value">${formatDate(dateAtEnd(endP90))}<span class="tt-days">· ${Math.round(endP90)}d</span></span>
      </div>
      <div class="tt-divider"></div>
      <div class="tt-row">
        <span class="tt-label">People</span>
        <span class="tt-value">${item.peopleNeeded}</span>
      </div>
      <div class="tt-row">
        <span class="tt-label">Mean dur.</span>
        <span class="tt-value">${item.meanDuration.toFixed(1)} days</span>
      </div>
      <div class="tt-row">
        <span class="tt-label">P10–P90 spread</span>
        <span class="tt-value">${spread.toFixed(1)} days</span>
      </div>
      ${noteHtml}
    `;
  }

  function renderMilestoneTipContent(versionKey, stats) {
    if (stats.empty) {
      return `
        <div class="tt-name">${escapeHtml(displayVersion(versionKey))} <span style="color: var(--muted); font-weight: 400;">release</span></div>
        <div class="tt-meta">No estimable items yet</div>
        <div class="tt-warn">Add T-shirt size and uncertainty for items in this version to forecast dates.</div>
      `;
    }
    const slip80 = Math.round(stats.p80 - stats.p50);
    const slip90 = Math.round(stats.p90 - stats.p50);
    const unscored = stats.totalCount - stats.itemCount;
    const itemsInVersion = r.items.filter(it => it.version === versionKey);
    const namesList = itemsInVersion.map(it => {
      const dot = it.estimable ? "●" : "○";
      const dotCol = it.estimable ? "var(--accent)" : "var(--muted)";
      const ital = it.estimable ? "" : "font-style: italic; color: var(--muted);";
      return `<div class="tt-version-item" style="${ital}"><span style="color: ${dotCol}; margin-right: 6px;">${dot}</span>${escapeHtml(it.name)}</div>`;
    }).join("");
    const unscoredNote = unscored > 0
      ? `<div class="tt-warn-soft">${unscored} item${unscored === 1 ? '' : 's'} not yet scored — date will move when scored</div>`
      : '';
    return `
      <div class="tt-name">${escapeHtml(displayVersion(versionKey))} <span style="color: var(--muted); font-weight: 400;">release</span></div>
      <div class="tt-meta">${stats.itemCount}/${stats.totalCount} items estimable</div>
      <div class="tt-divider"></div>
      <div class="tt-row">
        <span class="tt-label"><span class="tt-dot" style="background: #2b2f3b;"></span>P50</span>
        <span class="tt-value">${fmtDateWithDay(dateAtEnd(stats.p50))}<span class="tt-days">· ${Math.round(stats.p50)}d</span></span>
      </div>
      <div class="tt-row">
        <span class="tt-label"><span class="tt-dot" style="background: #005eb8;"></span>P80</span>
        <span class="tt-value">${fmtDateWithDay(dateAtEnd(stats.p80))}<span class="tt-days">· +${slip80}d slip</span></span>
      </div>
      <div class="tt-row">
        <span class="tt-label"><span class="tt-dot" style="background: #df007d;"></span>P90</span>
        <span class="tt-value">${fmtDateWithDay(dateAtEnd(stats.p90))}<span class="tt-days">· +${slip90}d slip</span></span>
      </div>
      ${unscoredNote}
      <div class="tt-divider"></div>
      <div class="tt-version-items">${namesList}</div>
    `;
  }

  function positionTip(e) {
    const margin = 16;
    const tipRect = tip.getBoundingClientRect();
    let x = e.clientX + margin;
    let y = e.clientY + margin;
    if (x + tipRect.width > window.innerWidth - 8) x = e.clientX - tipRect.width - margin;
    if (y + tipRect.height > window.innerHeight - 8) y = e.clientY - tipRect.height - margin;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  let currentKey = null;
  svg.addEventListener("mousemove", e => {
    // Milestones take priority since they live below items in the SVG
    const milestone = e.target.closest("[data-version-key]");
    if (milestone) {
      const v = milestone.dataset.versionKey;
      const stats = r.versions ? r.versions[v] : null;
      const newKey = `v:${v}`;
      if (stats && currentKey !== newKey) {
        tip.innerHTML = renderMilestoneTipContent(v, stats);
        tip.style.display = "block";
        currentKey = newKey;
      }
      positionTip(e);
      return;
    }
    const row = e.target.closest("[data-item-idx]");
    if (row) {
      const idx = parseInt(row.dataset.itemIdx);
      const item = r.items[idx];
      const newKey = `i:${idx}`;
      if (item && currentKey !== newKey) {
        tip.innerHTML = renderTipContent(item, idx);
        tip.style.display = "block";
        currentKey = newKey;
      }
      positionTip(e);
      return;
    }
    tip.style.display = "none";
    currentKey = null;
  });
  svg.addEventListener("mouseleave", () => {
    tip.style.display = "none";
    currentKey = null;
  });
}

function renderGantt(r, calendar) {
  const items = r.items;
  const holidaySet = new Set(state.holidays);
  const startDate = calendar[0];

  // Determine span in calendar days
  const maxWorkingIdx = Math.max(r.overall.p90, ...items.filter(i => i.estimable).map(i => i.end.p90));
  const endCalDays = workingIdxToCalDays(maxWorkingIdx, calendar, "end");
  const maxCalDays = Math.ceil(endCalDays) + 5;

  // Per-version milestones (only versions with at least one estimable item)
  const versionKeys = Object.keys(r.versions || {})
    .filter(v => !r.versions[v].empty)
    .sort(compareVersions);
  const milestoneH = versionKeys.length > 0 ? 64 : 0;

  const W = 1040, padL = 72, padR = 24, padT = 56, padB = 36;
  const innerW = W - padL - padR;
  const rowH = 28;
  const itemsBottom = padT + items.length * rowH;
  const H = itemsBottom + milestoneH + padB;

  const x = (calDays) => padL + (calDays / maxCalDays) * innerW;
  const xWiStart = (workingIdx) => x(workingIdxToCalDays(workingIdx, calendar, "start"));
  const xWiEnd = (workingIdx) => x(workingIdxToCalDays(workingIdx, calendar, "end"));

  // Brand palette
  const C_DARK = "#2b2f3b";
  const C_BLUE = "#005eb8";
  const C_BLUE_SOFT = "#cce4f3";
  const C_GREEN = "#26913d";
  const C_PINK = "#df007d";
  const C_HAIR = "#e5e7eb";
  const C_NONWORK = "#f0f1f4";
  const C_MUTED = "#7a8090";

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const chartTop = padT;
  const chartBottom = H - padB;

  let svg = `<svg class="chart" id="ganttSvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`;

  // Weekend / bank holiday shading
  for (let d = 0; d < maxCalDays; d++) {
    const date = new Date(startDate.getTime() + d * 86400000);
    if (!isWorkingDay(date, holidaySet)) {
      const x0 = x(d);
      const x1 = x(d + 1);
      svg += `<rect x="${x0}" y="${chartTop}" width="${x1 - x0}" height="${chartBottom - chartTop}" fill="${C_NONWORK}" />`;
    }
  }

  // Month gridlines and labels
  let lastMonth = -1;
  for (let d = 0; d < maxCalDays; d++) {
    const date = new Date(startDate.getTime() + d * 86400000);
    const m = date.getUTCMonth();
    if (m !== lastMonth) {
      const xv = x(d);
      svg += `<line x1="${xv}" y1="${chartTop}" x2="${xv}" y2="${chartBottom}" stroke="${C_HAIR}" stroke-width="1" />`;
      if (xv > padL + 4) {
        svg += `<text x="${xv + 5}" y="${chartTop - 14}" font-family="JetBrains Mono, monospace" font-size="10" fill="${C_MUTED}" letter-spacing="0.04em" font-weight="600">${months[m]} ${String(date.getUTCFullYear()).slice(2)}</text>`;
      }
      lastMonth = m;
    }
  }
  svg += `<text x="${padL + 4}" y="${chartTop - 14}" font-family="JetBrains Mono, monospace" font-size="10" fill="${C_MUTED}" letter-spacing="0.04em" font-weight="600">${months[startDate.getUTCMonth()]} ${String(startDate.getUTCFullYear()).slice(2)}</text>`;

  // Today indicator (label sits above the month labels so the two never clash)
  const todayMs = Date.now();
  const todayCalDays = (todayMs - startDate.getTime()) / 86400000;
  if (todayCalDays > 0.5 && todayCalDays < maxCalDays) {
    const tx = x(todayCalDays);
    const todayDate = new Date(todayMs);
    const todayLabel = `today · ${todayDate.getUTCDate()} ${months[todayDate.getUTCMonth()]}`;
    // Decide text-anchor based on proximity to chart edges
    let anchor = "middle";
    let textX = tx;
    if (tx < padL + 36) { anchor = "start"; textX = tx + 8; }
    else if (tx > W - padR - 36) { anchor = "end"; textX = tx - 8; }
    // Text label (sits above month labels at chartTop - 14)
    svg += `<text x="${textX}" y="${chartTop - 32}" font-family="JetBrains Mono, monospace" font-size="10" fill="${C_GREEN}" font-weight="700" letter-spacing="0.04em" text-anchor="${anchor}">${todayLabel}</text>`;
    // Circle just below the label
    svg += `<circle cx="${tx}" cy="${chartTop - 22}" r="3" fill="${C_GREEN}" />`;
    // Dashed line from below the circle down through the chart
    svg += `<line x1="${tx}" y1="${chartTop - 18}" x2="${tx}" y2="${chartBottom}" stroke="${C_GREEN}" stroke-width="1" stroke-dasharray="2,2" />`;
  }

  // Overall percentile vertical lines (subtle, since milestones do most of the per-release work)
  [["p50", C_DARK, "0"], ["p80", C_BLUE, "4,3"], ["p90", C_PINK, "2,3"]].forEach(([k, color, dash]) => {
    const xv = xWiEnd(r.overall[k]);
    svg += `<line x1="${xv}" y1="${chartTop}" x2="${xv}" y2="${itemsBottom + 4}" stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" opacity="0.4" />`;
  });

  // Bars (per item)
  const itemsCenterY = padT + (items.length * rowH) / 2;
  // Rotated "LINE ITEMS" gutter label
  if (items.length > 0) {
    svg += `<text x="14" y="${itemsCenterY}" transform="rotate(-90 14 ${itemsCenterY})" font-family="JetBrains Mono, monospace" font-size="9" fill="${C_MUTED}" font-weight="700" letter-spacing="0.12em" text-anchor="middle">LINE ITEMS</text>`;
  }
  items.forEach((it, i) => {
    const rowTop = padT + i * rowH;
    const y = rowTop + 4;
    svg += `<g class="gantt-row" data-item-idx="${i}">`;
    svg += `<text x="${padL - 14}" y="${y + 14}" font-family="JetBrains Mono, monospace" font-size="11" fill="${C_MUTED}" font-weight="600" text-anchor="end">${i+1}</text>`;
    if (!it.estimable) {
      // Unscored: thin dashed placeholder line. Hit area is a small strip around the
      // line so users hovering directly on the placeholder get a "score this to forecast"
      // tooltip — but hovering empty row space does nothing.
      svg += `<line x1="${padL + 4}" y1="${y + 11}" x2="${W - padR}" y2="${y + 11}" stroke="${C_HAIR}" stroke-width="1" stroke-dasharray="2,3" />`;
      svg += `<rect x="${padL + 4}" y="${y + 6}" width="${W - padR - padL - 4}" height="10" fill="white" fill-opacity="0" pointer-events="all" style="cursor: help;" />`;
    } else {
      const startX = xWiStart(it.start.p10);
      const startP50 = xWiStart(it.start.p50);
      const endP50 = xWiEnd(it.end.p50);
      const endP90 = xWiEnd(it.end.p90);
      // Visible: P10-P90 spread bar (light) + P50 bar (solid) + end-cap circle
      svg += `<rect x="${startX}" y="${y + 9}" width="${Math.max(1, endP90 - startX)}" height="4" fill="${C_BLUE_SOFT}" rx="2" />`;
      svg += `<rect x="${startP50}" y="${y + 6}" width="${Math.max(2, endP50 - startP50)}" height="10" fill="${C_BLUE}" rx="2" />`;
      svg += `<circle cx="${endP50}" cy="${y + 11}" r="3" fill="${C_DARK}"/>`;
      // Hit area: covers the full P10-P90 span at row height, with a small horizontal pad
      // for easier targeting. Only over the bar itself - never the empty row gutter.
      const hitPad = 4;
      const hitX = startX - hitPad;
      const hitW = Math.max(1, endP90 - startX) + hitPad * 2;
      svg += `<rect x="${hitX}" y="${rowTop}" width="${hitW}" height="${rowH}" fill="white" fill-opacity="0" pointer-events="all" style="cursor: pointer;" />`;
    }
    svg += `</g>`;
  });

  // Version milestones row
  if (versionKeys.length > 0) {
    const milestoneY = itemsBottom + 32;
    const labelY = milestoneY - 16;
    const dateY = milestoneY + 18;

    // Separator line above the milestones row
    svg += `<line x1="${padL}" y1="${itemsBottom + 8}" x2="${W - padR}" y2="${itemsBottom + 8}" stroke="${C_HAIR}" stroke-width="1" />`;

    // "Releases" gutter label
    svg += `<text x="${padL - 14}" y="${milestoneY + 4}" font-family="JetBrains Mono, monospace" font-size="9" fill="${C_MUTED}" font-weight="700" letter-spacing="0.08em" text-anchor="end">RELEASES</text>`;

    versionKeys.forEach(v => {
      const stats = r.versions[v];
      const xP50 = xWiEnd(stats.p50);
      const xP90 = xWiEnd(stats.p90);
      const calIdxP50 = Math.min(calendar.length - 1, Math.max(0, Math.ceil(stats.p50) - 1));
      const dateP50 = calendar[calIdxP50];
      const dateLabel = `${dateP50.getUTCDate()} ${months[dateP50.getUTCMonth()]}`;

      // Hit area dimensions for tooltip — covers label, diamond, whisker, and date
      const hitX = Math.min(xP50 - 28, xP90 - 28);
      const hitW = Math.max(xP90 + 12, xP50 + 28) - hitX;
      const hitY = labelY - 12;
      const hitH = (dateY + 4) - hitY;

      svg += `<g class="gantt-milestone" data-version-key="${escapeXml(v)}" style="cursor: pointer;">`;
      // Whisker P50 to P90 (slip range), with right tick at P90
      svg += `<line x1="${xP50}" y1="${milestoneY}" x2="${xP90}" y2="${milestoneY}" stroke="${C_BLUE}" stroke-width="2" stroke-linecap="round" />`;
      svg += `<line x1="${xP90}" y1="${milestoneY - 5}" x2="${xP90}" y2="${milestoneY + 5}" stroke="${C_BLUE}" stroke-width="1.5" stroke-linecap="round" />`;
      // Diamond at P50
      const ds = 6;
      svg += `<polygon points="${xP50},${milestoneY - ds} ${xP50 + ds},${milestoneY} ${xP50},${milestoneY + ds} ${xP50 - ds},${milestoneY}" fill="${C_DARK}" stroke="white" stroke-width="1.5" />`;
      // Version label above the diamond
      svg += `<text x="${xP50}" y="${labelY}" font-family="Nunito Sans, sans-serif" font-size="12" font-weight="700" fill="${C_DARK}" text-anchor="middle">${escapeXml(displayVersion(v))}</text>`;
      // Date below
      svg += `<text x="${xP50}" y="${dateY}" font-family="JetBrains Mono, monospace" font-size="10" fill="${C_MUTED}" text-anchor="middle">${escapeXml(dateLabel)}</text>`;
      // Transparent hit area (last so it captures hover regardless of paint order)
      svg += `<rect x="${hitX}" y="${hitY}" width="${hitW}" height="${hitH}" fill="white" fill-opacity="0" pointer-events="all" />`;
      svg += `</g>`;
    });
  }

  svg += `</svg>`;

  const legend = `
    <div class="legend">
      <span><span class="swatch bar" style="background: ${C_BLUE};"></span>P50 schedule</span>
      <span><span class="swatch bar" style="background: ${C_BLUE_SOFT};"></span>P10–P90 spread</span>
      ${versionKeys.length > 0 ? `<span><span class="swatch milestone-swatch"></span>Release P50 → P90 slip</span>` : ''}
      <span><span class="swatch" style="background: ${C_DARK};"></span>Overall P50</span>
      <span><span class="swatch" style="background: ${C_BLUE};"></span>Overall P80</span>
      <span><span class="swatch" style="background: ${C_PINK};"></span>Overall P90</span>
      <span><span class="swatch" style="background: ${C_GREEN};"></span>Today</span>
      <span><span class="swatch bar" style="background: ${C_NONWORK};"></span>Weekend / bank hol.</span>
    </div>`;

  return `<div class="chart-card">
    <div class="chart-title">Schedule · hover any row for full details</div>
    ${svg}
    ${legend}
  </div>`;
}

function workingDayIndex(date, calendar) {
  if (calendar.length === 0) return null;
  const t = date.getTime();
  for (let i = 0; i < calendar.length; i++) {
    if (calendar[i].getTime() >= t) return i;
  }
  return null;
}

function renderHistogram(r, calendar) {
  // Two input shapes are supported:
  //   - r.overall.all  : raw simulation array (live runs)
  //   - r.overall.bins : { min, max, counts, total } (snapshot exports
  //     pre-bin to keep file size down — the raw array can be 50-200 KB)
  let min, max, nBins, bins, total;
  if (r.overall.bins) {
    ({ min, max, total } = r.overall.bins);
    bins = r.overall.bins.counts;
    nBins = bins.length;
  } else {
    const data = r.overall.all;
    min = Math.min(...data);
    max = Math.max(...data);
    nBins = 24;
    const binW0 = (max - min) / nBins || 1;
    bins = new Array(nBins).fill(0);
    data.forEach(v => {
      const b = Math.min(nBins - 1, Math.floor((v - min) / binW0));
      bins[b]++;
    });
    total = data.length;
  }
  const binW = (max - min) / nBins || 1;
  const maxCount = Math.max(...bins);

  const W = 1040, padL = 28, padR = 24, padT = 64, padB = 50;
  const H = 240;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xb = i => padL + (i / nBins) * innerW;
  const xv = v => padL + ((v - min) / (max - min || 1)) * innerW;

  const C_DARK = "#2b2f3b";
  const C_BLUE = "#005eb8";
  const C_PINK = "#df007d";
  const C_HAIR = "#e5e7eb";
  const C_HAIR_STRONG = "#c7cdd4";
  const C_MUTED = "#7a8090";

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`;

  // Bars
  bins.forEach((c, i) => {
    const x0 = xb(i);
    const x1 = xb(i + 1);
    const h = (c / maxCount) * innerH;
    svg += `<rect x="${x0 + 0.5}" y="${padT + innerH - h}" width="${Math.max(0.5, x1 - x0 - 1)}" height="${h}" fill="${C_BLUE}" opacity="0.85" rx="1" />`;
  });

  // Baseline
  svg += `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="${C_HAIR_STRONG}" stroke-width="1" />`;

  // Percentile lines + stacked labels with leader lines.
  // Width-based collision detection: each label occupies a horizontal range,
  // and labels that overlap in x are pushed onto a higher row.
  const percentiles = [
    { k: "p50", color: C_DARK, label: "P50", dash: "0" },
    { k: "p80", color: C_BLUE, label: "P80", dash: "4,3" },
    { k: "p90", color: C_PINK, label: "P90", dash: "2,3" },
  ].map(p => ({ ...p, x: xv(r.overall[p.k]) }));

  // Three label rows above the chart (closest to chart = row 0)
  const labelRows = [padT - 12, padT - 30, padT - 48];
  // Approximate label width: "P80 · 26 Jun 2026" at 11px mono ≈ 115px
  const labelWidth = 120;
  const labelGap = 8;
  // Sort ascending by x so labels stack consistently left to right
  const sortedByX = [...percentiles].sort((a, b) => a.x - b.x);
  const rowAssign = new Map();
  const placedRanges = [];   // {row, xStart, xEnd}
  sortedByX.forEach(p => {
    const myStart = p.x;
    const myEnd = p.x + labelWidth;
    let row = 0;
    while (row < labelRows.length) {
      const collides = placedRanges.some(pr =>
        pr.row === row &&
        myStart < pr.xEnd + labelGap &&
        myEnd + labelGap > pr.xStart
      );
      if (!collides) break;
      row++;
    }
    if (row >= labelRows.length) row = labelRows.length - 1;
    rowAssign.set(p.k, row);
    placedRanges.push({ row, xStart: myStart, xEnd: myEnd });
  });

  percentiles.forEach(p => {
    const labelY = labelRows[rowAssign.get(p.k)];
    const calIdx = Math.min(calendar.length - 1, Math.max(0, Math.ceil(r.overall[p.k]) - 1));
    const dateStr = calendar[calIdx].toISOString().slice(8, 10) + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][calendar[calIdx].getUTCMonth()];
    // Vertical line on chart
    svg += `<line x1="${p.x}" y1="${padT}" x2="${p.x}" y2="${padT + innerH}" stroke="${p.color}" stroke-width="1" stroke-dasharray="${p.dash}" opacity="0.7" />`;
    // Leader line from chart up to label row
    svg += `<line x1="${p.x}" y1="${padT}" x2="${p.x}" y2="${labelY + 4}" stroke="${p.color}" stroke-width="0.5" opacity="0.5" />`;
    // Label
    svg += `<circle cx="${p.x}" cy="${labelY}" r="2.5" fill="${p.color}" />`;
    svg += `<text x="${p.x + 6}" y="${labelY + 4}" font-family="JetBrains Mono, monospace" font-size="11" fill="${p.color}" font-weight="600">${p.label} · ${dateStr}</text>`;
  });

  // X axis labels (working days from start, with date)
  const tickCount = 6;
  for (let i = 0; i <= tickCount; i++) {
    const f = i / tickCount;
    const v = min + f * (max - min);
    const X = padL + f * innerW;
    const calIdx = Math.min(calendar.length - 1, Math.max(0, Math.ceil(v) - 1));
    const d = calendar[calIdx];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    svg += `<text x="${X}" y="${H - padB + 16}" font-family="JetBrains Mono, monospace" font-size="10" fill="${C_MUTED}" text-anchor="middle">${d.getUTCDate()} ${months[d.getUTCMonth()]}</text>`;
    svg += `<text x="${X}" y="${H - padB + 30}" font-family="JetBrains Mono, monospace" font-size="9" fill="${C_HAIR_STRONG}" text-anchor="middle">${Math.round(v)}d</text>`;
  }

  svg += `</svg>`;

  return `<div class="chart-card">
    <div class="chart-title">Distribution of overall completion · ${total} simulations</div>
    ${svg}
  </div>`;
}

function escapeXml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
}

function renderItemTable(r, calendar) {
  const dateAtEnd = idx => {
    const i = Math.min(calendar.length - 1, Math.max(0, Math.ceil(idx) - 1));
    return calendar[i];
  };
  const dateAtStart = idx => {
    const i = Math.min(calendar.length - 1, Math.max(0, Math.floor(idx)));
    return calendar[i];
  };

  const rows = r.items.map((it, i) => {
    const verCell = it.version ? `<span class="pill version">${escapeHtml(displayVersion(it.version))}</span>` : '<span style="color: var(--muted); font-size: 11px;">—</span>';
    if (!it.estimable) {
      return `<tr class="unscored">
        <td class="num r">${i + 1}</td>
        <td>${escapeHtml(it.name)}</td>
        <td class="c">${verCell}</td>
        <td colspan="5" style="color: var(--warn); font-style: italic; font-size: 12px;">Not estimable — needs T-shirt size and uncertainty</td>
      </tr>`;
    }
    return `<tr>
      <td class="num r">${i + 1}</td>
      <td>${escapeHtml(it.name)}<div style="margin-top:3px;">${uncertaintyPill(it.uncertainty)} <span class="pill">${it.size}</span></div></td>
      <td class="c">${verCell}</td>
      <td class="num">${formatDate(dateAtStart(it.start.p50))}</td>
      <td class="num">${formatDate(dateAtEnd(it.end.p50))}</td>
      <td class="num">${formatDate(dateAtEnd(it.end.p80))}</td>
      <td class="num">${formatDate(dateAtEnd(it.end.p90))}</td>
      <td class="num r">${it.meanDuration.toFixed(1)}</td>
    </tr>`;
  }).join("");

  return `<div class="chart-card" style="padding: 0;">
    <div class="results-table-head">
      <div class="chart-title" style="padding: 0;">Per item</div>
      <div class="table-key">
        <span class="key-prefix">Key</span>
        <span class="pill medium key-pill">Uncertainty</span>
        <span class="pill key-pill">T-shirt size</span>
      </div>
    </div>
    <table class="results-table" style="border: none;">
      <thead>
        <tr>
          <th class="r">#</th>
          <th>Item</th>
          <th class="c">Ver.</th>
          <th>Start (P50)</th>
          <th>End (P50)</th>
          <th>End (P80)</th>
          <th>End (P90)</th>
          <th class="r">Mean dur.</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

  // ============================================================
  // MODULE: snapshot
  // Stakeholder snapshot export: produces a self-contained read-only
  // HTML file frozen at the current forecast. The export inlines
  // monty.css and monty.js into the resulting document and embeds the
  // state + results as base64 JSON in a <script id="monty-snapshot-data">
  // tag, which the boot path (init) detects and uses to hydrate.
  // Reads:  state.*, MONTY_CONFIG (when exporting)
  // Writes: state.* (only when LOADING a snapshot at boot)
  // External deps: fetch (for monty.css/monty.js bodies), DOM, btoa/atob
  // ============================================================

  // Detect a snapshot payload baked into the current page. Called once
  // at boot, before loadState. If found, populates `state` from the
  // payload and sets IS_SNAPSHOT so the rest of the app skips
  // persistence and mutating handlers.
  function detectSnapshot() {
    const tag = document.getElementById('monty-snapshot-data');
    if (!tag) return false;
    try {
      const b64 = (tag.textContent || '').trim();
      if (!b64) return false;
      const json = decodeURIComponent(escape(atob(b64)));
      const payload = JSON.parse(json);
      if (!payload || !payload.state) return false;

      const s = payload.state;
      if (s.items) state.items = s.items;
      if (s.bases) state.bases = { ...DEFAULT_BASES, ...s.bases };
      if (s.uncertaintyProfile) state.uncertaintyProfile = { ...DEFAULT_UNCERTAINTY_PROFILE, ...s.uncertaintyProfile };
      if (s.params) {
        const { lowSpread, ...rest } = s.params;  // strip removed param, matching loadState
        state.params = { ...DEFAULT_PARAMS, ...rest };
      }
      if (s.holidays) state.holidays = s.holidays;
      state.results = payload.results || null;

      IS_SNAPSHOT = true;
      SNAPSHOT_META = payload.meta || {};
      return true;
    } catch (e) {
      // Malformed snapshot — fall through to normal boot. Logging is fine
      // because this only fires on dedicated snapshot files.
      console.error('Monty: failed to decode embedded snapshot:', e);
      return false;
    }
  }

  function formatSnapshotTimestamp(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${dd} ${months[d.getMonth()]} ${d.getFullYear()} at ${hh}:${mm}`;
    } catch (e) { return iso; }
  }

  // Apply review-mode chrome: body class, banner contents, controls
  // summary. Called only when IS_SNAPSHOT is true, after the initial render.
  function applyReviewMode() {
    document.body.classList.add('review-mode');

    const banner = document.getElementById('snapshot-banner');
    if (banner && SNAPSHOT_META) {
      const created = SNAPSHOT_META.createdLocal ||
        (SNAPSHOT_META.createdISO ? formatSnapshotTimestamp(SNAPSHOT_META.createdISO) : '');
      const author = SNAPSHOT_META.author || 'Unknown';
      banner.innerHTML = `
        <span class="snapshot-banner-icon" aria-hidden="true">📌</span>
        <div class="snapshot-banner-body">
          <div class="snapshot-banner-title">${escapeHtml(SNAPSHOT_META.title || 'Snapshot')}</div>
          <div class="snapshot-banner-meta">${escapeHtml(author)} · ${escapeHtml(created)}</div>
        </div>
        <span class="snapshot-banner-pill">Read only</span>
      `;
    }

    const summary = document.getElementById('controlsSummary');
    if (summary) {
      const p = state.params;
      const distLabel = p.distribution === 'uniform' ? 'Uniform' : 'Triangular';
      summary.innerHTML = `
        <div class="controls-summary-item">
          <span class="controls-summary-label">Start date</span>
          <span class="controls-summary-value">${escapeHtml(p.startDate || '—')}</span>
        </div>
        <div class="controls-summary-item">
          <span class="controls-summary-label">Team size</span>
          <span class="controls-summary-value">${p.headcount} FTE</span>
        </div>
        <div class="controls-summary-item">
          <span class="controls-summary-label">Default people / item</span>
          <span class="controls-summary-value">${p.peoplePerJob}</span>
        </div>
        <div class="controls-summary-item">
          <span class="controls-summary-label">Simulations</span>
          <span class="controls-summary-value">${p.simCount}</span>
        </div>
        <div class="controls-summary-item">
          <span class="controls-summary-label">Distribution</span>
          <span class="controls-summary-value">${distLabel}</span>
        </div>
      `;
    }

    // The meta header values that runForecast normally sets — surface the
    // snapshot's own timestamp and sim count instead.
    if (SNAPSHOT_META) {
      const ts = SNAPSHOT_META.createdLocal ||
        (SNAPSHOT_META.createdISO ? formatSnapshotTimestamp(SNAPSHOT_META.createdISO) : '');
      if (ts) document.getElementById('meta-lastrun').textContent = ts;
    }
    if (state.params && state.params.simCount) {
      document.getElementById('meta-sims').textContent = state.params.simCount;
    }
  }

  // Replace the raw simulation array with a 24-bin histogram. The
  // histogram render path accepts either shape; bins keep the snapshot
  // file 30-180 KB smaller.
  function prebinResultsForSnapshot(r) {
    const out = JSON.parse(JSON.stringify(r));
    if (out.overall && Array.isArray(out.overall.all)) {
      const data = out.overall.all;
      const min = Math.min(...data);
      const max = Math.max(...data);
      const nBins = 24;
      const binW = (max - min) / nBins || 1;
      const counts = new Array(nBins).fill(0);
      data.forEach(v => {
        const b = Math.min(nBins - 1, Math.floor((v - min) / binW));
        counts[b]++;
      });
      out.overall.bins = { min, max, counts, total: data.length };
      delete out.overall.all;
    }
    return out;
  }

  function slugify(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'snapshot';
  }

  // base64-encode a JSON string with full Unicode support (item names
  // can contain arbitrary characters). The escape/unescape pair is the
  // standard idiom for utf-8-safe btoa.
  function encodeSnapshotPayload(payload) {
    const json = JSON.stringify(payload);
    return btoa(unescape(encodeURIComponent(json)));
  }

  // Build the self-contained snapshot HTML by cloning the current
  // document and substituting the external CSS/JS references for inline
  // <style> and <script> blocks (with the data tag inserted just before
  // the inlined script so detectSnapshot can find it on load).
  async function buildSnapshotHTML(snapshotB64) {
    let css, js;
    try {
      const [cssRes, jsRes] = await Promise.all([
        fetch('monty.css'),
        fetch('monty.js'),
      ]);
      if (!cssRes.ok) throw new Error('monty.css ' + cssRes.status);
      if (!jsRes.ok) throw new Error('monty.js ' + jsRes.status);
      [css, js] = await Promise.all([cssRes.text(), jsRes.text()]);
    } catch (e) {
      throw new Error("Couldn't load monty.css / monty.js. Snapshot export needs the app to be served (it doesn't work from file:// in Chrome). Try GitHub Pages or any local web server.");
    }

    const root = document.documentElement.cloneNode(true);

    // The export modal lives in the live DOM — strip it from the snapshot.
    const modal = root.querySelector('#snapshotModal');
    if (modal) modal.remove();
    // Banner state is overwritten at boot, but clear it for cleanliness.
    const banner = root.querySelector('#snapshot-banner');
    if (banner) banner.innerHTML = '';

    // Inline the stylesheet.
    root.querySelectorAll('link[rel="stylesheet"][href="monty.css"]').forEach(link => {
      const style = document.createElement('style');
      style.textContent = css;
      link.replaceWith(style);
    });

    // Inline the script and embed the snapshot data tag immediately before it.
    root.querySelectorAll('script[src="monty.js"]').forEach(scr => {
      const dataScript = document.createElement('script');
      dataScript.id = 'monty-snapshot-data';
      dataScript.type = 'application/json';
      dataScript.textContent = snapshotB64;

      const codeScript = document.createElement('script');
      codeScript.textContent = js;

      const parent = scr.parentNode;
      parent.insertBefore(dataScript, scr);
      parent.insertBefore(codeScript, scr);
      parent.removeChild(scr);
    });

    return '<!DOCTYPE html>\n' + root.outerHTML;
  }

  async function exportSnapshot(title, author) {
    // Either re-use the live results, or run a fresh forecast so the
    // snapshot is internally consistent with the inputs being shown.
    if (!state.results) {
      const estimable = state.items.filter(i => i.size && i.uncertainty);
      if (estimable.length === 0) {
        throw new Error("Add at least one item with size and uncertainty before exporting.");
      }
      state.results = monteCarlo(state.items, state.bases, state.uncertaintyProfile, state.params, state.params.simCount);
      state.lastRun = new Date();
    }

    const now = new Date();
    const meta = {
      title: (title || '').trim(),
      author: (author || '').trim(),
      createdISO: now.toISOString(),
      createdLocal: formatSnapshotTimestamp(now.toISOString()),
    };

    const payload = {
      schemaVersion: 1,
      meta,
      state: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        items: state.items,
        bases: state.bases,
        uncertaintyProfile: state.uncertaintyProfile,
        params: state.params,
        holidays: state.holidays,
      },
      results: prebinResultsForSnapshot(state.results),
    };

    const b64 = encodeSnapshotPayload(payload);
    const html = await buildSnapshotHTML(b64);

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monty-snapshot-${todayISO()}-${slugify(meta.title)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openSnapshotModal() {
    const modal = document.getElementById('snapshotModal');
    if (!modal) return;
    document.getElementById('snapshotTitle').value = '';
    document.getElementById('snapshotAuthor').value = 'Edwin Clark';
    document.getElementById('snapshotError').textContent = '';
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('snapshotTitle').focus(), 30);
  }

  function closeSnapshotModal() {
    const modal = document.getElementById('snapshotModal');
    if (modal) modal.style.display = 'none';
  }

  // ============================================================
  // MODULE: events
  // Wires DOM events to state mutations. Called once at app init.
  // Each handler typically: mutates state, calls saveState(), and
  // re-renders any affected UI.
  // Reads:  state.* (current values)
  // Writes: state.* (via user input)
  // External deps: DOM
  // ============================================================

function attachHandlers() {
  // Param inputs
  $("startDate").addEventListener("change", e => {
    state.params.startDate = e.target.value;
    saveState();
  });
  $("headcount").addEventListener("change", e => {
    state.params.headcount = parseInt(e.target.value) || 1;
    renderControls();
    saveState();
  });
  $("peoplePerJob").addEventListener("change", e => {
    state.params.peoplePerJob = parseInt(e.target.value) || 1;
    renderControls();
    renderItems();  // placeholder for People column reflects new default
    saveState();
  });
  $("simCount").addEventListener("change", e => {
    state.params.simCount = parseInt(e.target.value) || 1000;
    saveState();
  });
  $("distribution").addEventListener("change", e => {
    state.params.distribution = e.target.value;
    saveState();
    renderProfileWarning();  // re-evaluate inconsistency
    renderModelIntro();
  });
  $("profilePreset").addEventListener("change", e => {
    const choice = e.target.value;
    if (choice === "asymmetric") {
      state.uncertaintyProfile = structuredClone(PROFILE_ASYMMETRIC);
    } else if (choice === "symmetric") {
      state.uncertaintyProfile = structuredClone(PROFILE_SYMMETRIC);
    }
    // "custom" is informational only — no change to current profile
    saveState();
    renderProfile();
    renderRanges();
    renderProfileWarning();
    renderProfilePresetSelect();
    renderModelIntro();
  });
  $("parallelismAlpha").addEventListener("input", e => {
    state.params.parallelismAlpha = parseInt(e.target.value) / 100;
    renderParallelism();
  });
  $("parallelismAlpha").addEventListener("change", e => {
    state.params.parallelismAlpha = parseInt(e.target.value) / 100;
    saveState();
  });

  // Run
  $("runBtn").addEventListener("click", () => {
    runForecast();
  });

  // Items
  $("addItemBtn").addEventListener("click", () => {
    state.items.push({ name: "New item", uncertainty: "", size: "", peopleNeeded: null, notes: "" });
    saveState();
    renderItems();
    renderControls();
  });

  // CSV import
  $("importBtn").addEventListener("click", () => {
    const box = $("csv-import-box");
    box.style.display = box.style.display === "none" ? "block" : "none";
  });
  $("csvCancel").addEventListener("click", () => {
    $("csv-import-box").style.display = "none";
    $("csvText").value = "";
  });
  $("csvApply").addEventListener("click", () => {
    const text = $("csvText").value;
    if (!text.trim()) return;
    const items = importCSV(text);
    if (items.length > 0) {
      state.items = items;
      saveState();
      renderItems();
      renderControls();
      $("csv-import-box").style.display = "none";
      $("csvText").value = "";
    } else {
      alert("Couldn't parse any items from that CSV. Check the column names.");
    }
  });
  $("csvFile").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $("csvText").value = ev.target.result;
    };
    reader.readAsText(file);
  });

  // Holidays
  $("holidaysText").addEventListener("change", e => {
    state.holidays = e.target.value.split("\n").map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
    saveState();
  });

  // State export/import
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      items: state.items,
      bases: state.bases,
      uncertaintyProfile: state.uncertaintyProfile,
      params: state.params,
      holidays: state.holidays,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monty-forecast-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $("importStateBtn").addEventListener("click", () => $("stateFile").click());
  $("stateFile").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const obj = JSON.parse(ev.target.result);
        const importedVersion = obj.schemaVersion || 1;
        if (obj.items) state.items = obj.items;
        if (obj.bases) {
          state.bases = { ...DEFAULT_BASES, ...obj.bases };
        }
        if (obj.uncertaintyProfile) state.uncertaintyProfile = { ...DEFAULT_UNCERTAINTY_PROFILE, ...obj.uncertaintyProfile };
        if (obj.params) {
          const { lowSpread, ...rest } = obj.params;
          state.params = { ...DEFAULT_PARAMS, ...rest };
        }
        if (obj.holidays) state.holidays = obj.holidays;
        saveState();
        render();
      } catch (err) {
        alert("Failed to read JSON: " + err.message);
      }
    };
    reader.readAsText(file);
  });
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("Reset everything to defaults? Saved state will be cleared.")) return;
    state.items = structuredClone(DEFAULT_ITEMS);
    state.bases = structuredClone(DEFAULT_BASES);
    state.uncertaintyProfile = structuredClone(DEFAULT_UNCERTAINTY_PROFILE);
    state.params = structuredClone(DEFAULT_PARAMS);
    state.holidays = [...DEFAULT_HOLIDAYS];
    state.results = null;
    saveState();
    render();
  });

  // Stakeholder snapshot export
  $("exportSnapshotBtn").addEventListener("click", openSnapshotModal);
  $("snapshotCancel").addEventListener("click", closeSnapshotModal);
  $("snapshotConfirm").addEventListener("click", async () => {
    const title = $("snapshotTitle").value.trim();
    const author = $("snapshotAuthor").value.trim() || "Edwin Clark";
    if (!title) {
      $("snapshotError").textContent = "Title is required.";
      return;
    }
    const btn = $("snapshotConfirm");
    btn.disabled = true;
    btn.textContent = "Exporting…";
    $("snapshotError").textContent = "";
    try {
      await exportSnapshot(title, author);
      closeSnapshotModal();
    } catch (e) {
      $("snapshotError").textContent = e.message || String(e);
    } finally {
      btn.disabled = false;
      btn.textContent = "Export";
    }
  });
  // Click outside the card closes the modal.
  $("snapshotModal").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeSnapshotModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("snapshotModal").style.display !== "none") {
      closeSnapshotModal();
    }
  });
}

  // ============================================================
  // MODULE: app (orchestration)
  // Top-level entry points: runForecast (do a simulation),
  // render (refresh all UI from state), init (boot sequence).
  // Reads/Writes: state.* and DOM
  // ============================================================

function runForecast() {
  const btn = $("runBtn");
  btn.disabled = true;
  btn.textContent = "Running…";
  // Use setTimeout to let UI update before blocking
  setTimeout(() => {
    try {
      const estimable = state.items.filter(i => i.size && i.uncertainty);
      if (estimable.length === 0) {
        alert("No estimable items. Add T-shirt size and uncertainty to at least one row.");
        return;
      }
      state.results = monteCarlo(state.items, state.bases, state.uncertaintyProfile, state.params, state.params.simCount);
      state.lastRun = new Date();
      $("meta-lastrun").textContent = state.lastRun.toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' });
      $("meta-sims").textContent = state.params.simCount;
      renderResults();
    } finally {
      btn.disabled = false;
      btn.textContent = "Run forecast";
    }
  }, 10);
}

function render() {
  renderControls();
  renderItems();
  renderDurationModel();
  renderResults();
}

  // Expose a single global entry point. Anything outside this IIFE that needs
  // to call into Monty (e.g. an inline event handler in HTML, future host
  // pages) goes through window.Monty rather than reaching into internals.
  // Future features (snapshot export, history, actuals) add more methods here.
  window.Monty = {
    run: runForecast,
    render: render,
    state: state,           // exposed read-mostly; do not mutate from outside
    config: MONTY_CONFIG,
    exportSnapshot,         // programmatic snapshot export
    isSnapshot: () => IS_SNAPSHOT,
  };

  // Boot sequence:
  //   1. detectSnapshot() — if the page contains an embedded snapshot,
  //      hydrate state from it and skip persistence + event wiring.
  //   2. otherwise loadState() from localStorage and attachHandlers()
  //      as normal.
  //   3. render() the UI from state.
  //   4. applyReviewMode() if we're in snapshot mode (adds body class,
  //      banner, controls summary).
  // The async wrapper is so loadState (which awaits window.storage)
  // can complete before first render.
  (async function init() {
    if (!detectSnapshot()) {
      await loadState();
      attachHandlers();
    }
    render();
    if (IS_SNAPSHOT) {
      applyReviewMode();
    }
  })();

})();  // end outer IIFE
