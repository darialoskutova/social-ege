"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const renderer = require(path.join(root, "feedback-renderer.js"));
const frontend = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cabinetCss = fs.readFileSync(path.join(root, "cabinet.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin/admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "admin/admin.css"), "utf8");

const fixture = [
  "# Работа над ошибками",
  "",
  "**Обратите внимание** на формулировку задания.",
  "",
  "- Назовите признак",
  "- Приведите пример",
  "",
  "| Критерий | Результат |",
  "| --- | --- |",
  "| Аргумент | Нужно уточнить |",
  "",
  "[Открыть источник](https://example.com/source)",
].join("\n");

test("teacher feedback Markdown is rendered with the supported semantic elements", () => {
  const html = renderer.formatFeedbackMarkdown(fixture);
  assert.match(html, /<h3>Работа над ошибками<\/h3>/);
  assert.match(html, /<strong>Обратите внимание<\/strong>/);
  assert.match(html, /<ul><li>Назовите признак<\/li><li>Приведите пример<\/li><\/ul>/);
  assert.match(html, /<table>[\s\S]*<th scope="col">Критерий<\/th>[\s\S]*<td>Аргумент<\/td>/);
  assert.match(html, /href="https:\/\/example\.com\/source"/);
});

test("raw HTML and event handlers from a comment are escaped", () => {
  const html = renderer.formatFeedbackMarkdown('<script>alert(1)</script> <b onclick="steal()">текст</b>');
  assert.doesNotMatch(html, /<script|<b\s+onclick=/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("unsafe Markdown link schemes are not emitted as href attributes", () => {
  const html = renderer.formatFeedbackMarkdown("[нажать](javascript:alert(1))");
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /нажать/);
});

test("external Markdown images become labelled links and never auto-load", () => {
  const html = renderer.formatFeedbackMarkdown("![схема](https://example.com/task.png)");
  assert.doesNotMatch(html, /<img\b/i);
  assert.match(html, />Изображение: схема<\/a>/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
});

test("stored HTML entities are decoded for reading and escaped for safe output", () => {
  const html = renderer.formatFeedbackMarkdown("Ответ&#x20;ученика &lt;проверить&gt;");
  assert.doesNotMatch(html, /&#x20;|<проверить>/);
  assert.match(html, /Ответ ученика &lt;проверить&gt;/);
});

test("percent-encoded Russian filename is decoded for display", () => {
  assert.equal(
    renderer.displayFilename("%D0%94%D0%97%20%D0%BF%D0%BE%20%D0%BF%D1%80%D0%B0%D0%B2%D1%83.pdf"),
    "ДЗ по праву.pdf",
  );
});

test("malformed percent encoding is preserved without throwing", () => {
  assert.doesNotThrow(() => renderer.displayFilename("работа%20ученика%ZZ.pdf"));
  assert.equal(renderer.displayFilename("работа%20ученика%ZZ.pdf"), "работа%20ученика%ZZ.pdf");
});

test("ordinary filename remains unchanged", () => {
  assert.equal(renderer.displayFilename("Ответ ученика.pdf"), "Ответ ученика.pdf");
});

test("student and admin pages load the renderer before their application scripts", () => {
  assert.ok(frontend.indexOf('src="feedback-renderer.js') < frontend.indexOf("const feedbackRenderer"));
  assert.ok(adminHtml.indexOf('src="/feedback-renderer.js') < adminHtml.indexOf('src="/admin/admin.js'));
});

test("student feedback and filenames use the shared safe renderer", () => {
  assert.match(frontend, /feedbackRenderer\.formatFeedbackMarkdown\(work\.teacherComment\)/);
  assert.match(frontend, /feedbackRenderer\.formatFeedbackMarkdown\(message\.reply\)/);
  assert.match(frontend, /feedbackRenderer\.displayFilename\(work\.fileName\)/);
  assert.doesNotMatch(frontend, /Комментарий Дарьи:<\/strong>\s*\$\{escapeHtml\(work\.teacherComment\)/);
});

test("admin feedback and filenames use the same renderer", () => {
  assert.match(adminJs, /feedbackRenderer\.formatFeedbackMarkdown\(message\.text\)/);
  assert.match(adminJs, /feedbackRenderer\.displayFilename\(attachment\.originalFilename\)/);
  assert.match(adminJs, /feedbackRenderer\.displayFilename\(item\.fileName\)/);
});

test("feedback CSS keeps wide tables local and long content inside its container", () => {
  for (const css of [cabinetCss, adminCss]) {
    assert.match(css, /\.feedback-markdown\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/s);
    assert.match(css, /\.feedback-table-scroll\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
  }
});

test("student feedback has explicit readable light and dark theme surfaces", () => {
  assert.match(cabinetCss, /#appView \.teacher-comment\s*\{[^}]*background:\s*color-mix/s);
  assert.match(cabinetCss, /html\[data-theme="dark"\] #appView \.teacher-comment\s*\{[^}]*background:\s*#172a47[^}]*color:\s*#f5f7fc/s);
});
