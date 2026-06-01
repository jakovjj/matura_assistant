(function () {
  const widgets = document.querySelectorAll("[data-auth-widget]");
  if (!widgets.length) return;

  const state = {
    available: true,
    dialog: null,
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

  function currentReturnTo() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
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

      if (!state.available) {
        widget.innerHTML = `<span class="auth-widget__status">Prijava nije uključena</span>`;
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
        <button class="auth-widget__button" type="button" data-auth-open>
          Prijava @skole.hr
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
        <p class="eyebrow">Školski e-mail</p>
        <h2 id="auth-dialog-title">Prijava @skole.hr adresom</h2>
        <p>
          Upiši školsku e-mail adresu. Poslat ćemo poveznicu za prijavu.
          Ovo nije AAI@EduHr prijava.
        </p>
        <form class="auth-form" data-auth-form>
          <label class="field">
            <span>E-mail adresa</span>
            <input
              name="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="ime.prezime@skole.hr"
              required
            />
          </label>
          <button class="primary-button auth-form__submit" type="submit">Pošalji poveznicu</button>
        </form>
        <p class="auth-dialog__message" data-auth-message hidden></p>
      </section>
    `;

    document.body.append(dialog);
    state.dialog = dialog;

    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-auth-close]")) closeDialog();
    });

    dialog.querySelector("[data-auth-form]").addEventListener("submit", async (event) => {
      event.preventDefault();

      const form = event.currentTarget;
      const submit = form.querySelector("[type='submit']");
      const email = new FormData(form).get("email");
      submit.disabled = true;
      setDialogMessage("Šaljem poveznicu...", "muted");

      try {
        const result = await api("/api/auth/magic-link", {
          body: JSON.stringify({ email, returnTo: currentReturnTo() }),
          method: "POST",
        });
        setDialogMessage(result.message || "Provjeri svoj @skole.hr e-mail.", "success");
        form.reset();
      } catch (error) {
        setDialogMessage(error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });

    return dialog;
  }

  function setDialogMessage(message, tone) {
    const messageNode = state.dialog.querySelector("[data-auth-message]");
    messageNode.textContent = message;
    messageNode.dataset.tone = tone;
    messageNode.hidden = false;
  }

  function openDialog() {
    const dialog = ensureDialog();
    dialog.hidden = false;
    document.body.classList.add("auth-dialog-open");
    setTimeout(() => dialog.querySelector("input[name='email']").focus(), 0);
  }

  function closeDialog() {
    if (!state.dialog) return;
    state.dialog.hidden = true;
    document.body.classList.remove("auth-dialog-open");
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

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-auth-open]")) {
      openDialog();
      return;
    }

    if (event.target.closest("[data-auth-logout]")) {
      logout();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDialog();
  });

  renderWidgets();
  loadUser();
})();
