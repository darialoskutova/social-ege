"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const studentHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const studentCss = fs.readFileSync(path.join(root, "cabinet.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin/admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "admin/admin.css"), "utf8");

test("student conversation UI accepts only supported attachment extensions", () => {
  assert.match(studentHtml, /id="conversationFile"[^>]+accept="\.pdf,\.docx,\.jpg,\.jpeg,\.png"/);
  assert.match(studentHtml, /id="conversationRemoveFile"/);
  assert.match(studentHtml, /Добавьте текст или файл/);
});

test("student UI uploads and renders protected conversation attachments", () => {
  assert.match(studentHtml, /\/api\/learning\$\{route\}\/messages\/file/);
  assert.match(studentHtml, /attachment\.originalFilename/);
  assert.match(studentHtml, /attachment\.downloadUrl/);
  assert.doesNotMatch(studentHtml, /attachment\.objectKey|attachment\.storagePath|attachment\.object_key/);
});

test("admin dialog and test-attempt reply both support attachments", () => {
  assert.match(adminHtml, /id="admin-conversation-file"[^>]+name="attachment"/);
  assert.match(adminJs, /conversationAttachmentPickerMarkup\(`attempt-conversation-file-\$\{attemptId\}`\)/);
  assert.match(adminJs, /`\$\{route\}\/file`/);
  assert.match(adminJs, /conversationAttachmentMarkup/);
});

test("attachment filenames wrap without widening student or admin layouts", () => {
  for (const css of [studentCss, adminCss]) {
    assert.match(css, /\.conversation-attachment[^}]+grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    assert.match(css, /\.conversation-attachment strong[^}]+overflow-wrap:\s*anywhere/);
    assert.match(css, /\.conversation-selected-file[^}]+grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  }
  assert.match(studentCss, /@media \(max-width: 560px\)[\s\S]+\.conversation-attachment\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(adminCss, /\.conversation-attachment\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("attachment controls keep keyboard labels and minimum touch targets", () => {
  assert.match(studentHtml, /<label class="conversation-file-button" for="conversationFile">/);
  assert.match(adminHtml, /<label class="conversation-file-button" for="admin-conversation-file">/);
  assert.match(studentCss, /\.conversation-file-button[^}]+min-height:\s*42px/);
  assert.match(adminCss, /\.conversation-file-button[^}]+min-height:\s*42px/);
});
