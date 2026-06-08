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

  function renderProfile({ localProfile, serverSimulations, user }) {
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
      </div>
    `;
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
    const [localProfile, serverSimulations] = await Promise.all([
      Promise.resolve(profileStore.getProfile()),
      loadServerSimulations(),
    ]);
    renderProfile({ localProfile, serverSimulations, user });
  }

  init();
})();
