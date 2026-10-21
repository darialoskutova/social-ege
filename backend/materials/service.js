"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const rawTopics = require("../../data/course-topics");
const { courseTopics, sectionRules } = require("../study-plan/course-catalog");
const { mocks } = require("../learning/mock-catalog");
const {
  downloadNameHeader,
  receiveUpload,
  removeStoredFile,
  sendStoredFile,
} = require("../learning/file-storage");
const { HttpError } = require("../lib/http-error");
const { withTransaction } = require("../lib/transaction");

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MATERIAL_MIMES = Object.freeze(["application/pdf", DOCX_MIME, "image/jpeg", "image/png"]);
const TYPE_LABELS = Object.freeze({
  notes: "Конспект",
  section_plan: "План по разделу",
  additional: "Дополнительный материал",
  homework: "Домашнее задание",
  thematic_mock: "Тематический пробник",
});
const SECTION_LABELS = Object.freeze(Object.fromEntries(sectionRules.map((item) => [item.id, item.label])));
const seedPromises = new WeakMap();

function integer(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readMaterialConfig() {
  const defaultLegacyRoot = process.env.NODE_ENV === "production"
    ? "/var/www/social-ege"
    : path.resolve(__dirname, "../..");
  return Object.freeze({
    directory: path.resolve(process.env.MATERIAL_STORAGE_DIR || path.resolve(__dirname, "../../var/materials")),
    legacyRoot: path.resolve(process.env.MATERIAL_LEGACY_ROOT || defaultLegacyRoot),
    maxBytes: integer("MATERIAL_MAX_BYTES", 25 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    allowedMimes: MATERIAL_MIMES,
  });
}

function mimeFor(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return DOCX_MIME;
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  return "application/octet-stream";
}

function legacySeeds() {
  const catalogById = new Map(courseTopics.map((topic) => [topic.id, topic]));
  const seeds = [];
  rawTopics.forEach((topic, index) => {
    const catalog = catalogById.get(topic.id);
    if (!catalog) return;
    [["notes", topic.notes], ["homework", topic.homework], ["additional", topic.extra]].forEach(([type, legacyPath]) => {
      if (!legacyPath) return;
      seeds.push({
        legacyKey: `topic:${topic.id}:${type}`,
        title: type === "notes" ? `Конспект · ${topic.title}`
          : type === "homework" ? `Вторая часть · ${topic.title}` : `Дополнительный материал · ${topic.title}`,
        type,
        scope: "topic",
        sectionId: catalog.sectionId,
        topicId: topic.id,
        subtitle: null,
        legacyPath,
        originalFilename: path.basename(legacyPath),
        mimeType: mimeFor(legacyPath),
        sortOrder: index + 1,
      });
    });
  });
  [
    ["social_relations", "Планы по социологии", "доп материалы/Планы по социологии из ЕГЭ.pdf"],
    ["economics", "Планы по экономике", "доп материалы/Планы по экономике.pdf"],
    ["politics", "Планы по политике", "доп материалы/Планы по политике.pdf"],
    ["law", "Планы по праву", "доп материалы/Планы по праву ЕГЭ.pdf"],
  ].forEach(([sectionId, title, legacyPath], index) => seeds.push({
    legacyKey: `section-plan:${sectionId}`,
    title,
    type: "section_plan",
    scope: "section",
    sectionId,
    topicId: null,
    subtitle: "Задание № 24",
    legacyPath,
    originalFilename: path.basename(legacyPath),
    mimeType: "application/pdf",
    sortOrder: index + 1,
  }));
  mocks.forEach((mock) => seeds.push({
    legacyKey: `mock:${mock.mockId}:${mock.contentVersion}`,
    title: `${mock.title} · вариант ${mock.variant}`,
    type: "thematic_mock",
    scope: "section",
    sectionId: mock.focusSection,
    topicId: null,
    subtitle: null,
    referenceKey: mock.mockId,
    contentVersion: mock.contentVersion,
    legacyPath: mock.downloadPath,
    originalFilename: path.basename(mock.downloadPath),
    mimeType: DOCX_MIME,
    sortOrder: mock.variant,
  }));
  return seeds;
}

async function ensureLegacyMaterials(pool) {
  if (seedPromises.has(pool)) return seedPromises.get(pool);
  const promise = (async () => {
    const rows = legacySeeds().map((seed) => ({
      legacy_key: seed.legacyKey, title: seed.title, material_type: seed.type,
      scope_type: seed.scope, section_id: seed.sectionId, topic_id: seed.topicId,
      card_subtitle: seed.subtitle,
      reference_key: seed.referenceKey || null, content_version: seed.contentVersion || null,
      legacy_path: seed.legacyPath, original_filename: seed.originalFilename,
      mime_type: seed.mimeType, sort_order: seed.sortOrder,
    }));
    await pool.query(
      `INSERT INTO materials (
         legacy_key, title, material_type, scope_type, section_id, topic_id,
         card_subtitle, reference_key, content_version, storage_kind, legacy_path, original_filename,
         mime_type, status, sort_order
       ) SELECT legacy_key, title, material_type, scope_type, section_id, topic_id,
                card_subtitle, reference_key, content_version, 'legacy', legacy_path, original_filename,
                mime_type, 'published', sort_order
           FROM jsonb_to_recordset($1::JSONB) AS seed(
             legacy_key TEXT, title TEXT, material_type TEXT, scope_type TEXT, section_id TEXT,
             topic_id TEXT, card_subtitle TEXT, reference_key TEXT, content_version TEXT,
             legacy_path TEXT, original_filename TEXT, mime_type TEXT, sort_order INTEGER
           )
       ON CONFLICT (legacy_key) DO NOTHING`,
      [JSON.stringify(rows)],
    );
  })();
  seedPromises.set(pool, promise);
  try { await promise; } catch (error) { seedPromises.delete(pool); throw error; }
}

const columns = `id, legacy_key, title, material_type, scope_type, section_id, topic_id,
  card_subtitle,
  reference_key, content_version, storage_kind, legacy_path, object_key,
  original_filename, mime_type, size_bytes, status, sort_order, created_at, updated_at`;

function serialize(row, admin = false) {
  const value = {
    id: String(row.id),
    title: row.title,
    type: row.material_type,
    typeLabel: TYPE_LABELS[row.material_type] || row.material_type,
    scope: row.scope_type,
    sectionId: row.section_id,
    sectionLabel: SECTION_LABELS[row.section_id] || row.section_id,
    topicId: row.topic_id || null,
    subtitle: row.card_subtitle || null,
    referenceKey: row.reference_key || null,
    contentVersion: row.content_version || null,
    fileName: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadUrl: admin ? `/api/admin/materials/${row.id}/file` : `/api/learning/materials/${row.id}/file`,
  };
  if (admin) {
    value.status = row.status;
    value.source = row.storage_kind === "legacy" ? "Исходный файл" : "Загружен в панели";
  }
  return value;
}

async function listAdmin(pool, filters = {}) {
  await ensureLegacyMaterials(pool);
  const clauses = [];
  const values = [];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
  if (filters.scope) add("scope_type = ?", filters.scope);
  if (filters.sectionId) add("section_id = ?", filters.sectionId);
  if (filters.topicId) add("topic_id = ?", filters.topicId);
  if (filters.type) add("material_type = ?", filters.type);
  if (filters.status) add("status = ?", filters.status);
  if (filters.search) {
    values.push(filters.search);
    clauses.push(`(title ILIKE '%' || $${values.length} || '%'
      OR card_subtitle ILIKE '%' || $${values.length} || '%'
      OR original_filename ILIKE '%' || $${values.length} || '%')`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${columns} FROM materials ${where}
      ORDER BY scope_type, section_id NULLS FIRST, topic_id NULLS FIRST, sort_order, id`,
    values,
  );
  return rows.map((row) => serialize(row, true));
}

async function listPublished(pool) {
  await ensureLegacyMaterials(pool);
  const { rows } = await pool.query(
    `SELECT ${columns} FROM materials WHERE status = 'published'
      ORDER BY scope_type, section_id NULLS FIRST, topic_id NULLS FIRST, sort_order, id`,
  );
  return rows.map((row) => serialize(row, false));
}

async function audit(client, actorId, action, materialId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'material', $3, $4::JSONB)`,
    [actorId, action, String(materialId), JSON.stringify(metadata)],
  );
}

async function create(pool, actorId, metadata, req, config) {
  const uploaded = await receiveUpload(req, config);
  try {
    const row = await withTransaction(pool, async (client) => {
      const result = await client.query(
        `INSERT INTO materials (
           title, material_type, scope_type, section_id, topic_id, card_subtitle,
           reference_key, content_version,
           storage_kind, object_key, original_filename, mime_type, size_bytes,
           status, sort_order, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded', $9, $10, $11, $12, $13, $14, $15, $15)
         RETURNING ${columns}`,
        [metadata.title, metadata.type, metadata.scope, metadata.sectionId || null,
          metadata.topicId || null, metadata.subtitle || null, metadata.referenceKey || null,
          metadata.contentVersion || null, uploaded.objectKey,
          uploaded.originalFilename, uploaded.mimeType, uploaded.sizeBytes,
          metadata.status, metadata.sortOrder || 0, actorId],
      );
      await audit(client, actorId, "material.created", result.rows[0].id, {
        type: metadata.type, status: metadata.status,
      });
      return result.rows[0];
    });
    return serialize(row, true);
  } catch (error) {
    await removeStoredFile(config, uploaded.objectKey);
    throw error;
  }
}

async function update(pool, actorId, id, metadata) {
  const row = await withTransaction(pool, async (client) => {
    const current = await client.query(`SELECT ${columns} FROM materials WHERE id = $1 FOR UPDATE`, [id]);
    if (!current.rows[0]) throw new HttpError(404, "material_not_found", "Материал не найден");
    const before = current.rows[0];
    const result = await client.query(
      `UPDATE materials SET title = $2, material_type = $3, scope_type = $4,
         section_id = $5, topic_id = $6, card_subtitle = $7, reference_key = $8,
         content_version = $9, status = $10, sort_order = $11,
         updated_by = $12, updated_at = NOW()
       WHERE id = $1 RETURNING ${columns}`,
      [id, metadata.title, metadata.type, metadata.scope, metadata.sectionId || null,
        metadata.topicId || null, metadata.subtitle || null, metadata.referenceKey || null,
        metadata.contentVersion || null, metadata.status,
        metadata.sortOrder || 0, actorId],
    );
    const action = before.status !== metadata.status ? `material.${metadata.status}` : "material.updated";
    await audit(client, actorId, action, id, { previousStatus: before.status, status: metadata.status });
    return result.rows[0];
  });
  return serialize(row, true);
}

async function replaceFile(pool, actorId, id, req, config) {
  const uploaded = await receiveUpload(req, config);
  let previousObjectKey = null;
  try {
    const row = await withTransaction(pool, async (client) => {
      const current = await client.query(`SELECT ${columns} FROM materials WHERE id = $1 FOR UPDATE`, [id]);
      if (!current.rows[0]) throw new HttpError(404, "material_not_found", "Материал не найден");
      if (current.rows[0].storage_kind === "uploaded") previousObjectKey = current.rows[0].object_key;
      const result = await client.query(
        `UPDATE materials SET storage_kind = 'uploaded', legacy_path = NULL,
           object_key = $2, original_filename = $3, mime_type = $4, size_bytes = $5,
           updated_by = $6, updated_at = NOW()
         WHERE id = $1 RETURNING ${columns}`,
        [id, uploaded.objectKey, uploaded.originalFilename, uploaded.mimeType,
          uploaded.sizeBytes, actorId],
      );
      await audit(client, actorId, "material.file_replaced", id, {
        previousFilename: current.rows[0].original_filename,
        filename: uploaded.originalFilename,
      });
      return result.rows[0];
    });
    if (previousObjectKey) await removeStoredFile(config, previousObjectKey).catch((error) => {
      console.error("Material file cleanup failed", { name: error?.name, code: error?.code });
    });
    return serialize(row, true);
  } catch (error) {
    await removeStoredFile(config, uploaded.objectKey);
    throw error;
  }
}

async function findFile(pool, id, { publishedOnly = false } = {}) {
  await ensureLegacyMaterials(pool);
  const { rows } = await pool.query(
    `SELECT ${columns} FROM materials WHERE id = $1${publishedOnly ? " AND status = 'published'" : ""}`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "material_not_found", "Материал не найден");
  return rows[0];
}

function safeLegacyPath(config, legacyPath) {
  const filename = path.resolve(config.legacyRoot, legacyPath);
  if (filename !== config.legacyRoot && !filename.startsWith(`${config.legacyRoot}${path.sep}`)) {
    throw new HttpError(404, "file_not_found", "Файл не найден");
  }
  return filename;
}

async function sendFile(res, config, row) {
  if (row.storage_kind === "uploaded") return sendStoredFile(res, config, row);
  const filename = safeLegacyPath(config, row.legacy_path);
  let stat;
  try {
    stat = await fsp.stat(filename);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    throw new HttpError(404, "file_not_found", "Файл не найден");
  }
  res.set({
    "Cache-Control": "private, no-store",
    "Content-Type": row.mime_type,
    "Content-Length": String(stat.size),
    "Content-Disposition": downloadNameHeader(row.original_filename),
    "X-Content-Type-Options": "nosniff",
  });
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.once("error", reject);
    stream.once("end", resolve);
    stream.pipe(res);
  });
}

module.exports = {
  MATERIAL_MIMES,
  TYPE_LABELS,
  create,
  ensureLegacyMaterials,
  findFile,
  legacySeeds,
  listAdmin,
  listPublished,
  readMaterialConfig,
  replaceFile,
  sendFile,
  serialize,
  update,
};
