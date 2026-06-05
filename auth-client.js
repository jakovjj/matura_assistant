(function () {
  const widgets = document.querySelectorAll("[data-auth-widget]");
  const authPage = document.querySelector("[data-auth-page]");
  const hasAuthUi = widgets.length || authPage;

  const analyticsConsentCookieName = "azm_analytics_consent";
  const analyticsConsentMaxAgeSeconds = 180 * 24 * 60 * 60;
  const validAnalyticsConsentChoices = new Set(["granted", "denied"]);
  const oauthErrors = {
    oauth_code: "Prijava nije uspjela. Pokušaj ponovno.",
    oauth_denied: "Prijava je otkazana.",
    oauth_exchange: "Prijava nije uspjela. Pokušaj ponovno.",
    oauth_state: "Prijava je istekla. Pokušaj ponovno.",
    oauth_unavailable: "Google prijava još nije konfigurirana.",
  };

  const state = {
    loading: true,
    user: null,
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function readCookie(name) {
    const rawValue = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) || "";

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  function writeCookie(name, value, maxAgeSeconds) {
    const secure = window.location.protocol === "https:" ? "Secure" : "";
    document.cookie = [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
      secure,
    ]
      .filter(Boolean)
      .join("; ");
  }

  function storedAnalyticsConsent() {
    const activeChoice = window.AsistentAnalytics?.getConsent?.();
    if (validAnalyticsConsentChoices.has(activeChoice)) return activeChoice;

    const cookieChoice = readCookie(analyticsConsentCookieName);
    return validAnalyticsConsentChoices.has(cookieChoice) ? cookieChoice : "";
  }

  function icon(iconName, className) {
    if (window.renderLucideIcon) return window.renderLucideIcon(iconName, className);

    return `
      <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <use href="./assets/lucide-icons.svg#${iconName}"></use>
      </svg>
    `;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("API nije dostupan.");

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Zahtjev nije uspio.");
    return data;
  }

  function currentReturnPath() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function normalizeReturnPath(value) {
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
      ? value
      : "/";
  }

  function authPageHref() {
    return `./prijava.html?next=${encodeURIComponent(currentReturnPath())}`;
  }

  function googleLoginHref() {
    const next = normalizeReturnPath(new URLSearchParams(window.location.search).get("next"));
    return `/api/auth/google?next=${encodeURIComponent(next)}`;
  }

  function renderWidgets() {
    widgets.forEach((widget) => {
      if (state.loading) {
        widget.innerHTML = `<span class="auth-widget__status">Provjera prijave...</span>`;
        return;
      }

      if (state.user) {
        widget.innerHTML = `
          <a class="auth-widget__user" href="./profil.html" title="${escapeHtml(state.user.email)}">
            ${escapeHtml(state.user.email)}
          </a>
          <button class="auth-widget__logout" type="button" data-auth-logout>
            Odjava
          </button>
        `;
        return;
      }

      widget.innerHTML = `
        <a class="auth-widget__button" href="${escapeHtml(authPageHref())}">
          Prijavi se
        </a>
      `;
    });
  }

  function renderAuthPage() {
    if (!authPage) return;

    if (state.loading) {
      authPage.innerHTML = authCard({
        intro: "Provjeravam postoji li aktivna prijava.",
        title: "Provjera prijave",
      });
      return;
    }

    if (state.user) {
      authPage.innerHTML = authCard({
        body: `
          <p class="auth-page-card__intro">Možeš nastaviti s vježbom mature.</p>
          <p class="auth-page-card__user" title="${escapeHtml(state.user.email)}">
            ${escapeHtml(state.user.email)}
          </p>
          <div class="auth-page-card__actions">
            <a class="primary-button" href="./">Nastavi na vježbe</a>
            <a class="secondary-button" href="./profil.html">Otvori profil</a>
            <button class="secondary-button" type="button" data-auth-logout>Odjava</button>
          </div>
        `,
        title: "Prijavljen si",
      });
      return;
    }

    const error = oauthErrors[new URLSearchParams(window.location.search).get("auth_error")];

    authPage.innerHTML = authCard({
      body: `
        <p class="auth-page-card__intro">
          Prijavi se za spremanje napretka na svojim uređajima.
        </p>
        ${error ? `<p class="auth-page-card__message" data-tone="error">${escapeHtml(error)}</p>` : ""}
        <div class="auth-page-card__google-action">
          <a class="auth-google-button" href="${escapeHtml(googleLoginHref())}">
            <img
              class="auth-google-button__mark"
              src="./assets/google-g.webp"
              alt=""
              width="20"
              height="20"
            />
            <span>Nastavi s Googleom</span>
          </a>
        </div>
        <p class="auth-page-card__note">
          Neslužbeni projekt.
        </p>
      `,
      title: "Prijava",
    });
  }

  function authCard({ body, eyebrow = "Asistent za maturu", intro, title }) {
    return `
      <article class="auth-page-card">
        <div class="auth-page-card__brand">
          <img
            class="auth-page-card__logo"
            src="./assets/asistent_za_maturu.webp"
            alt=""
            width="56"
            height="56"
            decoding="async"
          />
          <div>
            <p class="eyebrow">${escapeHtml(eyebrow)}</p>
            <h1>${escapeHtml(title)}</h1>
          </div>
        </div>
        ${body || `<p class="auth-page-card__intro">${escapeHtml(intro)}</p>`}
      </article>
    `;
  }

  async function loadAuthState() {
    try {
      const session = await api("/api/auth/me");
      state.user = session.authenticated ? session.user : null;
      if (state.user) {
        window.AsistentAnalytics?.completeLogin?.();
        window.AsistentProfile?.syncPracticeProgress?.();
      }
    } catch {
      state.user = null;
    } finally {
      state.loading = false;
      renderWidgets();
      renderAuthPage();
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", {
        body: "{}",
        method: "POST",
      });
    } finally {
      state.user = null;
      renderWidgets();
      renderAuthPage();
    }
  }

  function renderCookieNotice({ force = false } = {}) {
    if (!force && storedAnalyticsConsent()) return;
    if (document.querySelector("[data-cookie-notice]")) return;

    const notice = document.createElement("aside");
    notice.className = "cookie-notice";
    notice.dataset.cookieNotice = "";
    notice.setAttribute("aria-label", "Obavijest o kolačićima");
    notice.innerHTML = `
      <div class="cookie-notice__icon">
        ${icon("cookie", "cookie-notice__symbol")}
      </div>
      <div class="cookie-notice__content">
        <strong>Kolačići</strong>
        <p>
          Želiš li dopustiti analitičke kolačiće za poboljšanje stranice?
        </p>
      </div>
      <div class="cookie-notice__actions">
        <button class="secondary-button cookie-notice__button" type="button" data-cookie-reject>
          Samo nužni
        </button>
        <button class="primary-button cookie-notice__button" type="button" data-cookie-accept>
          Dopusti
        </button>
      </div>
    `;

    document.body.append(notice);
  }

  function chooseAnalyticsConsent(choice) {
    if (!validAnalyticsConsentChoices.has(choice)) return;

    writeCookie(analyticsConsentCookieName, choice, analyticsConsentMaxAgeSeconds);
    window.AsistentAnalytics?.setConsent?.(choice);
    document.querySelector("[data-cookie-notice]")?.remove();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-auth-logout]")) {
      logout();
      return;
    }

    if (event.target.closest("[data-cookie-accept]")) {
      chooseAnalyticsConsent("granted");
      return;
    }

    if (event.target.closest("[data-cookie-reject]")) {
      chooseAnalyticsConsent("denied");
      return;
    }

    if (event.target.closest("[data-analytics-settings]")) renderCookieNotice({ force: true });
  });

  renderWidgets();
  renderAuthPage();
  renderCookieNotice();
  if (hasAuthUi) loadAuthState();
})();
