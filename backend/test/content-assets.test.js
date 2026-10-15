"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexText = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("every published section plan exists as a readable PDF", () => {
  const links = [...indexText.matchAll(/data-section-plan="([^"]+)" href="([^"]+)"/g)]
    .map((match) => ({ section: match[1], href: match[2] }));
  assert.deepEqual(links, [
    { section: "social-relations", href: "доп материалы/Планы по социологии из ЕГЭ.pdf" },
    { section: "economics", href: "доп материалы/Планы по экономике.pdf" },
    { section: "politics", href: "доп материалы/Планы по политике.pdf" },
    { section: "law", href: "доп материалы/Планы по праву ЕГЭ.pdf" },
  ]);

  for (const { section, href } of links) {
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
