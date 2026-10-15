"use strict";

(function exposeFrontendState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EGE_FRONTEND_STATE = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const CABINET_PAGES = new Set(["dashboard", "subjects", "works", "practice", "admin"]);
  const LESSON_PANELS = new Set(["materials", "test", "homework"]);

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }

  function routeFromHash(hash = "") {
    const parts = String(hash).replace(/^#/, "").split("/").map(safeDecode);
    if (parts[0] !== "cabinet") return { page: "dashboard" };
    if (parts[1] === "lesson") {
      return {
        page: "lesson",
        topicId: parts[2] || "",
        panel: LESSON_PANELS.has(parts[3]) ? parts[3] : "materials",
      };
    }
    if (parts[1] === "subjects") {
      return { page: "subjects", subject: parts[2] || "" };
    }
    return { page: CABINET_PAGES.has(parts[1]) ? parts[1] : "dashboard" };
  }

  function hashForRoute(route = {}) {
    if (route.page === "lesson" && route.topicId) {
      const panel = LESSON_PANELS.has(route.panel) ? route.panel : "materials";
      return `#cabinet/lesson/${encodeURIComponent(route.topicId)}/${panel}`;
    }
    if (route.page === "subjects") {
      return route.subject
        ? `#cabinet/subjects/${encodeURIComponent(route.subject)}`
        : "#cabinet/subjects";
    }
    return `#cabinet/${CABINET_PAGES.has(route.page) ? route.page : "dashboard"}`;
  }

  function startupViewFor(user, hash = "") {
    if (user) return "cabinet";
    return hash === "#login" || String(hash).startsWith("#cabinet/") ? "login" : "public";
  }

  function selectTestState(testId, drafts = {}, attempts = []) {
    const draft = drafts?.[testId];
    if (draft?.values && typeof draft.values === "object") {
      return { kind: "draft", draft };
    }

    const history = (Array.isArray(attempts) ? attempts : [])
      .filter((attempt) => attempt?.testId === testId)
      .slice()
      .sort((left, right) => {
        const timeDifference = Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "");
        if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
        return Number(right.id || 0) - Number(left.id || 0);
      });
    return history.length
      ? { kind: "completed", attempt: history[0], history }
      : { kind: "new", history: [] };
  }

  function buildCompletedAttemptResult(test, attempt) {
    const review = attempt?.review && typeof attempt.review === "object" ? attempt.review : null;
    const questionResults = review?.questionResults && typeof review.questionResults === "object"
      ? review.questionResults
      : {};
    const hasReviewData = Object.keys(questionResults).length > 0;

    const earnedPoints = Number.isInteger(attempt?.scorePoints) ? attempt.scorePoints : null;
    const totalPoints = Number.isInteger(attempt?.scoreTotal) ? attempt.scoreTotal : null;
    const percent = attempt?.scorePercent !== null
      && attempt?.scorePercent !== undefined
      && Number.isFinite(Number(attempt.scorePercent))
      ? Number(attempt.scorePercent)
      : null;

    return {
      hasReviewData,
      result: {
        earnedPoints,
        totalPoints,
        percent,
        correctQuestions: hasReviewData ? Number(review.correctQuestions) : null,
        gradedQuestions: hasReviewData ? Number(review.gradedQuestions) : null,
        ungradedPoints: hasReviewData
          ? Number(review.ungradedPoints || 0)
          : totalPoints === null ? 0 : Math.max(0, Number(test?.totalPoints || 0) - totalPoints),
        questionResults,
      },
    };
  }

  return {
    buildCompletedAttemptResult,
    hashForRoute,
    routeFromHash,
    selectTestState,
    startupViewFor,
  };
}));
