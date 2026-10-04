(function () {
  const root = document.querySelector("[data-profile-page]");
  if (!root) return;

  const profileStore = window.AsistentProfile;
  const dateFormatter = new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const SIMULATIONS_COLLAPSED_COUNT = 3;
  const numberFormatter = new Intl.NumberFormat("hr-HR");
  let practiceBySubject = new Map();
  let simulationBySubject = new Map();

  const subjectAppearance = {
    Biologija: { icon: "dna", color: "#2f5d50" },
    "Engleski jezik": { icon: "language-english", color: "#36517c" },
    Filozofija: { icon: "lightbulb", color: "#574d3f" },
    Fizika: { icon: "atom", color: "#225b67" },
    Geografija: { icon: "globe-hemisphere-west", color: "#3f5f3b" },
    "Hrvatski jezik": { icon: "book-open-text", color: "#7a3f4a" },
    Informatika: { icon: "binary", color: "#2e5c72" },
    Kemija: { icon: "flask", color: "#315f69" },
    "Likovna umjetnost": { icon: "palette", color: "#7e4a58" },
    Matematika: { icon: "sigma", color: "#4f4b78" },
    "Njemački jezik": { icon: "language-german", color: "#3e5876" },
    "Politika i gospodarstvo": { icon: "bank", color: "#5c4a42" },
    Povijest: { icon: "scroll", color: "#6a4b3d" },
    Psihologija: { icon: "brain", color: "#5a4968" },
    Sociologija: { icon: "users-three", color: "#4e5960" },
    Ostalo: { icon: "books", color: "#596473" },
  };

  function answeredBySubject() {
    const totals = new Map(practiceBySubject);
    for (const [subject, count] of simulationBySubject) {
      totals.set(subject, (totals.get(subject) || 0) + count);
    }
    return [...totals].filter(([, count]) => count > 0)
      .sort(([subjectA, countA], [subjectB, countB]) => countB - countA || subjectA.localeCompare(subjectB, "hr"));
  }

  function totalAnswered() {
    return answeredBySubject().reduce((sum, [, count]) => sum + count, 0);
  }

  function renderAnsweredBreakdown() {
    const subjects = answeredBySubject();
    const visible = subjects.length > 4 ? subjects.slice(0, 3) : subjects.slice();
    if (subjects.length > 4) {
      visible.push(["Ostalo", subjects.slice(3).reduce((sum, [, count]) => sum + count, 0)]);
    }
    return visible.length ? `<ul class="profile-answered-breakdown__list">${visible.map(([subject, count]) => {
      const appearance = subjectAppearance[subject] || { icon: "book-open", color: "#36517c" };
      const icon = window.renderPhosphorIcon?.(appearance.icon, "subject-symbol__icon") || "";
      return `<li><span class="profile-answered-breakdown__subject"><span class="subject-symbol" style="--subject-color: ${appearance.color}">${icon}</span>${escapeHtml(subject)}</span><strong>${count}</strong></li>`;
    }).join("")}</ul>` : '<p class="profile-answered-breakdown__empty">Još nema riješenih zadataka.</p>';
  }

  async function countPracticeAnswers() {
    const groups = new Map();
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        const match = /^asistent-za-mature:([a-z]+-(?:choice|reading|listening)):(.+?)(:open-scores)?$/.exec(key);
        if (!match) continue;
        const [, source, id, scores] = match;
        let value;
        try { value = JSON.parse(localStorage.getItem(key)); } catch { continue; }
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        if (!groups.has(source)) groups.set(source, []);
        groups.get(source).push({ id, scores: Boolean(scores), value });
      }
    } catch { return new Map(); }

    const counts = await Promise.all([...groups].map(async ([source, entries]) => {
      const globalName = `ASISTENT_ZA_MATURE_${source.replaceAll("-", "_").toUpperCase()}`;
      if (!window[globalName]) {
        const loaded = await new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = `./data/${source}.js`;
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.head.append(script);
        });
        if (!loaded) return new Map();
      }
      const exams = new Map((window[globalName]?.exams || []).map((exam) => [exam.id, exam]));
      const answered = new Map();
      // Merge legacy term aliases first, so current saved answers take precedence.
      const merged = new Map();
      entries.sort((a, b) => Number(/-(prvi|drugi)-rok$/.test(b.id)) - Number(/-(prvi|drugi)-rok$/.test(a.id)));
      for (const entry of entries) {
        const id = entry.id.replace(/-prvi-rok$/, "-ljetni-rok").replace(/-drugi-rok$/, "-jesenski-rok");
        const key = `${id}:${entry.scores}`;
        const previous = merged.get(key);
        const value = { ...previous?.value, ...entry.value };
        for (const field of ["closedResponses", "openResponses", "openScores"]) {
          if (entry.value[field]) value[field] = { ...previous?.value[field], ...entry.value[field] };
        }
        merged.set(key, { ...entry, id, value });
      }
      for (const { id, scores, value } of merged.values()) {
        const exam = exams.get(id);
        if (!exam) continue;
        const known = new Set();
        const excluded = new Set((exam.excludedQuestions || []).map(String));
        const addQuestion = (question) => {
          const number = String(question?.number ?? question);
          if (question?.excluded || question?.isExample) excluded.add(number);
          else known.add(number);
        };
        [...(exam.questions || []), ...(exam.openQuestions || [])].forEach(addQuestion);
        for (const task of [...(exam.tasks || []), ...(exam.openTasks || [])]) {
          if (task.questions) task.questions.forEach(addQuestion);
          else for (let n = Number(task.firstQuestion); n <= Number(task.lastQuestion); n += 1) known.add(String(n));
        }
        const addAnswers = (responses, isScore = false) => {
          for (const [question, answer] of Object.entries(responses || {})) {
            if (!known.has(question) || excluded.has(question) || Number(question) === 0) continue;
            const points = answer && typeof answer === "object" ? answer.points : answer;
            const valid = isScore
              ? points !== "" && points != null && Number.isFinite(Number(points)) && Number(points) >= 0
              : typeof answer === "string" && answer.trim();
            if (valid) answered.set(`${id}:${question}`, exam.subject);
          }
        };
        addAnswers(value, scores);
        addAnswers(value.closedResponses);
        addAnswers(value.openResponses);
        addAnswers(value.openScores, true);
      }
      const bySubject = new Map();
      for (const subject of answered.values()) {
        if (subject) bySubject.set(subject, (bySubject.get(subject) || 0) + 1);
      }
      return bySubject;
    }));
    const totals = new Map();
    for (const bySubject of counts) {
      for (const [subject, count] of bySubject) {
        totals.set(subject, (totals.get(subject) || 0) + count);
      }
    }
    return totals;
  }

  function updateAnsweredStatistic() {
    const statistic = root.querySelector("[data-answered-statistic]");
    if (statistic) statistic.textContent = String(totalAnswered());
    const button = root.querySelector("[data-answered-toggle]");
    if (button) button.setAttribute("aria-label", `Riješeni zadatci po predmetima: ${totalAnswered()}`);
    const breakdown = root.querySelector("[data-answered-breakdown]");
    if (breakdown) breakdown.innerHTML = renderAnsweredBreakdown();
  }

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
    simulationBySubject = new Map();
    for (const attempt of simulations) {
      if (!attempt.subject || !Number.isInteger(attempt.answered) || attempt.answered <= 0) continue;
      simulationBySubject.set(attempt.subject, (simulationBySubject.get(attempt.subject) || 0) + attempt.answered);
    }
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
              <dt>Riješeni zadatci</dt>
              <dd class="profile-answered-statistic">
                <button type="button" class="profile-answered-statistic__button" data-answered-toggle aria-expanded="false" aria-controls="profile-answered-breakdown" aria-label="Riješeni zadatci po predmetima: ${totalAnswered()}">
                  <span data-answered-statistic>${totalAnswered()}</span>
                </button>
                <div class="profile-answered-breakdown" id="profile-answered-breakdown" data-answered-breakdown role="group" aria-label="Riješeni zadatci po predmetima">${renderAnsweredBreakdown()}</div>
              </dd>
            </div>
            <div>
              <dt>Odrađene simulacije</dt>
              <dd>${numberFormatter.format(simulations.length)}</dd>
            </div>
            <div>
              <dt>Datum kreacije</dt>
              <dd>${escapeHtml(formatDate(createdAt))}</dd>
            </div>
          </dl>
        </section>

        <section class="profile-panel profile-plus-panel" aria-labelledby="profile-plus-title">
          <div class="profile-section-heading">
            <div>
              <h2 id="profile-plus-title"><img class="profile-plus-logo" src="/assets/matura+.webp" alt="Matura Plus" width="1536" height="330" /></h2>
              <p class="profile-muted">Status pretplate</p>
            </div>
          </div>
          <div data-billing>Provjera pretplate...</div>
        </section>

        ${renderSettings()}

        <section class="profile-panel" aria-labelledby="profile-simulations-title">
          <div class="profile-section-heading">
            <div>
              <h2 id="profile-simulations-title">Odrađene simulacije</h2>
            </div>
          </div>
          ${simulations.length ? renderSimulationTable(simulations) : renderEmptyState()}
        </section>

        ${renderMinorActions(Boolean(user))}
      </div>
    `;
  }

  function renderMinorActions(isSignedIn) {
    return `
      <div class="profile-minor" aria-label="Računi i podaci">
        <button type="button" class="profile-minor__link" data-clear-progress>
          Obriši spremljeni napredak
        </button>
        ${
          isSignedIn
            ? `<span class="profile-minor__sep" aria-hidden="true">·</span>
               <button type="button" class="profile-minor__link profile-minor__link--danger" data-logout>
                 Odjava
               </button>`
            : ""
        }
      </div>
    `;
  }

  function currentTheme() {
    if (window.AsistentTheme) return window.AsistentTheme.get();
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // Ikone i boje predmeta drže se istima kao na naslovnici (subjectIcons /
  // subjectColors u app.js), pa se koriste i iste `subject-symbol` klase.
  const levelSubjectAppearance = {
    "Engleski jezik": { icon: "language-english", color: "#36517c" },
    Matematika: { icon: "sigma", color: "#4f4b78" },
    "Njemački jezik": { icon: "language-german", color: "#3e5876" },
  };

  // Hrvatski se ne filtrira po razini u postavkama.
  const levelSubjectsExcluded = new Set(["Hrvatski jezik"]);

  function renderLevelPreferences() {
    const subjects = [...new Set((window.ASISTENT_ZA_MATURE_DATA?.exams || [])
      .filter((exam) => (exam.level === "A" || exam.level === "B")
        && !levelSubjectsExcluded.has(exam.subject))
      .map((exam) => exam.subject))].sort((a, b) => a.localeCompare(b, "hr"));
    return `<div class="profile-level-preferences">
      <h3>Razina po predmetima</h3>
      <p class="profile-settings__hint">Zadani filter ispita po predmetu.</p>
      ${subjects.map((subject, index) => {
        const selected = profileStore?.getSubjectLevel(subject) || "";
        const appearance = levelSubjectAppearance[subject] || { icon: "book-open", color: "#36517c" };
        const subjectIcon = window.renderPhosphorIcon?.(appearance.icon, "subject-symbol__icon") || "";
        return `<div class="profile-settings__row">
          <span id="preferred-level-${index}" class="profile-settings__label"><span class="subject-symbol" style="--subject-color: ${appearance.color}">${subjectIcon}</span>${escapeHtml(subject)}</span>
          <div class="level-options" role="group" aria-labelledby="preferred-level-${index}">
            ${[["", "Sve"], ["A", "A"], ["B", "B"]]
              .map(([value, label]) => `<label class="level-option"><input type="radio" name="preferred-level-${index}" data-preferred-level="${escapeHtml(subject)}" value="${value}"${selected === value ? " checked" : ""}><span>${label}</span></label>`).join("")}
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }

  function renderSettings() {
    const isDark = currentTheme() === "dark";
    return `
      <section class="profile-panel" aria-labelledby="profile-settings-title">
        <div class="profile-section-heading">
          <div>
            <h2 id="profile-settings-title">Postavke</h2>
          </div>
        </div>
        <div class="profile-settings__list">
          <div class="profile-settings__row">
            <div>
              <p class="profile-settings__label">
                ${window.renderPhosphorIcon ? window.renderPhosphorIcon("moon", "profile-settings__icon") : ""}
                <span>Tamni način</span>
              </p>
              <p class="profile-settings__hint">Tamna pozadina za cijelu stranicu. Postavka se sprema u ovom pregledniku.</p>
            </div>
            <button
              type="button"
              class="theme-switch"
              data-theme-toggle
              role="switch"
              aria-checked="${isDark ? "true" : "false"}"
              aria-label="Tamni način"
            >
              <span class="theme-switch__knob" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        ${renderLevelPreferences()}
      </section>
    `;
  }

  function wireThemeToggle() {
    const toggle = root.querySelector("[data-theme-toggle]");
    if (!toggle || !window.AsistentTheme) return;

    toggle.addEventListener("click", () => {
      const next = window.AsistentTheme.get() === "dark" ? "light" : "dark";
      window.AsistentTheme.set(next);
      toggle.setAttribute("aria-checked", next === "dark" ? "true" : "false");
    });
  }

  function wireAnsweredBreakdown() {
    const button = root.querySelector("[data-answered-toggle]");
    if (!button) return;
    const statistic = button.closest(".profile-answered-statistic");
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(expanded));
      statistic.classList.toggle("is-open", expanded);
    });
    document.addEventListener("click", (event) => {
      if (statistic.contains(event.target)) return;
      button.setAttribute("aria-expanded", "false");
      statistic.classList.remove("is-open");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      button.setAttribute("aria-expanded", "false");
      statistic.classList.remove("is-open");
      button.focus();
    });
  }

  function wireSimulationsToggle() {
    const toggle = root.querySelector("[data-simulations-toggle]");
    if (!toggle) return;

    toggle.addEventListener("click", () => {
      const panel = toggle.closest(".profile-panel");
      const rows = panel ? panel.querySelectorAll(".profile-table-row--collapsed") : [];
      const expanded = toggle.getAttribute("aria-expanded") === "true";

      rows.forEach((row) => {
        row.hidden = expanded;
      });
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.textContent = expanded
        ? toggle.dataset.collapsedLabel
        : "Prikaži manje";
    });

    toggle.dataset.collapsedLabel = toggle.textContent.trim();
  }

  function wireMinorActions() {
    const clearButton = root.querySelector("[data-clear-progress]");
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        const confirmed = window.confirm(
          "Obrisati spremljene odgovore na svim vježbama? Ova se radnja ne može poništiti.",
        );
        if (!confirmed) return;

        profileStore.clearPracticeProgress?.();
        countPracticeAnswers().then((count) => {
          practiceBySubject = count;
          updateAnsweredStatistic();
        });
        clearButton.disabled = true;
        clearButton.textContent = "Napredak obrisan";
      });
    }

    const logoutButton = root.querySelector("[data-logout]");
    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;
        try {
          await fetch("/api/auth/logout", {
            body: "{}",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
        } catch {
          // Bez obzira na ishod osvježi stranicu da odrazi odjavljeno stanje.
        }
        window.location.reload();
      });
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
    const hasMore = simulations.length > SIMULATIONS_COLLAPSED_COUNT;
    const visible = hasMore ? simulations.slice(0, SIMULATIONS_COLLAPSED_COUNT) : simulations;
    const hidden = hasMore ? simulations.slice(SIMULATIONS_COLLAPSED_COUNT) : [];

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
            ${visible.map(renderSimulationRow).join("")}
            ${hidden
              .map((attempt) => renderSimulationRow(attempt, { hidden: true }))
              .join("")}
          </tbody>
        </table>
      </div>
      ${
        hasMore
          ? `<div class="profile-table-more">
               <button type="button" class="secondary-button" data-simulations-toggle aria-expanded="false">
                 Prikaži sve (${simulations.length})
               </button>
             </div>`
          : ""
      }
    `;
  }

  function renderSimulationRow(attempt, { hidden = false } = {}) {
    const answered =
      attempt.answered !== null && attempt.totalQuestions !== null
        ? `${attempt.answered}/${attempt.totalQuestions}`
        : "Nije dostupno";
    const percentage = formatPercentage(attempt);
    const tone = percentageTone(attempt);

    return `
      <tr${hidden ? ' class="profile-table-row--collapsed" hidden' : ""}>
        <td data-label="Datum">${escapeHtml(formatDate(attempt.submittedAt))}</td>
        <td data-label="Ispit">
          <strong>${escapeHtml(examTitle(attempt))}</strong>
        </td>
        <td data-label="Cjelina">${escapeHtml(attempt.part || "Cijeli ispit")}</td>
        <td data-label="Odgovori">${escapeHtml(answered)}</td>
        <td data-label="Bodovi">${escapeHtml(formatScore(attempt))}</td>
        <td data-label="Postotak">
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
    const [localProfile, serverSimulations, answered] = await Promise.all([
      Promise.resolve(profileStore.getProfile()),
      loadServerSimulations(),
      Promise.resolve(profileStore.ready).then(countPracticeAnswers),
    ]);
    practiceBySubject = answered;
    renderProfile({ localProfile, serverSimulations, user });
    wireAnsweredBreakdown();
    wireThemeToggle();
    root.querySelectorAll("[data-preferred-level]").forEach((select) => {
      select.addEventListener("change", () => {
        profileStore?.setSubjectLevel(select.dataset.preferredLevel, select.value);
      });
    });
    wireSimulationsToggle();
    wireMinorActions();
  }

  init();
})();
