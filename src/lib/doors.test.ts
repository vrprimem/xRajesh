import assert from "node:assert/strict";
import { test } from "node:test";
import { DOOR_PATH, doorFor, doorForPath, wrongDoorMessage } from "./doors.ts";

test("supplier logins use the supplier door; VRPRIME owner and admin use the admin door", () => {
  assert.equal(doorFor("supplier_owner"), "supplier");
  assert.equal(doorFor("supplier_scanner"), "supplier");
  assert.equal(doorFor("owner"), "admin");
  assert.equal(doorFor("admin"), "admin");
});

test("each door has its own page, and the admin page is still under /login (open to signed-out visitors)", () => {
  assert.equal(DOOR_PATH.supplier, "/login");
  assert.equal(DOOR_PATH.admin, "/login/admin");
  assert.ok(DOOR_PATH.admin.startsWith(`${DOOR_PATH.supplier}/`));
});

test("a signed-out visitor to VRPRIME's pages is sent to the admin door, to anything else the supplier door", () => {
  assert.equal(doorForPath("/suppliers"), "admin");
  assert.equal(doorForPath("/suppliers/abc/dispatches/new"), "admin");
  assert.equal(doorForPath("/supplier"), "supplier");
  assert.equal(doorForPath("/supplier/dispatches"), "supplier");
  assert.equal(doorForPath("/suppliersx"), "supplier");
  assert.equal(doorForPath("/"), "supplier");
});

test("the wrong-door message points to the other door", () => {
  assert.match(wrongDoorMessage("supplier"), /admin account.*Admin sign-in/);
  assert.match(wrongDoorMessage("admin"), /supplier account.*Supplier sign-in/);
});
