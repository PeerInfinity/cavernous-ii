// Save/load round-trip from code: play, save, boot a fresh jsdom seeded with
// the blob, and verify all persistent state survives — then prove the reloaded
// instance keeps playing correctly.
//
// timeBanked is compared with tolerance: the game's own load() computes
// `+saved.timeBanked + Date.now() - lastAction`, and adding ~ms of banked time
// to an epoch-scale timestamp truncates the low mantissa bits (observed drift
// ~9e-6 ms). Game-inherent, not a harness artifact.

import test from "node:test";
import assert from "node:assert/strict";
import { boot, playOpening, runOneLoop, getSaveBlob, snapshot } from "./harness.mjs";

test("save/load round-trip preserves persistent state and the game keeps playing", async () => {
	const H1 = await boot({ label: "original" });
	await playOpening(H1, { loops: 5 });
	const blob = await getSaveBlob(H1);
	const snapA = snapshot(H1);
	const clockAtSave = H1.clock.now;
	H1.close();

	const H2 = await boot({ seedSave: blob, startClock: clockAtSave, label: "reload" });
	const snapB = snapshot(H2);

	const persist = ({ timeBanked, ...rest }) => rest;
	assert.deepEqual(persist(snapB), persist(snapA), "persistent state must survive the round-trip exactly");

	const bankDrift = Math.abs(snapA.timeBanked - snapB.timeBanked);
	assert.ok(bankDrift < 0.001, `timeBanked must survive within float-quantization tolerance (drift ${bankDrift}ms)`);

	// The reloaded instance continues on schedule: loop 6 mines the rock again.
	const extra = runOneLoop(H2, { saveOnReset: false });
	assert.equal(extra.zoneManaGain, 0.6, `reloaded game continues (manaGain 0.5 -> ${extra.zoneManaGain})`);
	assert.deepEqual(H2.jsdomErrors, [], "no jsdom errors during reload");
	H2.close();
});
