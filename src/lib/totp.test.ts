import assert from "node:assert/strict";
import { test } from "node:test";
import { base32, groupKey, keyFromHex, otpauthUri, TOTP_ISSUER } from "./totp.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

test("base32 matches the RFC 4648 test vectors (without padding)", () => {
  assert.equal(base32(bytes("")), "");
  assert.equal(base32(bytes("f")), "MY");
  assert.equal(base32(bytes("fo")), "MZXQ");
  assert.equal(base32(bytes("foo")), "MZXW6");
  assert.equal(base32(bytes("foob")), "MZXW6YQ");
  assert.equal(base32(bytes("fooba")), "MZXW6YTB");
  assert.equal(base32(bytes("foobar")), "MZXW6YTBOI");
});

test("the database's hex secret becomes the key apps know: RFC 6238's test secret", () => {
  // "12345678901234567890" in hex.
  assert.equal(keyFromHex("3132333435363738393031323334353637383930"), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.throws(() => keyFromHex("xyz"));
  assert.throws(() => keyFromHex("abc"));
});

test("the key is grouped by 4 for typing, and the QR address names the portal", () => {
  assert.equal(groupKey("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), "GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ");
  const raw = otpauthUri("GEZDGNBV", "owner@example.test");
  assert.ok(raw.includes("issuer=VRPRIME%20Supplier%20Portal") && !raw.includes("+"), "spaces as %20: " + raw);
  const uri = new URL(raw);
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.host, "totp");
  assert.equal(decodeURIComponent(uri.pathname.slice(1)), `${TOTP_ISSUER}:owner@example.test`);
  assert.equal(uri.searchParams.get("secret"), "GEZDGNBV");
  assert.equal(uri.searchParams.get("issuer"), TOTP_ISSUER);
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
  assert.equal(uri.searchParams.get("algorithm"), "SHA1");
});
