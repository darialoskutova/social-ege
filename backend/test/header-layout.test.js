"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const cabinetCss = fs.readFileSync(path.join(projectRoot, "cabinet.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

test("cabinet sticky header keeps fixed geometry without Safari compositor promotion", () => {
  assert.match(cabinetCss, /--cabinet-header-height:\s*84px/);
  assert.match(cabinetCss, /#appView \.sidebar\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?height:\s*calc\(var\(--cabinet-header-height\)/);
  assert.match(cabinetCss, /#appView \.sidebar\s*\{[\s\S]*?min-height:\s*calc\(var\(--cabinet-header-height\)/);
  assert.match(cabinetCss, /#appView \.sidebar\s*\{[\s\S]*?max-height:\s*calc\(var\(--cabinet-header-height\)/);
  assert.doesNotMatch(cabinetCss, /translate3d\s*\(/i);
  assert.doesNotMatch(cabinetCss, /will-change:\s*transform/i);
  assert.doesNotMatch(cabinetCss, /backface-visibility:\s*hidden/i);
});

test("session restoration does not remove all views from layout before reveal", () => {
  const checkingRule = indexHtml.match(/html\.auth-checking \.view,[\s\S]*?\}/)?.[0] || "";
  assert.match(checkingRule, /visibility:\s*hidden\s*!important/);
  assert.doesNotMatch(checkingRule, /display:\s*none/);
  assert.match(indexHtml, /cabinet\.css\?v=20261008-sticky-stable/);
});

test("cabinet header geometry is not recalculated by a scroll listener", () => {
  assert.doesNotMatch(indexHtml, /addEventListener\(\s*["']scroll["']/);
  assert.doesNotMatch(indexHtml, /onscroll\s*=/);
});
