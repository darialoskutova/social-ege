"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAdminRouter } = require("../admin/router");
const { createLearningRouter } = require("../learning/router");
const { HttpError } = require("../lib/http-error");
const { receiveUpload } = require("../learning/file-storage");
const materialService = require("../materials/service");
const rawTopics = require("../../data/course-topics");

const ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "https://social-ege.example";
const ADMIN_TOKEN = "materials-admin-token-000000000000000000";
const STUDENT_TOKEN = "materials-student-token-000000000000000";
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("placeholder [Content_Types].xml placeholder word/document.xml"),
]);

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function authConfig() {
  return {
    enabled: true, secureCookie: false, isProduction: false,
    cookieName: "social_ege_session", sessionTtlHours: 168,
    allowedOrigins: new Set([ORIGIN]),
  };
}

function uploadRequest(filename, mimeType, body, extra = {}) {
  const headers = new Map(Object.entries({
    "x-file-name": encodeURIComponent(filename),
    "content-type": mimeType,
    "content-length": String(body.length),
    ...extra,
  }).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name) { return headers.get(String(name).toLowerCase()); },
    async *[Symbol.asyncIterator]() { yield body; },
  };
}

function temporaryConfig(maxBytes = 1024 * 1024) {
  return {
    directory: fs.mkdtempSync(path.join(os.tmpdir(), "social-ege-materials-")),
    legacyRoot: ROOT,
    maxBytes,
    allowedMimes: materialService.MATERIAL_MIMES,
  };
}

function materialRow(overrides = {}) {
  return {
    id: 7, legacy_key: null, title: "Материал", material_type: "notes",
    section_id: "politics", topic_id: "pol29", reference_key: null,
    content_version: null, storage_kind: "uploaded", legacy_path: null,
    object_key: "11111111-1111-4111-8111-111111111111.pdf",
    original_filename: "материал.pdf", mime_type: "application/pdf", size_bytes: PDF.length,
    status: "published", sort_order: 1, created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
}

test("008 migration is additive and does not alter existing learning or auth tables", () => {
  const sql = fs.readFileSync(path.join(ROOT, "backend/migrations/008_materials_cms.sql"), "utf8");
  assert.match(sql, /CREATE TABLE materials/);
  assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
  assert.doesNotMatch(sql, /ALTER TABLE (?:users|test_attempts|user_progress|auth_sessions)/i);
});

test("legacy seed keys are stable and unique", () => {
  const seeds = materialService.legacySeeds();
  assert.equal(new Set(seeds.map((item) => item.legacyKey)).size, seeds.length);
  assert.ok(seeds.every((item) => item.legacyKey && item.legacyPath));
});

test("legacy seeds register every configured topic note and homework", () => {
  const seeds = materialService.legacySeeds();
  for (const topic of rawTopics) {
    if (topic.notes) assert.ok(seeds.some((item) => item.legacyKey === `topic:${topic.id}:notes`));
    if (topic.homework) assert.ok(seeds.some((item) => item.legacyKey === `topic:${topic.id}:homework`));
  }
});

test("legacy seeds include four section plans and all thematic mocks", () => {
  const seeds = materialService.legacySeeds();
  assert.equal(seeds.filter((item) => item.type === "section_plan").length, 4);
  assert.equal(seeds.filter((item) => item.type === "thematic_mock").length, 15);
});

test("student material serialization never exposes storage paths or object keys", () => {
  const payload = materialService.serialize(materialRow(), false);
  const text = JSON.stringify(payload);
  assert.equal(text.includes("object_key"), false);
  assert.equal(text.includes("legacy_path"), false);
  assert.equal(text.includes("11111111-1111"), false);
  assert.equal(payload.downloadUrl, "/api/learning/materials/7/file");
});

test("admin serialization exposes useful metadata but not physical storage identifiers", () => {
  const payload = materialService.serialize(materialRow(), true);
  assert.equal(payload.status, "published");
  assert.equal(payload.source, "Загружен в панели");
  assert.equal(Object.hasOwn(payload, "objectKey"), false);
  assert.equal(Object.hasOwn(payload, "legacyPath"), false);
});

test("material storage default is separate from public repository content", () => {
  const config = materialService.readMaterialConfig();
  assert.equal(config.directory.includes("/var/materials"), true);
  assert.equal(config.allowedMimes.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);
});

test("material upload accepts a genuine PDF and stores a generated object key", async (t) => {
  const config = temporaryConfig(); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  const file = await receiveUpload(uploadRequest("теория.pdf", "application/pdf", PDF), config);
  assert.match(file.objectKey, /^[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(fs.readFileSync(path.join(config.directory, file.objectKey)), PDF);
});

test("material upload accepts DOCX only when its ZIP container has Word entries", async (t) => {
  const config = temporaryConfig(); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  const file = await receiveUpload(uploadRequest("задание.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", DOCX), config);
  assert.match(file.objectKey, /\.docx$/);
});

test("material upload rejects a forged PDF by signature", async (t) => {
  const config = temporaryConfig(); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  await assert.rejects(receiveUpload(uploadRequest("fake.pdf", "application/pdf", Buffer.from("not-pdf")), config), (error) => error.code === "invalid_file_content");
});

test("material upload rejects MIME and extension mismatch", async (t) => {
  const config = temporaryConfig(); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  await assert.rejects(receiveUpload(uploadRequest("fake.png", "application/pdf", PDF), config), (error) => error.code === "unsupported_file_type");
});

test("material upload enforces maximum size before persistence", async (t) => {
  const config = temporaryConfig(8); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  await assert.rejects(receiveUpload(uploadRequest("large.pdf", "application/pdf", PDF), config), (error) => error.code === "file_too_large");
  assert.deepEqual(fs.readdirSync(config.directory), []);
});

test("material upload rejects path traversal in an original filename", async (t) => {
  const config = temporaryConfig(); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  await assert.rejects(receiveUpload(uploadRequest("../secret.pdf", "application/pdf", PDF), config), (error) => error.code === "invalid_filename");
});

function replacementPool(row, failUpdate = false) {
  const state = { row: { ...row }, audits: 0 };
  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] };
    if (normalized.startsWith("SELECT id, legacy_key") && normalized.includes("FOR UPDATE")) return { rows: [state.row] };
    if (normalized.startsWith("UPDATE materials SET storage_kind")) {
      if (failUpdate) throw new Error("database unavailable");
      Object.assign(state.row, { storage_kind: "uploaded", legacy_path: null, object_key: values[1], original_filename: values[2], mime_type: values[3], size_bytes: values[4], updated_at: new Date() });
      return { rows: [state.row] };
    }
    if (normalized.startsWith("INSERT INTO audit_log")) { state.audits += 1; return { rows: [] }; }
    throw new Error(`Unexpected query: ${normalized}`);
  }
  return { state, query, async connect() { return { query, release() {} }; } };
}

test("successful replacement commits the new file before removing the old file", async (t) => {
  const config = temporaryConfig(); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  const row = materialRow();
  fs.writeFileSync(path.join(config.directory, row.object_key), PDF);
  const pool = replacementPool(row);
  const result = await materialService.replaceFile(pool, 9, "7", uploadRequest("новый.pdf", "application/pdf", PDF), config);
  assert.equal(result.fileName, "новый.pdf");
  assert.equal(fs.existsSync(path.join(config.directory, row.object_key)), false);
  assert.equal(fs.readdirSync(config.directory).length, 1);
  assert.equal(pool.state.audits, 1);
});

test("failed replacement removes the new file and preserves the old file", async (t) => {
  const config = temporaryConfig(); t.after(() => fs.rmSync(config.directory, { recursive: true, force: true }));
  const row = materialRow();
  fs.writeFileSync(path.join(config.directory, row.object_key), PDF);
  const pool = replacementPool(row, true);
  await assert.rejects(materialService.replaceFile(pool, 9, "7", uploadRequest("новый.pdf", "application/pdf", PDF), config));
  assert.deepEqual(fs.readdirSync(config.directory), [row.object_key]);
});

test("material metadata remains in the database after a later read cycle", async () => {
  const state = { row: materialRow(), audits: [] };
  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] };
    if (normalized.startsWith("SELECT id, legacy_key") && normalized.includes("FOR UPDATE")) return { rows: [{ ...state.row }] };
    if (normalized.startsWith("UPDATE materials SET title")) {
      Object.assign(state.row, { title: values[1], material_type: values[2], section_id: values[3], topic_id: values[4], reference_key: values[5], content_version: values[6], status: values[7], sort_order: values[8], updated_at: new Date() });
      return { rows: [{ ...state.row }] };
    }
    if (normalized.startsWith("INSERT INTO audit_log")) { state.audits.push(values); return { rows: [] }; }
    throw new Error(`Unexpected query: ${normalized}`);
  }
  const pool = { query, async connect() { return { query, release() {} }; } };
  const updated = await materialService.update(pool, 9, "7", { title: "Сохранённое название", type: "notes", sectionId: "politics", topicId: "pol29", referenceKey: null, contentVersion: null, status: "hidden", sortOrder: 4 });
  assert.equal(updated.title, "Сохранённое название");
  assert.equal(state.row.title, "Сохранённое название");
  assert.equal(state.row.status, "hidden");
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0][1], "material.hidden");
});

function routerPool() {
  const sessions = new Map([
    [tokenHash(ADMIN_TOKEN), { id: 9, login: "teacher", display_name: "Дарья", role: "admin" }],
    [tokenHash(STUDENT_TOKEN), { id: 1, login: "student", display_name: "Ученица", role: "student" }],
  ]);
  return { async query(sql, values = []) {
    if (sql.includes("FROM auth_sessions AS s")) return { rows: sessions.has(values[0]) ? [sessions.get(values[0])] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
}

async function routerFixture() {
  const calls = [];
  const service = {
    async listAdmin() { return [{ id: "7", title: "Материал", status: "hidden" }]; },
    async listPublished() { return [{ id: "8", title: "Открытый", downloadUrl: "/api/learning/materials/8/file" }]; },
    async findFile(pool, id, options = {}) {
      calls.push({ id, options });
      if (options.publishedOnly && id === "7") throw new HttpError(404, "material_not_found", "Материал не найден");
      return materialRow({ id: Number(id) });
    },
    async sendFile(res) { res.type("application/pdf").send(PDF); },
    async create(pool, actorId, metadata) { calls.push({ actorId, metadata }); return { id: "9", ...metadata }; },
    async update(pool, actorId, id, metadata) { return { id, ...metadata }; },
    async replaceFile(pool, actorId, id) { return { id, title: "Заменён" }; },
  };
  const upload = temporaryConfig();
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use("/api/admin", createAdminRouter(routerPool(), authConfig(), upload, undefined, undefined, service, upload));
  app.use("/api/learning", createLearningRouter(routerPool(), authConfig(), upload, undefined, undefined, service, upload));
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    next(error);
  });
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function routeRequest(context, route, token, options = {}) {
  return fetch(`${context.baseUrl}${route}`, { ...options, headers: { ...(options.headers || {}), ...(token ? { cookie: `social_ege_session=${token}` } : {}) } });
}

test("materials admin API rejects anonymous access", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  assert.equal((await routeRequest(context, "/api/admin/materials")).status, 401);
});

test("materials admin API rejects an authenticated student", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  assert.equal((await routeRequest(context, "/api/admin/materials", STUDENT_TOKEN)).status, 403);
});

test("materials admin API returns its workspace list to an admin", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const response = await routeRequest(context, "/api/admin/materials", ADMIN_TOKEN);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).materials[0].status, "hidden");
});

test("admin creates a material through the protected upload endpoint", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const metadata = { title: "Новый конспект", type: "notes", sectionId: "politics", topicId: "pol29", referenceKey: null, contentVersion: null, status: "published", sortOrder: 1 };
  const response = await routeRequest(context, "/api/admin/materials/file", ADMIN_TOKEN, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/pdf", "x-file-name": encodeURIComponent("конспект.pdf"), "x-material-metadata": encodeURIComponent(JSON.stringify(metadata)) },
    body: PDF,
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).material.title, "Новый конспект");
  assert.equal(context.calls.at(-1).actorId, "9");
});

test("student cannot create a material even with valid upload metadata", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const metadata = { title: "Чужой файл", type: "notes", sectionId: "politics", topicId: null, referenceKey: null, contentVersion: null, status: "published", sortOrder: 0 };
  const response = await routeRequest(context, "/api/admin/materials/file", STUDENT_TOKEN, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/pdf", "x-file-name": "file.pdf", "x-material-metadata": encodeURIComponent(JSON.stringify(metadata)) },
    body: PDF,
  });
  assert.equal(response.status, 403);
});

test("admin can replace a material file but student cannot", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const options = { method: "PUT", headers: { origin: ORIGIN, "content-type": "application/pdf", "x-file-name": "file.pdf" }, body: PDF };
  assert.equal((await routeRequest(context, "/api/admin/materials/7/file", STUDENT_TOKEN, options)).status, 403);
  assert.equal((await routeRequest(context, "/api/admin/materials/7/file", ADMIN_TOKEN, options)).status, 200);
});

test("student materials API requires a valid server session", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  assert.equal((await routeRequest(context, "/api/learning/materials")).status, 401);
});

test("student materials API returns only the service published catalog", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const response = await routeRequest(context, "/api/learning/materials", STUDENT_TOKEN);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.materials.map((item) => item.id), ["8"]);
});

test("hidden and archived records are absent from the student catalog", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const payload = await (await routeRequest(context, "/api/learning/materials", STUDENT_TOKEN)).json();
  assert.equal(payload.materials.some((item) => ["hidden", "archived"].includes(item.status)), false);
  assert.equal(payload.materials.some((item) => item.id === "7"), false);
});

test("student file endpoint asks the service for published-only access", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const response = await routeRequest(context, "/api/learning/materials/8/file", STUDENT_TOKEN);
  assert.equal(response.status, 200);
  assert.equal(context.calls.at(-1).options.publishedOnly, true);
});

test("hidden material cannot be downloaded through the student endpoint", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  assert.equal((await routeRequest(context, "/api/learning/materials/7/file", STUDENT_TOKEN)).status, 404);
});

test("admin material metadata rejects unknown fields and invalid statuses", async (t) => {
  const context = await routerFixture(); t.after(context.close);
  const response = await routeRequest(context, "/api/admin/materials/7", ADMIN_TOKEN, {
    method: "PATCH", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ title: "X", type: "notes", sectionId: "politics", status: "deleted", sortOrder: 0, serverPath: "/tmp/x" }),
  });
  assert.equal(response.status, 400);
});

test("admin and student frontends are wired to the materials registry without exposing paths", () => {
  const admin = fs.readFileSync(path.join(ROOT, "admin/admin.js"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(admin, /api\("\/materials"\)/);
  assert.match(index, /learningRequest\("\/materials"\)/);
  assert.match(index, /materialsLoaded/);
  assert.doesNotMatch(index, /object_key|legacy_path/);
});
