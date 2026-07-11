// Determinism smoke: the sim is a pure function of (initial save, clock deltas).
//
// Twin fresh boots play the identical scenario and must match each other AND
// the committed golden — per-loop records and full save blobs byte-identical.
// The golden pins the engine's behavior at defaults: any fork change that
// perturbs vanilla simulation (the byte-inert requirement) fails this test.
//
// The tick/steps assertions are load-bearing: a harness once reported
// "reproducible: YES" while executing ZERO ticks (the tick threw, the error
// was swallowed, and two identical INITIAL states hashed equal). Never compare
// hashes without also asserting work happened.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, playOpening, getSaveBlob } from "./harness.mjs";

const GOLDEN = JSON.parse(fs.readFileSync(new URL("./goldens/opening-5loops.json", import.meta.url), "utf8"));

async function freshRun(label) {
	const H = await boot({ label });
	const records = await playOpening(H, { loops: 5 });
	const blob = await getSaveBlob(H);
	const errors = H.jsdomErrors.slice();
	H.close();
	return { records, blob, errors };
}

test("twin fresh runs are bit-exact and match the committed golden", async () => {
	const a = await freshRun("run A");
	const b = await freshRun("run B");

	// Work actually happened (the zero-ticks trap).
	const totalSteps = a.records.reduce((s, r) => s + r.steps, 0);
	const totalSimMs = a.records.reduce((s, r) => s + r.queueTimeMs, 0);
	assert.ok(a.records.length === 5, `5 loops must complete (got ${a.records.length})`);
	assert.ok(totalSteps > 100, `tick counter must advance (${totalSteps} steps)`);
	assert.ok(totalSimMs > 15000, `simulated time must accumulate (${totalSimMs}ms)`);
	assert.equal(a.records[4].zoneManaGain, 0.5, "mana rock mined every loop (manaGain 0.5 after loop 5)");
	assert.deepEqual(a.errors, [], "no jsdom errors during play");

	// Twin-run determinism.
	assert.deepEqual(a.records, b.records, "per-loop records must be identical across runs");
	assert.equal(a.blob, b.blob, "full save blobs must be byte-identical across runs");

	// Golden: pins vanilla behavior at defaults (byte-inert guard for fork mods).
	assert.deepEqual(a.records, GOLDEN.records, "records must match the committed golden");
	assert.equal(a.blob, GOLDEN.saveBlob, "save blob must match the committed golden byte-exactly");
});
