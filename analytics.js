const METRIKA_ID = "METRIKA_ID_HERE";

(() => {
    "use strict";

    const CONSENT_KEY = "analytics_consent";
    const ALLOWED_GOALS = new Set([
        "cabinet_click",
        "program_click",
        "program_view",
        "about_view",
        "materials_view"
    ]);

    let metrikaState = "idle";
    let metrikaPromise = null;
    const viewedSections = new Set();

    function readConsent() {
        try {
            const value = localStorage.getItem(CONSENT_KEY);
            return value === "accepted" || value === "rejected" ? value : null;
        } catch {
            return null;
        }
    }

    function writeConsent(value) {
        try {
            localStorage.setItem(CONSENT_KEY, value);
            return true;
        } catch {
            return false;
        }
    }

    function removeConsent() {
        try {
            localStorage.removeItem(CONSENT_KEY);
        } catch {
            // При недоступном localStorage аналитика всё равно останется выключенной.
        }
    }

    function hasConfiguredCounter() {
        return /^\d{4,}$/.test(String(METRIKA_ID));
    }

    function hasAnalyticsConsent() {
        return readConsent() === "accepted";
    }

    function loadMetrika() {
        if (!hasAnalyticsConsent() || !hasConfiguredCounter()) {
            return Promise.resolve(false);
        }
        if (metrikaState === "ready") return Promise.resolve(true);
        if (metrikaPromise) return metrikaPromise;

        metrikaState = "loading";
        metrikaPromise = new Promise((resolve) => {
            window.ym = window.ym || function () {
                (window.ym.a = window.ym.a || []).push(arguments);
            };
            window.ym.l = window.ym.l || Date.now();

            const script = document.createElement("script");
            script.async = true;
            script.src = "https://mc.yandex.ru/metrika/tag.js";
            script.dataset.analyticsProvider = "yandex-metrika";
            script.addEventListener("load", () => {
                window.ym(Number(METRIKA_ID), "init", {
                    clickmap: true,
                    trackLinks: true,
                    accurateTrackBounce: true,
                    webvisor: false
                });
                metrikaState = "ready";
                window.dispatchEvent(new CustomEvent("site-analytics-ready"));
                resolve(true);
            }, { once: true });
            script.addEventListener("error", () => {
                metrikaState = "idle";
                metrikaPromise = null;
                resolve(false);
            }, { once: true });
            document.head.appendChild(script);
        });

        return metrikaPromise;
    }

    function trackGoal(goalName) {
        if (!ALLOWED_GOALS.has(goalName)) return false;
        if (!hasAnalyticsConsent() || !hasConfiguredCounter()) return false;
        if (metrikaState !== "ready" || typeof window.ym !== "function") return false;
        window.ym(Number(METRIKA_ID), "reachGoal", goalName);
        return true;
    }

    function setBannerVisibility() {
        const banner = document.getElementById("cookieBanner");
        if (!banner) return;
        banner.hidden = readConsent() !== null;
    }

    function acceptAnalytics() {
        writeConsent("accepted");
        setBannerVisibility();
        loadMetrika();
    }

    function rejectAnalytics() {
        writeConsent("rejected");
        setBannerVisibility();
    }

    function resetAnalyticsConsent() {
        removeConsent();
        window.location.reload();
    }

    function isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0
            && rect.top < window.innerHeight
            && rect.right > 0
            && rect.left < window.innerWidth;
    }

    function bindGoalTracking() {
        document.addEventListener("click", (event) => {
            const target = event.target instanceof Element
                ? event.target.closest("[data-analytics-goal]")
                : null;
            if (!target) return;
            trackGoal(target.dataset.analyticsGoal);
        });

        const sections = Array.from(document.querySelectorAll("[data-analytics-view]"));
        if (!("IntersectionObserver" in window) || !sections.length) return;

        const tryTrackSection = (section, observer) => {
            const goalName = section.dataset.analyticsView;
            if (viewedSections.has(goalName) || !isInViewport(section)) return;
            if (trackGoal(goalName)) {
                viewedSections.add(goalName);
                observer.unobserve(section);
            }
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) tryTrackSection(entry.target, observer);
            });
        }, { threshold: 0.3 });

        sections.forEach((section) => observer.observe(section));
        window.addEventListener("site-analytics-ready", () => {
            sections.forEach((section) => tryTrackSection(section, observer));
        });
    }

    function bindConsentControls() {
        document.querySelectorAll("[data-cookie-accept]").forEach((button) => {
            button.addEventListener("click", acceptAnalytics);
        });
        document.querySelectorAll("[data-cookie-reject]").forEach((button) => {
            button.addEventListener("click", rejectAnalytics);
        });
        document.querySelectorAll("[data-cookie-settings]").forEach((button) => {
            button.addEventListener("click", resetAnalyticsConsent);
        });
        setBannerVisibility();
    }

    function initializeAnalytics() {
        bindConsentControls();
        bindGoalTracking();
        if (hasAnalyticsConsent()) loadMetrika();
    }

    window.trackGoal = trackGoal;
    window.siteAnalytics = {
        accept: acceptAnalytics,
        reject: rejectAnalytics,
        reset: resetAnalyticsConsent,
        getConsent: readConsent,
        isConfigured: hasConfiguredCounter,
        load: loadMetrika
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeAnalytics, { once: true });
    } else {
        initializeAnalytics();
    }
})();
