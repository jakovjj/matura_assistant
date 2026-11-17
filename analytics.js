// Colour theme bootstrap.
// analytics.js is the first parser-blocking <head> script on every page, so
// applying the persisted theme here runs before first paint and avoids a flash
// of light mode for users who chose dark. Default is light (no attribute set).
// The toggle lives in profile settings and drives this via window.AsistentTheme.
(() => {
  const THEME_KEY = "asistent-za-mature:theme";

  const readTheme = () => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  };

  const applyTheme = (theme) => {
    const root = document.documentElement;
    if (theme === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
  };

  const setTheme = (theme) => {
    const next = theme === "dark" ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Theme preference simply won't persist if storage is unavailable.
    }
    applyTheme(next);
    return next;
  };

  applyTheme(readTheme());

  window.AsistentTheme = {
    STORAGE_KEY: THEME_KEY,
    get: readTheme,
    set: setTheme,
    apply: applyTheme,
  };
})();

(() => {
  const measurementId = "G-3W2D6EJZ94";
  const clarityTagId = "x0a1kkmiqz";
  const loginPendingKey = "azm_analytics_login_pending";
  const consentKey = "asistent-za-mature:cookie-consent";
  // Holds the choice for this page view when localStorage is unavailable.
  let consentOverride = "";
  const solverContextByPage = {
    "abcd.html": { examPart: "višestruki izbor" },
    "engleski-citanje.html": { examPart: "Čitanje", subject: "Engleski jezik" },
    "engleski-esej.html": { examPart: "Esej", subject: "Engleski jezik" },
    "engleski-slusanje.html": { examPart: "Slušanje", subject: "Engleski jezik" },
    "fizika.html": { examPart: "Ispit", subject: "Fizika" },
    "geografija.html": { examPart: "Ispit", subject: "Geografija" },
    "hrvatski-pisanje.html": { examPart: "Pisanje", subject: "Hrvatski jezik" },
    "hrvatski.html": { examPart: "Ispit", subject: "Hrvatski jezik" },
    "informatika.html": { examPart: "Ispit", subject: "Informatika" },
    "kemija.html": { examPart: "Ispit", subject: "Kemija" },
    "matematika.html": { examPart: "Ispit", subject: "Matematika" },
    "politika.html": { examPart: "Ispit", subject: "Politika i gospodarstvo" },
    "povijest.html": { examPart: "Ispit", subject: "Povijest" },
    "sociologija.html": { examPart: "Ispit", subject: "Sociologija" },
  };

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtagQueue() {
    window.dataLayer.push(arguments);
  };
  window.clarity = window.clarity || function clarityQueue() {
    (window.clarity.q = window.clarity.q || []).push(arguments);
  };

  function clearLegacyConsentCookie() {
    const domains = ["", window.location.hostname, ".matura.com.hr"];

    for (const domain of domains) {
      const domainAttribute = domain ? `; Domain=${domain}` : "";
      document.cookie = `azm_analytics_consent=; Path=/; Max-Age=0; SameSite=Lax${domainAttribute}`;
    }
  }

  // Cookie consent is all-or-nothing: "granted" loads GA + Clarity, "denied"
  // (or no choice yet) loads neither. The first-party /api/pageview counter
  // sets no cookies and always runs.
  function readConsent() {
    try {
      const value = localStorage.getItem(consentKey);
      if (value === "granted" || value === "denied") return value;
    } catch {
      // Fall through to the in-memory choice.
    }
    return consentOverride;
  }

  function hasConsent() {
    return readConsent() === "granted";
  }

  function clarityConsentState() {
    const state = hasConsent() ? "granted" : "denied";
    return { ad_Storage: state, analytics_Storage: state };
  }

  function applyClarityConsent() {
    window.clarity("consentv2", clarityConsentState());
  }

  function setAnalyticsConsentDefaults() {
    window.gtag("consent", "default", {
      ad_personalization: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      analytics_storage: hasConsent() ? "granted" : "denied",
      functionality_storage: "granted",
      personalization_storage: "denied",
      security_storage: "granted",
    });
    applyClarityConsent();
  }

  function clearAnalyticsCookies() {
    const host = window.location.hostname;
    const domains = ["", host, `.${host.replace(/^www\./, "")}`];
    const names = document.cookie
      .split(";")
      .map((part) => part.split("=")[0].trim())
      .filter((name) => /^(_ga|_gid|_gat|_clck|_clsk|CLID|MUID|ANONCHK)/.test(name));

    for (const name of names) {
      for (const domain of domains) {
        const domainAttribute = domain ? `; Domain=${domain}` : "";
        document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${domainAttribute}`;
      }
    }
  }

  function pageName() {
    return window.location.pathname.split("/").filter(Boolean).at(-1) || "index.html";
  }

  function pageContext() {
    const params = new URLSearchParams(window.location.search);
    const page = pageName();
    const solverContext = solverContextByPage[page];
    let pageType = "page";

    if (page === "index.html") {
      if (params.has("ispit")) pageType = "exam_detail";
      else if (params.has("predmet")) pageType = "subject";
      else pageType = "home";
    } else if (page === "prijava.html") {
      pageType = "login";
    } else if (page === "profil.html") {
      pageType = "profile";
    } else if (solverContext) {
      pageType = "solver";
    }

    return cleanParameters({
      azm_exam_id: params.get("exam") || params.get("ispit") || "",
      azm_exam_part: params.get("cjelina") || solverContext?.examPart || "",
      azm_mode: solverContext
        ? params.get("nacin") === "simulacija"
          ? "simulation"
          : "practice"
        : "",
      azm_page_type: pageType,
      azm_subject: params.get("predmet") || solverContext?.subject || "",
    });
  }

  function cleanParameters(parameters) {
    return Object.fromEntries(
      Object.entries(parameters || {})
        .filter(([, value]) => value !== "" && value != null)
        .map(([key, value]) => {
          if (typeof value === "number") return [key, Number.isFinite(value) ? value : 0];
          if (typeof value === "boolean") return [key, value];
          return [key, String(value).slice(0, 100)];
        }),
    );
  }

  function setClarityContext() {
    for (const [key, value] of Object.entries(pageContext())) {
      window.clarity("set", key, value);
    }
  }

  function track(eventName, parameters = {}) {
    if (!hasConsent()) return;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(eventName)) return;

    window.gtag("event", eventName, {
      ...pageContext(),
      ...cleanParameters(parameters),
    });
    window.clarity("event", eventName);
  }

  function targetParameters(element) {
    const href = element instanceof HTMLAnchorElement ? element.href : "";
    const url = href ? new URL(href, window.location.href) : null;
    const fileName = url?.pathname.split("/").filter(Boolean).at(-1) || "";

    return cleanParameters({
      target_exam_id: url?.searchParams.get("exam") || url?.searchParams.get("ispit") || "",
      target_exam_part: url?.searchParams.get("cjelina") || "",
      target_file: fileName,
      target_mode: url?.searchParams.get("nacin") || "",
      target_subject: url?.searchParams.get("predmet") || "",
    });
  }

  function trackClick(event) {
    const control = event.target instanceof Element
      ? event.target.closest("a, button")
      : null;
    if (!control) return;

    if (control.matches(".home-news__item a")) {
      const titleEl = control.querySelector(".home-news__title");
      track("news_open", {
        news_title: titleEl ? titleEl.textContent.trim() : "",
        link_url: control instanceof HTMLAnchorElement ? control.href : "",
      });
      return;
    }
    if (control.matches(".subject-card[href]")) {
      track("subject_open", targetParameters(control));
      return;
    }
    if (control.matches(".exam-actions .primary-button")) {
      track("exam_open", targetParameters(control));
      return;
    }
    if (control.matches(".download-icon-link")) {
      track("exam_download", targetParameters(control));
      return;
    }
    if (control.closest(".practice-exam-row__actions")) {
      const isSimulation = control.textContent.includes("Simuliraj");
      track(isSimulation ? "simulation_open" : "practice_open", targetParameters(control));
      return;
    }
    if (control.matches("[data-year-link]")) {
      track("year_select", { year: control.dataset.yearLink });
      return;
    }
    if (control.matches("#check-answers")) {
      track("exam_check");
      return;
    }
    if (control.matches("[data-self-check]") && control.getAttribute("aria-pressed") !== "true") {
      track("task_check", { task_id: control.dataset.selfCheck });
      return;
    }
    if (control.matches("[data-open-solution]")) {
      track("solution_open", { task_id: control.dataset.openSolution });
      return;
    }
    if (control.matches(".auth-google-button")) {
      try {
        window.sessionStorage.setItem(loginPendingKey, "Google");
      } catch {
        // Analytics still records the login start when session storage is unavailable.
      }
      track("login_start", { method: "Google" });
      return;
    }
    if (control.matches("[data-auth-logout]")) {
      track("logout");
    }
  }

  function completeLogin() {
    let method = "";
    try {
      method = window.sessionStorage.getItem(loginPendingKey) || "";
      window.sessionStorage.removeItem(loginPendingKey);
    } catch {
      return;
    }

    if (method) track("login", { method });
  }

  function recordPageview() {
    const context = pageContext();
    const payload = JSON.stringify({
      subject: context.azm_subject || "",
      page: pageName(),
    });

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/pageview", new Blob([payload], { type: "application/json" }));
        return;
      }
    } catch {
      // Pad na fetch ako sendBeacon nije dostupan ili baci iznimku.
    }

    try {
      fetch("/api/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Brojač pregleda nikad ne smije srušiti stranicu.
    }
  }

  function loadGoogleAnalytics() {
    if (document.querySelector(`[data-ga4-tag="${measurementId}"]`)) return;

    const script = document.createElement("script");
    script.async = true;
    script.dataset.ga4Tag = measurementId;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(script);
  }

  function loadClarity() {
    if (document.querySelector(`[data-clarity-tag="${clarityTagId}"]`)) {
      applyClarityConsent();
      setClarityContext();
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.clarityTag = clarityTagId;
    script.src = `https://www.clarity.ms/tag/${clarityTagId}`;
    script.addEventListener("load", () => {
      applyClarityConsent();
      setClarityContext();
    });
    document.head.append(script);
  }

  function scheduleGoogleAnalytics() {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadGoogleAnalytics, { timeout: 1500 });
      return;
    }

    window.setTimeout(loadGoogleAnalytics, 0);
  }

  function startThirdPartyAnalytics() {
    setClarityContext();
    loadClarity();
    scheduleGoogleAnalytics();
  }

  function setConsent(value) {
    const next = value === "granted" ? "granted" : "denied";
    const wasGranted = hasConsent();
    try {
      localStorage.setItem(consentKey, next);
    } catch {
      // Without storage the choice holds only for this page view.
    }
    consentOverride = next;

    window.gtag("consent", "update", { analytics_storage: next });
    applyClarityConsent();
    if (next === "granted" && !wasGranted) startThirdPartyAnalytics();
    if (next === "denied") clearAnalyticsCookies();
    document.querySelector(".cookie-consent")?.remove();
    return next;
  }

  function renderConsentPrompt() {
    if (readConsent() || document.querySelector(".cookie-consent")) return;

    const prompt = document.createElement("div");
    prompt.className = "cookie-consent";
    prompt.setAttribute("role", "region");
    prompt.setAttribute("aria-label", "Kolačići");
    prompt.innerHTML = `
      <p>Koristimo kolačiće za analitiku posjeta.</p>
      <div class="cookie-consent__actions">
        <button type="button" data-cookie-consent="denied">Odbij</button>
        <button type="button" data-cookie-consent="granted">Prihvati</button>
      </div>
    `;
    prompt.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-cookie-consent]")
        : null;
      if (button) setConsent(button.dataset.cookieConsent);
    });
    document.body.append(prompt);
  }

  clearLegacyConsentCookie();
  setAnalyticsConsentDefaults();
  window.gtag("set", "ads_data_redaction", true);
  window.gtag("js", new Date());
  const context = pageContext();
  window.gtag("config", measurementId, {
    ...context,
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
    content_group: context.azm_page_type,
    send_page_view: true,
  });

  window.AsistentAnalytics = {
    completeLogin,
    track,
  };
  window.AsistentConsent = {
    STORAGE_KEY: consentKey,
    get: readConsent,
    set: setConsent,
  };

  recordPageview();
  document.addEventListener("click", trackClick);
  document.addEventListener("play", (event) => {
    if (event.target instanceof HTMLAudioElement) track("audio_play");
  }, true);

  if (hasConsent()) startThirdPartyAnalytics();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderConsentPrompt, { once: true });
  } else {
    renderConsentPrompt();
  }
})();
