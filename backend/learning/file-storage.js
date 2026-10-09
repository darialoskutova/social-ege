"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { HttpError } = require("../lib/http-error");

const TYPES = Object.freeze({
  "application/pdf": { extensions: new Set([".pdf"]), extension: ".pdf" },
  "image/jpeg": { extensions: new Set([".jpg", ".jpeg"]), extension: ".jpg" },
  "image/png": { extensions: new Set([".png"]), extension: ".png" },
});

function integer(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readUploadConfig() {
  return Object.freeze({
    directory: path.resolve(
      process.env.UPLOAD_STORAGE_DIR || path.resolve(__dirname, "../../var/uploads"),
    ),
    maxBytes: integer("UPLOAD_MAX_BYTES", 15 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  });
}

function decodeHeader(req, name, maximum) {
  const raw = req.get(name);
  if (!raw) throw new HttpError(400, "missing_upload_metadata", "Не указаны данные файла");
  let value;
  try {
    value = decodeURIComponent(raw).normalize("NFKC").trim();
  } catch {
    throw new HttpError(400, "invalid_upload_metadata", "Некорректные данные файла");
  }
  if (!value || value.length > maximum || value.includes("\0")) {
    throw new HttpError(400, "invalid_upload_metadata", "Некорректные данные файла");
  }
  return value;
}

function originalFilename(req) {
  const value = decodeHeader(req, "x-file-name", 255);
  if (path.basename(value) !== value || /[\\/]/.test(value)) {
    throw new HttpError(400, "invalid_filename", "Некорректное имя файла");
  }
  return value;
}

function contentType(req, filename) {
  const mime = String(req.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const type = TYPES[mime];
  const extension = path.extname(filename).toLowerCase();
  if (!type || !type.extensions.has(extension)) {
    throw new HttpError(415, "unsupported_file_type", "Можно отправить PDF, JPG или PNG");
  }
  return { mime, extension: type.extension };
}

function signatureMatches(mime, prefix) {
  if (mime === "application/pdf") return prefix.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "image/png") return prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mime === "image/jpeg") return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  return false;
}

async function ensureStorage(config) {
  await fsp.mkdir(config.directory, { recursive: true, mode: 0o700 });
  await fsp.chmod(config.directory, 0o700);
}

async function receiveUpload(req, config) {
  const filename = originalFilename(req);
  const { mime, extension } = contentType(req, filename);
  const declaredLength = Number(req.get("content-length") || 0);
  if (declaredLength > config.maxBytes) {
    throw new HttpError(413, "file_too_large", "Файл слишком большой");
  }
  await ensureStorage(config);
  const token = crypto.randomUUID();
  const temporary = path.join(config.directory, `${token}.upload`);
  const objectKey = `${token}${extension}`;
  const destination = path.join(config.directory, objectKey);
  const handle = await fsp.open(temporary, "wx", 0o600);
  let size = 0;
  let prefix = Buffer.alloc(0);
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > config.maxBytes) {
        throw new HttpError(413, "file_too_large", "Файл слишком большой");
      }
      if (prefix.length < 8) prefix = Buffer.concat([prefix, chunk]).subarray(0, 8);
      await handle.write(chunk);
    }
    await handle.sync();
    await handle.close();
    if (size === 0 || !signatureMatches(mime, prefix)) {
      throw new HttpError(415, "invalid_file_content", "Содержимое файла не соответствует его формату");
    }
    await fsp.rename(temporary, destination);
    return { objectKey, originalFilename: filename, mimeType: mime, sizeBytes: size };
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}

function storagePath(config, objectKey) {
  if (!/^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(objectKey || "")) {
    throw new HttpError(404, "file_not_found", "Файл не найден");
  }
  return path.join(config.directory, objectKey);
}

async function removeStoredFile(config, objectKey) {
  if (!objectKey) return;
  await fsp.unlink(storagePath(config, objectKey)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function downloadNameHeader(filename) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "work";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function sendStoredFile(res, config, row) {
  const filename = storagePath(config, row.object_key);
  try {
    await fsp.access(filename, fs.constants.R_OK);
  } catch {
    throw new HttpError(404, "file_not_found", "Файл не найден");
  }
  res.set({
    "Cache-Control": "private, no-store",
    "Content-Type": row.mime_type,
    "Content-Length": String(row.size_bytes),
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
  decodeHeader,
  readUploadConfig,
  receiveUpload,
  removeStoredFile,
  sendStoredFile,
};
