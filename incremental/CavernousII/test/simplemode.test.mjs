// Simple mode (fork): machine grants a Boost instead of a clone; one body
// does the work of E = clones.length + boostCount bodies.
//
// Byte-inertness at defaults is NOT tested here — that is exactly what
// determinism.test.mjs's committed golden proves (it was generated before the
// simple-mode code existed and must keep passing unchanged).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, runOneLoop, getSaveBlob, decompressSave } from "./harness.mjs";

const GOLDEN = JSON.parse(fs.readFileSync(new URL("./goldens/opening-5loops.json", import.meta.url), "utf8"));

test("machine grant: boost instead of clone, cost curve counts E", async () => {
	const H = await boot({ label: "grant" });
	H.G("toggleSimpleMode()");
	assert.equal(H.G("simpleMode"), true);
	// Drive the grant leg directly (completeActivateMachine calls exactly this).
	H.G("realms[0].activateMachine()");
	assert.equal(H.G("clones").length, 1, "no clone is added in simple mode");
	assert.equal(H.G("boostCount"), 1, "the machine grants a boost instead");
	assert.equal(H.G("realms[0].getNextActivateAmount()"), 10,
		"machine cost follows the effective count (5*2^(n-1) with n=E=2)");
	H.close();
});

test("boost=1 (E=2): same queue takes ~half the game time, banks the same XP", async () => {
	const H = await boot({ label: "boosted" });
	H.G("toggleSimpleMode()");
	H.win.eval("boostCount = 1");
	H.G("zones")[0].queues[0].fromString("RDDT");
	const rec = runOneLoop(H, { saveOnReset: false });

	const golden = GOLDEN.records[0]; // unboosted loop 1 of the same queue
	assert.equal(rec.zoneManaGain, 0.1, "the mana rock is still mined");
	assert.ok(rec.queueTimeMs < 0.65 * golden.queueTimeMs,
		`boosted loop must be ~2x faster (${rec.queueTimeMs}ms vs unboosted ${golden.queueTimeMs}ms)`);
	// XP parity: E x gain rate over 1/E the time = the same XP per work done.
	const xpRatio = rec.miningBase / golden.miningBase;
	assert.ok(Math.abs(xpRatio - 1) < 0.02,
		`Mining XP per work must match unboosted play (ratio ${xpRatio.toFixed(4)})`);
	H.close();
});

test("simple-mode state survives save/load; fields absent from vanilla saves", async () => {
	const H1 = await boot({ label: "sm-save" });
	// Vanilla save first: no fork fields.
	const vanillaBlob = await getSaveBlob(H1);
	const vanilla = JSON.parse(decompressSave(H1, vanillaBlob));
	assert.ok(!("simpleMode" in vanilla.cloneData) && !("boost" in vanilla.cloneData),
		"vanilla saves must not gain fork fields");

	H1.G("toggleSimpleMode()");
	H1.G("realms[0].activateMachine()");
	const blob = await getSaveBlob(H1);
	const saved = JSON.parse(decompressSave(H1, blob));
	assert.equal(saved.cloneData.simpleMode, true);
	assert.equal(saved.cloneData.boost, 1);
	const clockAtSave = H1.clock.now;
	H1.close();

	const H2 = await boot({ seedSave: blob, startClock: clockAtSave, label: "sm-reload" });
	assert.equal(H2.G("simpleMode"), true, "simpleMode survives the round-trip");
	assert.equal(H2.G("boostCount"), 1, "boostCount survives the round-trip");
	assert.equal(H2.G("clones").length, 1);
	H2.close();
});
