import assert from "node:assert/strict";
import { test } from "node:test";
import { matchPhotoFiles, photoSrc, PHOTO_FILE, plainName } from "./photos.ts";

const TARGETS = [
  { code: "150-KITCHEN", names: ["Kitchen Cleaner Spray 500ml"] },
  { code: "150-SCRATCH BOTTLE", names: ["Scratch Remover Bottle 150ml", "Scratch 150ml"] },
  { code: "160-RAT", names: ["Rat Repellent Spray 300ml"] },
];

test("photo files match a master SKU by its code or by a linked product's name, in any case", () => {
  const m = matchPhotoFiles(["150-kitchen.JPG", "Scratch 150ml.png", "rat_repellent_spray_300ml.webp", "holiday.jpg", "150-SCRATCH BOTTLE.jpeg"], TARGETS);
  assert.deepEqual(
    m.map((x) => [x.file, x.code, x.why]),
    [
      ["150-kitchen.JPG", "150-KITCHEN", "code"],
      ["Scratch 150ml.png", "150-SCRATCH BOTTLE", "name"],
      ["rat_repellent_spray_300ml.webp", "160-RAT", "name"],
      ["holiday.jpg", null, "none"],
      ["150-SCRATCH BOTTLE.jpeg", "150-SCRATCH BOTTLE", "twice"],
    ],
  );
});

test("names compare without extension, case or extra spaces", () => {
  assert.equal(plainName("  Kitchen__Cleaner  Spray.PNG "), "kitchen cleaner spray");
  assert.equal(plainName("150-KITCHEN.jpg"), "150-kitchen");
});

test("a photo file is a uuid .jpg, served without the extension", () => {
  const f = "0f8c3a9e-1b2d-4c5e-8f90-a1b2c3d4e5f6.jpg";
  assert.ok(PHOTO_FILE.test(f));
  assert.ok(!PHOTO_FILE.test("../secret.jpg"));
  assert.equal(photoSrc(f), "/photos/0f8c3a9e-1b2d-4c5e-8f90-a1b2c3d4e5f6");
});
