import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("daemon example remains safely in dry-run mode", async () => {
  const config = JSON.parse(await readFile(new URL("../config.example.json", import.meta.url), "utf8"));
  assert.equal(config.dryRun, true);
  assert.equal(config.autoSellEnabled, false);
  assert.equal(config.network, "mainnet");
});
