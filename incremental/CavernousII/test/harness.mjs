// test/harness.mjs — headless Cavernous II boot for tests (jsdom, controlled
// clock, no browser). Promoted from the 2026-07-10 probe experiment; the full
// evidence trail lives in the Archipelago-CC planning docs.
//
// Boot facts this encodes (each one bites if forgotten):
//   - scripts MUST load as real <script> elements in index.html order, NOT via
//     window.eval — cross-file top-level let/const only share scope as script
//     elements;
//   - the <body> templates in index.html are load-bearing (classes clone them
//     and throw if missing) — only the <script src> tags are stripped;
//   - jsdom lacks innerText; main.js:3 READS #version's innerText at module
//     load and boot throws without the prototype shim;
//   - ?messages=disabled is required or story popups silently halt the loop
//     (any undismissed message banks time forever);
//   - Date.now is the game's ONLY nondeterminism source — stub it with a
//     counter BEFORE scripts load, and capture the 60fps setInterval callback
//     (it's an anonymous closure, unreachable otherwise);
//   - boot is setTimeout-staged (load() at +15ms) — keep real timers, wait
//     ~80ms of real time, and seed localStorage BEFORE scripts load;
//   - top-level let/const (settings, zones, clones, save, gameStatus, ...) are
//     NOT window properties — read them via in-realm eval (the G helper).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

export const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Exact load order from index.html (lz-string first, then game scripts).
// dist/script/spells.js and saved_queues.js exist but index.html does not load
// them; saved_queues.js is also the only file with Math.random — keep unloaded.
export const SCRIPT_ORDER = [
	"dependencies/lz-string/lz-string.min.js",
	"dist/script/util.js", "dist/script/icons.js", "dist/script/settings.js",
	"dist/script/stats.js", "dist/script/stuff.js", "dist/script/actions.js",
	"dist/script/creatures.js", "dist/script/location_types.js", "dist/script/locations.js",
	"dist/script/realms.js", "dist/script/zone_routes.js", "dist/script/queues.js",
	"dist/script/zones.js", "dist/script/map.js", "dist/script/routes.js",
	"dist/script/grind_routes.js", "dist/script/highlights.js", "dist/script/runes.js",
	"dist/script/clones.js", "dist/script/loop_log.js", "dist/script/messages.js",
	"dist/script/main.js", "dist/script/test_util.js", "dist/script/test.js",
];

const scriptCache = new Map();
function readScript(rel) {
	if (!scriptCache.has(rel)) scriptCache.set(rel, fs.readFileSync(path.join(GAME_DIR, rel), "utf8"));
	return scriptCache.get(rel);
}

export const START_CLOCK = 1750000000000; // arbitrary fixed epoch ms

export async function boot({ seedSave = null, startClock = START_CLOCK, label = "boot", urlParams = "" } = {}) {
	let html = fs.readFileSync(path.join(GAME_DIR, "index.html"), "utf8");
	html = html.replace(/<script[^>]*\bsrc="[^"]*"[^>]*><\/script>\s*/g, "");

	const consoleLines = [];
	const jsdomErrors = [];
	const virtualConsole = new VirtualConsole();
	for (const m of ["log", "warn", "error", "info"]) {
		virtualConsole.on(m, (...args) => consoleLines.push(`[${m}] ${args.join(" ")}`));
	}
	virtualConsole.on("jsdomError", e => jsdomErrors.push(String(e?.detail?.stack || e?.stack || e)));

	const dom = new JSDOM(html, {
		url: `http://localhost:8000/?messages=disabled${urlParams ? "&" + urlParams : ""}`,
		runScripts: "dangerously",
		pretendToBeVisual: true,
		virtualConsole,
	});
	const win = dom.window;

	// ---- stubs (BEFORE game scripts run) ----
	const clock = { now: startClock };
	win.Date.now = () => clock.now;

	const intervals = [];
	win.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return 1; };

	if (!Object.getOwnPropertyDescriptor(win.HTMLElement.prototype, "innerText")) {
		Object.defineProperty(win.HTMLElement.prototype, "innerText", {
			get() { return this.textContent; },
			set(v) { this.textContent = v; },
			configurable: true,
		});
	}

	Object.defineProperty(win.navigator, "clipboard", {
		value: { writeText: async () => {} }, configurable: true,
	});
	win.alert = () => {};
	win.confirm = () => true;
	win.prompt = () => null;

	if (seedSave !== null) win.localStorage["saveGameII"] = seedSave;

	for (const rel of SCRIPT_ORDER) {
		const el = win.document.createElement("script");
		el.textContent = readScript(rel);
		win.document.head.appendChild(el); // executes synchronously
	}

	// Let the game's startup timers fire on the real event loop (load() at +15ms,
	// Zone/Realm .index fixups at +0, keybindings at +10ms).
	await new Promise(r => setTimeout(r, 80));

	const mainLoopEntry = intervals.find(i => i.ms === Math.floor(1000 / 60));
	if (!mainLoopEntry) throw new Error(`${label}: main loop was not captured from setInterval`);

	const G = expr => win.eval(expr);

	return {
		dom, win, clock, G,
		mainLoop: mainLoopEntry.fn,
		consoleLines, jsdomErrors, label,
		close: () => win.close(),
	};
}

// Advance the controlled clock and invoke the captured main loop once.
export function step(H, ms) {
	H.clock.now += ms;
	H.mainLoop();
}

// Run one in-game loop: tick until the game pauses itself (queue exhausted
// under AutoRestart.WaitAny, or mana hit 0), record, then resetLoop().
// `probe` (optional) is evaluated at pause time, BEFORE resetLoop wipes
// per-loop state.
export function runOneLoop(H, { stepMs = 100, maxSteps = 20000, probe = null, saveOnReset = true } = {}) {
	const { G, win } = H;
	G("settings").running = true;
	let steps = 0;
	while (steps++ < maxSteps) {
		step(H, stepMs);
		if (G("gameStatus").paused) break;
	}
	if (steps >= maxSteps) throw new Error("loop never paused — runaway");
	const mana = win.getStat("Mana");
	const rec = {
		steps,
		queueTimeMs: +G("queueTime").toFixed(3),
		manaCurrentAtEnd: +mana.current.toFixed(4),
		manaBaseAtEnd: +mana.base.toFixed(4),
		zoneManaGain: G("zones")[0].manaGain,
		miningBase: +win.getStat("Mining").base.toFixed(6),
		speedBase: +win.getStat("Speed").base.toFixed(6),
		clone: { x: G("clones")[0].x, y: G("clones")[0].y },
		endedBecause: mana.current === 0 ? "out of mana" : "queue done/stuck",
		// (probe key added only when requested — records must round-trip through
		// JSON goldens, and JSON.stringify drops undefined values.)
		...(probe ? { probe: probe(H) } : {}),
	};
	win.resetLoop(false, saveOnReset);
	return rec;
}

// Persistent-state snapshot for determinism / round-trip checks. timeBanked is
// reported separately: the game's own load() quantizes it ~9e-6ms (main.js adds
// banked ms to an epoch-scale timestamp before subtracting) — compare that one
// field with tolerance.
export function snapshot(H) {
	const { G } = H;
	const zones = G("zones");
	const rock = zones[0].getMapLocation(1, 2, true);
	// JSON round-trip: values read out of the jsdom realm carry the REALM's
	// prototypes (realm Array !== Node Array), which fails deepStrictEqual
	// between two boots even when contents match.
	return JSON.parse(JSON.stringify({
		stats: G("stats").map(s => ({ name: s.name, base: s.base })),
		cloneCount: G("clones").length,
		zone0ManaGain: zones[0].manaGain,
		rockPriorCompletions: rock ? rock.priorCompletions : null,
		queue0: zones[0].queues[0].toString(),
		currentZone: G("currentZone"),
		currentRealm: G("currentRealm"),
		timeBanked: G("timeBanked"),
	}));
}

export async function getSaveBlob(H) {
	await H.G("save()"); // save is `let save = async function ...` — not a window prop
	return H.win.localStorage["saveGameII"];
}

export function decompressSave(H, blob) {
	return H.win.eval(`LZString.decompressFromBase64(${JSON.stringify(blob)})`);
}

// The canonical zone-1 opening scenario: N loops of "RDDT" (mine right, down,
// down into the mana rock at rel (1,2), then repeat-collect mana). Used by the
// determinism golden.
export async function playOpening(H, { loops = 5, stepMs = 100 } = {}) {
	H.G("zones")[0].queues[0].fromString("RDDT");
	const loopRecords = [];
	for (let i = 0; i < loops; i++) {
		loopRecords.push(runOneLoop(H, { stepMs }));
		// Yield so the game's queued zero-delay setTimeouts (drawProgress etc.) flush.
		await new Promise(r => setTimeout(r, 5));
	}
	return loopRecords;
}
