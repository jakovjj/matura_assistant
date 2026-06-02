(function () {
  const widgets = document.querySelectorAll("[data-auth-widget]");
  if (!widgets.length) return;

  const cookieNoticeName = "azm_cookie_notice";

  const state = {
    available: true,
    dialog: null,
    loading: true,
    mode: "login",
    user: null,
  };

  const modeCopy = {
    login: {
      button: "Prijavi se",
      intro: "Upiši adresu i lozinku koju si koristio pri izradi računa.",
      passwordAutocomplete: "current-password",
      title: "Prijava",
    },
    signup: {
      button: "Napravi račun",
      intro: "Za prototip se prihvaća bilo koja @skole.hr adresa. E-mail se ne potvrđuje.",
      passwordAutocomplete: "new-password",
      title: "Novi račun",
    },
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(iconName, className) {
    return `
      <svg class="${className}" aria-hidden="true">
        <use href="./assets/lucide-icons.svg#${iconName}"></use>
      </svg>
    `;
  }

  function readCookie(name) {
    return document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  }

  function writeCookie(name, value, maxAgeSeconds) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
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
    if (!contentType.includes("application/json")) {
      throw new Error("Prijava nije dostupna na ovom poslužitelju.");
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Zahtjev nije uspio.");
    }
    return data;
  }

  function renderWidgets() {
    widgets.forEach((widget) => {
      if (state.loading) {
        widget.innerHTML = `<span class="auth-widget__status">Provjera prijave...</span>`;
        return;
      }

      if (state.user) {
        widget.innerHTML = `
          <span class="auth-widget__user" title="${escapeHtml(state.user.email)}">
            ${escapeHtml(state.user.email)}
          </span>
          <button class="auth-widget__button auth-widget__button--secondary" type="button" data-auth-logout>
            Odjava
          </button>
        `;
        return;
      }

      widget.innerHTML = `
        <button class="auth-widget__button" type="button" data-auth-open data-auth-start-mode="login">
          Prijavi se
        </button>
        <button
          class="auth-widget__button auth-widget__button--secondary"
          type="button"
          data-auth-open
          data-auth-start-mode="signup"
        >
          Registriraj se
        </button>
      `;
    });
  }

  function ensureDialog() {
    if (state.dialog) return state.dialog;

    const dialog = document.createElement("div");
    dialog.className = "auth-dialog";
    dialog.hidden = true;
    dialog.innerHTML = `
      <div class="auth-dialog__backdrop" data-auth-close></div>
      <section
        class="auth-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
      >
        <button class="auth-dialog__close" type="button" data-auth-close aria-label="Zatvori prijavu">
          ×
        </button>
        <p class="eyebrow">Školski račun</p>
        <h2 id="auth-dialog-title"></h2>
        <p data-auth-intro></p>
        <div class="auth-dialog__tabs" role="tablist" aria-label="Odabir prijave">
          <button type="button" data-auth-mode="login">Prijava</button>
          <button type="button" data-auth-mode="signup">Novi račun</button>
        </div>
        <form class="auth-form" data-auth-form>
          <label class="field">
            <span>E-mail adresa</span>
            <input
              name="email"
              type="email"
              inputmode="email"
              autocomplete="username"
              placeholder="ime.prezime@skole.hr"
              required
            />
          </label>
          <label class="field">
            <span>Lozinka</span>
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>
          <button class="primary-button auth-form__submit" type="submit"></button>
        </form>
        <p class="auth-dialog__message" data-auth-message hidden></p>
      </section>
    `;

    document.body.append(dialog);
    state.dialog = dialog;

    dialog.addEventListener("click", (event) => {
      const modeButton = event.target.closest("[data-auth-mode]");
      if (modeButton) {
        setMode(modeButton.dataset.authMode);
        return;
      }

      if (event.target.closest("[data-auth-close]")) closeDialog();
    });

    dialog.querySelector("[data-auth-form]").addEventListener("submit", async (event) => {
      event.preventDefault();

      const form = event.currentTarget;
      const submit = form.querySelector("[type='submit']");
      const formData = new FormData(form);
      submit.disabled = true;
      setDialogMessage(state.mode === "signup" ? "Izrađujem račun..." : "Prijavljujem...", "muted");

      try {
        const result = await api(`/api/auth/${state.mode === "signup" ? "signup" : "login"}`, {
          body: JSON.stringify({
            email: formData.get("email"),
            password: formData.get("password"),
          }),
          method: "POST",
        });
        state.user = result.user;
        renderWidgets();
        setDialogMessage(result.message || "Prijavljen si.", "success");
        form.reset();
        window.setTimeout(closeDialog, 250);
      } catch (error) {
        setDialogMessage(error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });

    renderDialogMode();
    return dialog;
  }

  function setMode(mode) {
    state.mode = mode === "signup" ? "signup" : "login";
    renderDialogMode();
    clearDialogMessage();
  }

  function renderDialogMode() {
    if (!state.dialog) return;

    const copy = modeCopy[state.mode];
    state.dialog.querySelector("#auth-dialog-title").textContent = copy.title;
    state.dialog.querySelector("[data-auth-intro]").textContent = copy.intro;
    state.dialog.querySelector(".auth-form__submit").textContent = copy.button;
    state.dialog.querySelector("input[name='password']").autocomplete = copy.passwordAutocomplete;
    state.dialog.querySelectorAll("[data-auth-mode]").forEach((button) => {
      const isActive = button.dataset.authMode === state.mode;
      button.classList.toggle("auth-dialog__tab--active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function clearDialogMessage() {
    if (!state.dialog) return;
    const messageNode = state.dialog.querySelector("[data-auth-message]");
    messageNode.hidden = true;
    messageNode.textContent = "";
  }

  function setDialogMessage(message, tone) {
    const messageNode = state.dialog.querySelector("[data-auth-message]");
    messageNode.textContent = message;
    messageNode.dataset.tone = tone;
    messageNode.hidden = false;
  }

  function openDialog(mode) {
    if (mode) state.mode = mode === "signup" ? "signup" : "login";
    const dialog = ensureDialog();
    renderDialogMode();
    dialog.hidden = false;
    document.body.classList.add("auth-dialog-open");
    window.setTimeout(() => dialog.querySelector("input[name='email']").focus(), 0);
  }

  function closeDialog() {
    if (!state.dialog) return;
    state.dialog.hidden = true;
    document.body.classList.remove("auth-dialog-open");
    clearDialogMessage();
  }

  async function loadUser() {
    try {
      const data = await api("/api/auth/me");
      state.available = true;
      state.user = data.authenticated ? data.user : null;
    } catch {
      state.available = false;
      state.user = null;
    } finally {
      state.loading = false;
      renderWidgets();
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
    }
  }

  function renderCookieNotice() {
    if (readCookie(cookieNoticeName) === "accepted") return;
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
          Koristimo kolačiće za prijavu i pamćenje ove obavijesti. Odgovori iz vježbi
          mogu se spremati lokalno u ovom pregledniku.
        </p>
      </div>
      <button class="primary-button cookie-notice__button" type="button" data-cookie-accept>
        U redu
      </button>
    `;

    document.body.append(notice);
  }

  function acceptCookieNotice() {
    writeCookie(cookieNoticeName, "accepted", 180 * 24 * 60 * 60);
    document.querySelector("[data-cookie-notice]")?.remove();
  }

  document.addEventListener("click", (event) => {
    const authOpenButton = event.target.closest("[data-auth-open]");
    if (authOpenButton) {
      openDialog(authOpenButton.dataset.authStartMode);
      return;
    }

    if (event.target.closest("[data-auth-logout]")) {
      logout();
      return;
    }

    if (event.target.closest("[data-cookie-accept]")) {
      acceptCookieNotice();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDialog();
  });

  renderWidgets();
  renderCookieNotice();
  loadUser();
})();
