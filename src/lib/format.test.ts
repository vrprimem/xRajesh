import assert from "node:assert/strict";
import { test } from "node:test";
import { noun } from "./format.ts";

test("one carton, two cartons", () => {
  assert.equal(noun(1, "carton"), "carton");
  assert.equal(noun(0, "carton"), "cartons");
  assert.equal(noun(2, "carton"), "cartons");
  assert.equal(noun(1, "dispatch", "dispatches"), "dispatch");
  assert.equal(noun(3, "dispatch", "dispatches"), "dispatches");
});
