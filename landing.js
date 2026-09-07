(() => {
    "use strict";

    const landing = document.getElementById("welcomeView");
    if (!landing) return;

    const menuButton = document.getElementById("landingMenuButton");
    const navigation = document.getElementById("landingNavigation");
    const lightbox = document.getElementById("landingLightbox");
    let lightboxTrigger = null;

    function closeMenu() {
        if (!menuButton || !navigation) return;
        menuButton.setAttribute("aria-expanded", "false");
        navigation.classList.remove("is-open");
    }

    if (menuButton && navigation) {
        menuButton.addEventListener("click", () => {
            const willOpen = menuButton.getAttribute("aria-expanded") !== "true";
            menuButton.setAttribute("aria-expanded", String(willOpen));
            navigation.classList.toggle("is-open", willOpen);
        });

        navigation.addEventListener("click", (event) => {
            if (event.target instanceof Element && event.target.closest("a")) closeMenu();
        });

        document.addEventListener("click", (event) => {
            if (!navigation.classList.contains("is-open") || !(event.target instanceof Node)) return;
            if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
        });
    }

    landing.querySelectorAll(".landing-faq-item h3 button").forEach((button) => {
        button.addEventListener("click", () => {
            const answerId = button.getAttribute("aria-controls");
            const answer = answerId ? document.getElementById(answerId) : null;
            if (!answer) return;

            const willOpen = button.getAttribute("aria-expanded") !== "true";
            landing.querySelectorAll(".landing-faq-item h3 button").forEach((otherButton) => {
                const otherAnswerId = otherButton.getAttribute("aria-controls");
                const otherAnswer = otherAnswerId ? document.getElementById(otherAnswerId) : null;
                otherButton.setAttribute("aria-expanded", "false");
                if (otherAnswer) otherAnswer.hidden = true;
            });
            button.setAttribute("aria-expanded", String(willOpen));
            answer.hidden = !willOpen;
        });
    });

    function closeLightbox() {
        if (!lightbox || lightbox.hidden) return;
        lightbox.hidden = true;
        document.body.style.removeProperty("overflow");
        lightboxTrigger?.focus();
        lightboxTrigger = null;
    }

    landing.querySelectorAll("[data-lightbox-src]").forEach((button) => {
        button.addEventListener("click", () => {
            if (!lightbox) return;
            const image = lightbox.querySelector("img");
            const caption = document.getElementById("landingLightboxCaption");
            const alt = button.dataset.lightboxAlt || "Документ";
            image.src = button.dataset.lightboxSrc;
            image.alt = alt;
            if (caption) caption.textContent = alt;
            lightboxTrigger = button;
            lightbox.hidden = false;
            document.body.style.overflow = "hidden";
            lightbox.querySelector(".landing-lightbox-close")?.focus();
        });
    });

    lightbox?.querySelector(".landing-lightbox-close")?.addEventListener("click", closeLightbox);
    lightbox?.addEventListener("click", (event) => {
        if (event.target === lightbox) closeLightbox();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        closeMenu();
        closeLightbox();
    });

    const revealElements = Array.from(landing.querySelectorAll(".reveal-on-scroll"));
    if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.documentElement.classList.add("landing-enhanced");
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
        revealElements.forEach((element) => observer.observe(element));
    } else {
        revealElements.forEach((element) => element.classList.add("is-visible"));
    }
})();
