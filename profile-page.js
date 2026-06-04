(function () {
  const root = document.querySelector("[data-profile-page]");
  if (!root) return;

  const profileStore = window.AsistentProfile;
  const dateFormatter = new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Nije dostupno";
    return dateFormatter.format(date);
  }

  function formatTerm(term) {
    if (!term) return "";
    return term.charAt(0).toLocaleUpperCase("hr") + term.slice(1);
  }

  function formatLevel(level) {
    return level ? `${level} razina` : "";
  }

  function formatScore(attempt) {
    if (attempt.score === null || attempt.maxScore === null || attempt.checkingSupported === false) {
      return "Nije automatski ocijenjeno";
    }
    return `${attempt.score}/${attempt.maxScore}`;
  }

  function formatPercentage(attempt) {
    if (attempt.percentage === null || attempt.checkingSupported === false) return "Nije dostupno";
    return `${attempt.percentage}%`;
  }

  function percentageTone(attempt) {
    if (attempt.percentage === null || attempt.checkingSupported === false) return "";

    const percentage = Number(attempt.percentage);
    if (!Number.isFinite(percentage)) return "";
    if (percentage >= 85) return "excellent";
    if (percentage >= 70) return "good";
    if (percentage >= 50) return "medium";
    if (percentage >= 30) return "low";
    return "poor";
  }

  function examTitle(attempt) {
    return [
      attempt.subject,
      attempt.year ? `${attempt.year}.` : "",
      formatTerm(attempt.term),
      formatLevel(attempt.level),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function loadAuthUser() {
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin" });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return null;
      const data = await response.json();
      return data.authenticated ? data.user : null;
    } catch {
      return null;
    }
  }

  async function loadServerSimulations() {
    try {
      const response = await fetch("/api/profile/simulations", { credentials: "same-origin" });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return [];
      const data = await response.json();
      return Array.isArray(data.simulations) ? data.simulations : [];
    } catch {
      return [];
    }
  }

  async function requestAgentKey(options = {}) {
    const response = await fetch("/api/profile/agent-key", {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("API nije dostupan.");

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Zahtjev nije uspio.");
    return data.agentKey;
  }

  async function loadAgentKey(user) {
    if (!user) return { configured: false, provider: "openai" };

    try {
      return await requestAgentKey();
    } catch {
      return { configured: false, provider: "openai", unavailable: true };
    }
  }

  function mergeSimulations(...lists) {
    const simulationsById = new Map();

    for (const attempt of lists.flat()) {
      if (!attempt || typeof attempt !== "object") continue;
      const key = attempt.id || `${attempt.submittedAt}:${attempt.examId}:${attempt.part}`;
      if (!key || simulationsById.has(key)) continue;
      simulationsById.set(key, attempt);
    }

    return [...simulationsById.values()].sort(
      (a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt),
    );
  }

  function renderLoading() {
    root.innerHTML = `
      <section class="profile-panel">
        <p class="profile-muted">Učitavam profil...</p>
      </section>
    `;
  }

  function renderProfile({ agentKey, localProfile, serverSimulations, user }) {
    const simulations = user
      ? mergeSimulations(serverSimulations, localProfile.simulations || [])
      : localProfile.simulations || [];
    const createdAt = user?.createdAt || localProfile.createdAt;
    const identityTitle = user?.email || "Lokalni profil";
    const identityCopy = user
      ? "Prijavljen si Google računom. Simulacije se prikazuju s računa i iz ovoga preglednika."
      : "Profil je spremljen lokalno u ovom pregledniku.";

    root.innerHTML = `
      <div class="profile-layout">
        <section class="profile-panel profile-summary" aria-labelledby="profile-summary-title">
          <div>
            <h2 id="profile-summary-title">${escapeHtml(identityTitle)}</h2>
            <p class="profile-muted">${escapeHtml(identityCopy)}</p>
          </div>

          <dl class="profile-stats">
            <div>
              <dt>Datum kreacije</dt>
              <dd>${escapeHtml(formatDate(createdAt))}</dd>
            </div>
          </dl>
        </section>

        <section class="profile-panel" aria-labelledby="profile-simulations-title">
          <div class="profile-section-heading">
            <div>
              <h2 id="profile-simulations-title">Odrađene simulacije</h2>
            </div>
          </div>
          ${simulations.length ? renderSimulationTable(simulations) : renderEmptyState()}
        </section>

        ${renderAgentKeyPanel({ agentKey, user })}
      </div>
    `;
  }

  function renderAgentKeyPanel({ agentKey, user }) {
    const heading = `
      <div class="profile-agent-key__heading">
        <span class="profile-agent-key__icon-wrap">
          <svg class="profile-agent-key__icon" aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="8" cy="12" r="3.5" />
            <path d="M11.5 12H20" />
            <path d="M16 12v3" />
            <path d="M18.5 12v2" />
          </svg>
        </span>
        <div>
          <h2>OpenAI API ključ</h2>
          <p>
            Koristit će se za provjeru točnosti otvorenih pitanja i ocjenjivanje pisanih zadataka.
          </p>
        </div>
      </div>
    `;
    const helpFooter = `
      <details class="profile-agent-key__help">
        <summary>Kako dobiti ključ?</summary>
        <div class="profile-agent-key__help-body">
          <ol>
            <li>
              Otvori
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                OpenAI API keys
              </a>.
            </li>
            <li>
              Klikni
              <a
                href="https://platform.openai.com/docs/quickstart/step-2-setup-your-api-key"
                target="_blank"
                rel="noreferrer"
              >
                Create new secret key
              </a>
              i odmah spremi prikazani ključ.
            </li>
            <li>
              Ako API pozivi ne prolaze, provjeri
              <a
                href="https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing"
                target="_blank"
                rel="noreferrer"
              >
                billing i kredite
              </a>.
            </li>
          </ol>
          <p>Puni tajni ključ prikazuje se samo pri izradi. Ne dijeli ga javno.</p>
        </div>
      </details>
    `;

    if (!user) {
      return `
        <section class="profile-panel profile-agent-key" data-agent-key-panel>
          ${heading}
          <a class="profile-agent-key__login" href="./prijava.html?next=%2Fprofil.html">
            Prijavi se za spremanje vlastitog ključa.
          </a>
          ${helpFooter}
        </section>
      `;
    }

    const configured = agentKey?.configured === true;
    const unavailable = agentKey?.unavailable === true;
    const status = unavailable ? "Status ključa trenutačno nije dostupan." : "";
    const formContent = configured
      ? `
          <div class="profile-agent-key__saved">
            <p class="profile-agent-key__saved-label">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="m8 12 3 3 5-6" />
              </svg>
              <span>Ključ spremljen</span>
            </p>
            <button class="secondary-button" type="button" data-agent-key-delete>
              Obriši ključ
            </button>
          </div>
        `
      : `
          <div class="profile-agent-key__controls">
            <input
              aria-label="Vlastiti OpenAI API ključ"
              name="apiKey"
              type="password"
              minlength="20"
              maxlength="512"
              autocomplete="off"
              spellcheck="false"
              placeholder="npr. sk-proj-abc123...xyz789"
              required
            />
            <button class="primary-button" type="submit">Spremi</button>
          </div>
          <p class="profile-agent-key__hint">
            Primjer formata: <code>sk-proj-abc123...xyz789</code>. Unesi puni ključ bez razmaka.
          </p>
        `;

    return `
      <section class="profile-panel profile-agent-key" data-agent-key-panel>
        ${heading}
        <form class="profile-agent-key__form" data-agent-key-form>
          ${formContent}
          ${status ? `<p class="profile-agent-key__status" ${unavailable ? 'data-tone="error"' : ""}>${escapeHtml(status)}</p>` : ""}
          <p class="profile-agent-key__message" data-agent-key-message hidden></p>
        </form>
        ${helpFooter}
      </section>
    `;
  }

  function setAgentKeyPending(pending) {
    root.querySelectorAll("[data-agent-key-form] button, [data-agent-key-form] input").forEach(
      (control) => {
        control.disabled = pending;
      },
    );
  }

  function showAgentKeyMessage(message, tone) {
    const messageNode = root.querySelector("[data-agent-key-message]");
    if (!messageNode) return;

    messageNode.hidden = !message;
    messageNode.dataset.tone = tone || "";
    messageNode.textContent = message;
  }

  function replaceAgentKeyPanel(agentKey, message) {
    const panel = root.querySelector("[data-agent-key-panel]");
    if (!panel) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderAgentKeyPanel({ agentKey, user: true });
    panel.replaceWith(wrapper.firstElementChild);
    showAgentKeyMessage(message, "success");
  }

  async function saveAgentKey(event) {
    event.preventDefault();

    const form = event.target;
    const formData = new FormData(form);
    setAgentKeyPending(true);
    showAgentKeyMessage("", "");

    try {
      const agentKey = await requestAgentKey({
        body: JSON.stringify({ apiKey: formData.get("apiKey") }),
        method: "PUT",
      });
      replaceAgentKeyPanel(agentKey, "OpenAI API ključ je spremljen.");
    } catch (error) {
      showAgentKeyMessage(error.message || "Spremanje ključa nije uspjelo.", "error");
      setAgentKeyPending(false);
    }
  }

  async function deleteAgentKey() {
    if (!window.confirm("Obrisati spremljeni OpenAI API ključ?")) return;

    setAgentKeyPending(true);
    showAgentKeyMessage("", "");

    try {
      const agentKey = await requestAgentKey({ method: "DELETE" });
      replaceAgentKeyPanel(agentKey, "OpenAI API ključ je obrisan.");
    } catch (error) {
      showAgentKeyMessage(error.message || "Brisanje ključa nije uspjelo.", "error");
      setAgentKeyPending(false);
    }
  }

  function renderEmptyState() {
    return `
      <div class="profile-empty">
        <h3>Nema predanih simulacija.</h3>
        <p>Simulacija se upisuje kada u simulacijskom načinu pritisneš Predaj simulaciju.</p>
      </div>
    `;
  }

  function renderSimulationTable(simulations) {
    return `
      <div class="profile-table-wrap">
        <table class="profile-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Ispit</th>
              <th>Cjelina</th>
              <th>Odgovori</th>
              <th>Bodovi</th>
              <th>Postotak</th>
            </tr>
          </thead>
          <tbody>
            ${simulations.map(renderSimulationRow).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSimulationRow(attempt) {
    const answered =
      attempt.answered !== null && attempt.totalQuestions !== null
        ? `${attempt.answered}/${attempt.totalQuestions}`
        : "Nije dostupno";
    const percentage = formatPercentage(attempt);
    const tone = percentageTone(attempt);

    return `
      <tr>
        <td>${escapeHtml(formatDate(attempt.submittedAt))}</td>
        <td>
          <strong>${escapeHtml(examTitle(attempt))}</strong>
        </td>
        <td>${escapeHtml(attempt.part || "Cijeli ispit")}</td>
        <td>${escapeHtml(answered)}</td>
        <td>${escapeHtml(formatScore(attempt))}</td>
        <td>
          <span class="profile-percentage${tone ? ` profile-percentage--${tone}` : ""}">
            ${escapeHtml(percentage)}
          </span>
        </td>
      </tr>
    `;
  }

  async function init() {
    if (!profileStore) {
      root.innerHTML = `
        <section class="profile-panel">
          <p class="profile-muted">Spremanje profila nije dostupno u ovom pregledniku.</p>
        </section>
      `;
      return;
    }

    renderLoading();
    const user = await loadAuthUser();
    const [localProfile, serverSimulations, agentKey] = await Promise.all([
      Promise.resolve(profileStore.getProfile()),
      loadServerSimulations(),
      loadAgentKey(user),
    ]);
    renderProfile({ agentKey, localProfile, serverSimulations, user });
  }

  root.addEventListener("submit", (event) => {
    if (event.target.matches("[data-agent-key-form]")) saveAgentKey(event);
  });
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-agent-key-delete]")) deleteAgentKey();
  });

  init();
})();
