"use strict";

const path = require("node:path");
const { HttpError } = require("../lib/http-error");

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CONVERSATION_ATTACHMENT_MIMES = Object.freeze([
  "application/pdf",
  DOCX_MIME,
  "image/jpeg",
  "image/png",
]);
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function configuredInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readConversationAttachmentConfig() {
  return Object.freeze({
    directory: path.resolve(
      process.env.CONVERSATION_ATTACHMENT_STORAGE_DIR
        || path.resolve(__dirname, "../../var/conversation-attachments"),
    ),
    maxBytes: configuredInteger(
      "CONVERSATION_ATTACHMENT_MAX_BYTES",
      DEFAULT_MAX_BYTES,
      1024,
      DEFAULT_MAX_BYTES,
    ),
    allowedMimes: CONVERSATION_ATTACHMENT_MIMES,
  });
}

function optionalMessageText(req) {
  const rawParts = req.get("x-message-text-parts");
  if (rawParts === undefined) return "";
  if (!/^[1-4]$/.test(rawParts)) {
    throw new HttpError(400, "invalid_upload_metadata", "Некорректный текст сообщения");
  }
  const partCount = Number(rawParts);
  const parts = [];
  for (let index = 1; index <= partCount; index += 1) {
    const part = req.get(`x-message-text-${index}`);
    if (!part || part.length > 7000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(part)) {
      throw new HttpError(400, "invalid_upload_metadata", "Некорректный текст сообщения");
    }
    parts.push(part);
  }
  const raw = parts.join("");
  if (raw.length > 28000 || raw.length % 4 !== 0) {
    throw new HttpError(400, "invalid_upload_metadata", "Текст сообщения слишком длинный");
  }
  let value;
  try {
    const bytes = Buffer.from(raw, "base64");
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes).normalize("NFKC").trim();
    if (bytes.toString("base64") !== raw) throw new Error("non-canonical base64");
  } catch {
    throw new HttpError(400, "invalid_upload_metadata", "Некорректный текст сообщения");
  }
  if (value.length > 6000 || value.includes("\0")) {
    throw new HttpError(400, "invalid_upload_metadata", "Текст сообщения слишком длинный");
  }
  return value;
}

module.exports = {
  CONVERSATION_ATTACHMENT_MIMES,
  DEFAULT_MAX_BYTES,
  optionalMessageText,
  readConversationAttachmentConfig,
};
