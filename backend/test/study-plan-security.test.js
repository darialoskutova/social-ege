"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAdminRouter } = require("../admin/router");
const { createLearningRouter } = require("../learning/router");
const { HttpError } = require("../lib/http-error");

const ORIGIN = "https://social-ege.example";
const STUDENT_TOKEN = "student-session-token-000000000000";
const ADMIN_TOKEN = "admin-session-token-00000000000000";

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function config() {
  return {
    enabled: true,
    secureCookie: false,
    isProduction: false,
    cookieName: "social_ege_session",
    sessionTtlHours: 168,
    allowedOrigins: new Set([ORIGIN]),
  };
}

function authPool() {
  const sessions = new Map([
    [tokenHash(STUDENT_TOKEN), { id: 1, login: "student", display_name: "Ученица", role: "student" }],
    [tokenHash(ADMIN_TOKEN), { id: 9, login: "teacher", display_name: "Дарья", role: "admin" }],
  ]);
  return {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.includes("FROM auth_sessions AS s")) {
        const user = sessions.get(values[0]);
        return { rows: user ? [user] : [] };
      }
      if (normalized.startsWith("SELECT id FROM users")) {
        return { rows: [{ id: values[0] }] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

function serviceStub() {
  const calls = [];
  const empty = (userId) => ({ plan: { userId: String(userId) }, events: [], nextLesson: null, nextDeadline: null });
  return {
    calls,
    publicCourseCatalog: () => [{ id: "soc1", lesson: 1, title: "Человек и его потребности" }],
    getStudyPlan: async (pool, userId) => {
      calls.push(["get", String(userId)]);
      return empty(userId);
    },
    previewStudyPlan: (settings) => {
      calls.push(["preview", settings.startTopicId]);
      return { settings, events: [], summary: { warnings: [] } };
    },
    saveStudyPlan: async (pool, userId, settings, actorId) => {
      calls.push(["save", String(userId), String(actorId), settings.startTopicId]);
      return empty(userId);
    },
    changeStudyEvent: async () => empty(2),
    recalculateStudyPlan: async () => empty(2),
  };
}

async function serverFixture() {
  const pool = authPool();
  const studyPlan = serviceStub();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const uploadConfig = { directory: "/tmp/not-used", maxBytes: 1024 };
  app.use("/api/learning", createLearningRouter(pool, config(), uploadConfig, studyPlan));
  app.use("/api/admin", createAdminRouter(pool, config(), uploadConfig, studyPlan));
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return {
    studyPlan,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function request(context, path, { token, method = "GET", body } = {}) {
  return fetch(`${context.baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `social_ege_session=${token}` } : {}),
      ...(method === "GET" ? {} : { origin: ORIGIN }),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("study plan endpoints require a server session", async () => {
  const context = await serverFixture();
  try {
    assert.equal((await request(context, "/api/learning/study-plan")).status, 401);
    assert.equal((await request(context, "/api/admin/students/2/study-plan")).status, 401);
  } finally {
    await context.close();
  }
});

test("student schedule identity comes only from the authenticated session", async () => {
  const context = await serverFixture();
  try {
    const response = await request(context, "/api/learning/study-plan?userId=999", { token: STUDENT_TOKEN });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).plan.userId, "1");
    assert.deepEqual(context.studyPlan.calls[0], ["get", "1"]);
    assert.equal((await request(context, "/api/learning/study-plan", {
      token: STUDENT_TOKEN,
      method: "POST",
      body: { userId: 2 },
    })).status, 404);
  } finally {
    await context.close();
  }
});

test("ordinary students cannot read or change admin study plans", async () => {
  const context = await serverFixture();
  try {
    assert.equal((await request(context, "/api/admin/students/2/study-plan", { token: STUDENT_TOKEN })).status, 403);
    assert.equal((await request(context, "/api/admin/students/2/study-plan", {
      token: STUDENT_TOKEN,
      method: "PUT",
      body: { startTopicId: "soc1", lessonWeekdays: [2, 4] },
    })).status, 403);
  } finally {
    await context.close();
  }
});

test("admin can read and save a selected student's plan", async () => {
  const context = await serverFixture();
  try {
    const loaded = await request(context, "/api/admin/students/2/study-plan", { token: ADMIN_TOKEN });
    assert.equal(loaded.status, 200);
    assert.equal((await loaded.json()).plan.userId, "2");
    const saved = await request(context, "/api/admin/students/2/study-plan", {
      token: ADMIN_TOKEN,
      method: "PUT",
      body: { startTopicId: "pol35", lessonWeekdays: [2, 4, 6], effectiveFrom: null, targetEndDate: "2027-06-01" },
    });
    assert.equal(saved.status, 200);
    assert.ok(context.studyPlan.calls.some((call) => call[0] === "save"
      && call[1] === "2" && call[2] === "9" && call[3] === "pol35"));
  } finally {
    await context.close();
  }
});
