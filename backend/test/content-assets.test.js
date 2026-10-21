"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexText = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("every CMS-seeded section plan exists as a readable PDF", () => {
  const service = require("../materials/service");
  const plans = service.legacySeeds().filter((item) => item.type === "section_plan");
  assert.equal(plans.length, 4);
  assert.equal(indexText.includes("data-section-plan="), false);
  assert.match(indexText, /data-managed-library/);

  for (const { sectionId: section, legacyPath: href } of plans) {
    assert.equal(href, href.normalize("NFC"), `${section} path must use NFC`);
    assert.equal(path.isAbsolute(href), false);
    assert.equal(href.split("/").includes(".."), false);
    const file = path.join(root, href);
    assert.ok(fs.existsSync(file), `${href} exists`);
    assert.equal(fs.readFileSync(file).subarray(0, 4).toString("ascii"), "%PDF");
  }
});

test("landing keeps separate production photos for hero and about", () => {
  assert.match(indexText, /class="hero-photo"[\s\S]*?src="textbook\.webp"/);
  assert.match(indexText, /src="assets\/landing\/daria\.png"[\s\S]*?class="hero-photo"/);
  assert.match(indexText, /class="about-photo-paper"[\s\S]*?src="assets\/landing\/dasha2\.png"/);
  assert.ok(fs.existsSync(path.join(root, "assets/landing/daria.png")));
  assert.ok(fs.existsSync(path.join(root, "assets/landing/dasha2.png")));
});
