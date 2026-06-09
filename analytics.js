(() => {
  const measurementId = "G-3W2D6EJZ94";
  const clarityTagId = "x0a1kkmiqz";
  const loginPendingKey = "azm_analytics_login_pending";
  const clarityConsent = {
    ad_Storage: "granted",
    analytics_Storage: "granted",
  };
  const solverContextByPage = {
    "abcd.html": { examPart: "višestruki izbor" },
    "engleski-citanje.html": { examPart: "Čitanje", subject: "Engleski jezik" },
    "engleski-esej.html": { examPart: "Esej", subject: "Engleski jezik" },
    "engleski-slusanje.html": { examPart: "Slušanje", subject: "Engleski jezik" },
    "fizika.html": { examPart: "Ispit", subject: "Fizika" },
    "geografija.html": { examPart: "Ispit", subject: "Geografija" },
    "hrvatski-pisanje.html": { examPart: "Pisanje", subject: "Hrvatski jezik" },
    "hrvatski.html": { examPart: "Ispit", subject: "Hrvatski jezik" },
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

  function applyClarityConsent() {
    window.clarity("consentv2", clarityConsent);
  }

  function setAnalyticsConsentDefaults() {
    window.gtag("consent", "default", {
      ad_personalization: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      analytics_storage: "granted",
      functionality_storage: "granted",
      personalization_storage: "denied",
      security_storage: "granted",
    });
    applyClarityConsent();
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
  setClarityContext();

  window.AsistentAnalytics = {
    completeLogin,
    track,
  };

  recordPageview();
  document.addEventListener("click", trackClick);
  document.addEventListener("play", (event) => {
    if (event.target instanceof HTMLAudioElement) track("audio_play");
  }, true);
  loadClarity();
  scheduleGoogleAnalytics();
})();
