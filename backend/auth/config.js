"use strict";

function booleanValue(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function integerValue(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readAuthConfig() {
  const enabled = booleanValue("AUTH_ENABLED", false);
  const secureCookie = booleanValue("COOKIE_SECURE", true);
  const isProduction = process.env.NODE_ENV === "production";
  const cookieName = process.env.SESSION_COOKIE_NAME || "social_ege_session";
  const sessionTtlHours = integerValue("SESSION_TTL_HOURS", 24 * 7, 1, 24 * 30);
  const accountTokenTtlHours = integerValue("ACCOUNT_TOKEN_TTL_HOURS", 72, 1, 24 * 7);
  const origins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!/^[A-Za-z0-9_-]+$/.test(cookieName)) {
    throw new Error("SESSION_COOKIE_NAME contains unsupported characters");
  }

  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("ALLOWED_ORIGINS must contain exact HTTP(S) origins");
    }
  }

  if (enabled && origins.length === 0) {
    throw new Error("ALLOWED_ORIGINS is required when authentication is enabled");
  }
  if (enabled && isProduction && !secureCookie) {
    throw new Error("Production authentication requires Secure cookies");
  }
  if (enabled && isProduction && origins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("Production authentication requires HTTPS origins");
  }
  const configuredPublicOrigin = (process.env.PUBLIC_ORIGIN || "").trim();
  const publicOrigin = configuredPublicOrigin || origins[0] || "";
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.origin !== publicOrigin || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("PUBLIC_ORIGIN must be an exact HTTP(S) origin");
    }
    if (enabled && !origins.includes(publicOrigin)) {
      throw new Error("PUBLIC_ORIGIN must also be present in ALLOWED_ORIGINS");
    }
    if (enabled && isProduction && !publicOrigin.startsWith("https://")) {
      throw new Error("Production PUBLIC_ORIGIN must use HTTPS");
    }
  }

  return Object.freeze({
    enabled,
    secureCookie,
    isProduction,
    cookieName,
    sessionTtlHours,
    accountTokenTtlHours,
    publicOrigin,
    allowedOrigins: new Set(origins),
  });
}

module.exports = { readAuthConfig };
