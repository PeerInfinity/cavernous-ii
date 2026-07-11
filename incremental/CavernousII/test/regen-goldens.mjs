// Regenerate test/goldens/opening-5loops.json from the current build.
//
// Run: node test/regen-goldens.mjs
//
// ONLY regenerate when vanilla behavior is INTENTIONALLY changed (e.g. an
// upstream merge). Fork mods at default settings must NOT need a regen — if
// they do, they are not byte-inert and determinism.test.mjs is doing its job.

import fs from "node:fs";
import { boot, playOpening, getSaveBlob } from "./harness.mjs";

const H = await boot({ label: "golden" });
const records = await playOpening(H, { loops: 5 });
const saveBlob = await getSaveBlob(H);
if (H.jsdomErrors.length) {
	console.error("jsdom errors — refusing to write golden:", H.jsdomErrors);
	process.exit(1);
}
H.close();

const out = new URL("./goldens/opening-5loops.json", import.meta.url);
fs.mkdirSync(new URL("./goldens/", import.meta.url), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ records, saveBlob }, null, "\t") + "\n");
console.log(`wrote ${out.pathname} (${records.length} loops, blob ${saveBlob.length} chars)`);
