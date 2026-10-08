"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const offerHtml = fs.readFileSync(path.join(projectRoot, "offer.html"), "utf8");
const privacyHtml = fs.readFileSync(path.join(projectRoot, "privacy.html"), "utf8");

function price(source, format) {
  const pattern = new RegExp(
    `data-price-format=["']${format}["'][^>]*>[\\s\\S]{0,180}?([0-9][0-9\\s\\u00a0]*)\\s*(?:₽|руб)`,
  );
  const match = source.match(pattern);
  assert.ok(match, `price for ${format} is present`);
  return Number(match[1].replace(/[^0-9]/g, ""));
}

test("A-E: landing and offer expose the same current prices", () => {
  const expected = { individual: 3000, pair: 2000, group: 1500, support: 4000 };
  const landingPrices = Object.fromEntries(
    Object.keys(expected).map((format) => [format, price(indexHtml, format)]),
  );
  const offerPrices = Object.fromEntries(
    Object.keys(expected).map((format) => [format, price(offerHtml, format)]),
  );

  assert.deepEqual(landingPrices, expected);
  assert.deepEqual(offerPrices, expected);
  assert.deepEqual(offerPrices, landingPrices);
});

test("privacy policy matches structured student identity and metadata-only homework uploads", () => {
  assert.match(privacyHtml, /фамилия, имя, отчество — если указано, логин/);
  assert.match(privacyHtml, /сведения о прикрепляемых файлах,[^;]+; при использовании функции загрузки файлов — файлы домашних работ/);
  assert.doesNotMatch(privacyHtml, /В обязательном профиле Ученика не запрашиваются ФИО/);
  assert.doesNotMatch(privacyHtml, /Основная база личного кабинета и файлы домашних заданий размещаются/);
});
