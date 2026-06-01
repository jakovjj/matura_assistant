const archiveData = window.ASISTENT_ZA_MATURE_DATA;
const englishReadingData = window.ASISTENT_ZA_MATURE_ENGLISH_READING;

if (!archiveData || !Array.isArray(archiveData.exams)) {
  throw new Error("Nedostaje generirani indeks ispita.");
}

const mandatorySubjects = [
  "Matematika",
  "Hrvatski jezik",
  "Engleski jezik",
];

const subjectIcons = {
  Biologija: "dna",
  "Engleski jezik": "languages",
  Etika: "scale",
  Filozofija: "lightbulb",
  Fizika: "atom",
  "Francuski jezik": "languages",
  Geografija: "earth",
  "Glazbena umjetnost": "music-2",
  "Grčki jezik": "omega",
  "Hrvatski jezik": "book-open-text",
  Informatika: "binary",
  Kemija: "flask-conical",
  "Latinski jezik": "amphora",
  "Likovna umjetnost": "palette",
  Logika: "workflow",
  "Mađarski jezik": "languages",
  "Mađarski jezik i književnost": "library",
  Matematika: "sigma",
  "Njemački jezik": "languages",
  "Politika i gospodarstvo": "landmark",
  Povijest: "history",
  Psihologija: "brain",
  Sociologija: "users-round",
  "Srpski jezik": "languages",
  "Španjolski jezik": "languages",
  "Talijanski jezik": "languages",
  "Talijanski jezik i književnost": "library",
  Vjeronauk: "church",
};

const subjectColors = {
  Biologija: "#2f5d50",
  "Engleski jezik": "#36517c",
  Etika: "#5b4b63",
  Filozofija: "#574d3f",
  Fizika: "#225b67",
  "Francuski jezik": "#5a4e7a",
  Geografija: "#3f5f3b",
  "Glazbena umjetnost": "#6a4a5b",
  "Grčki jezik": "#4d5370",
  "Hrvatski jezik": "#7a3f4a",
  Informatika: "#2e5c72",
  Kemija: "#315f69",
  "Latinski jezik": "#5b5140",
  "Likovna umjetnost": "#6a4f3d",
  Logika: "#4c5870",
  "Mađarski jezik": "#4e5d47",
  "Mađarski jezik i književnost": "#465a4f",
  Matematika: "#4f4b78",
  "Njemački jezik": "#3e5876",
  "Politika i gospodarstvo": "#5c4a42",
  Povijest: "#6a4b3d",
  Psihologija: "#5a4968",
  Sociologija: "#4e5960",
  "Srpski jezik": "#574a70",
  "Španjolski jezik": "#6b4a3f",
  "Talijanski jezik": "#405e55",
  "Talijanski jezik i književnost": "#4b5a5f",
  Vjeronauk: "#4f5943",
};

const termLabels = {
  "ljetni rok": "Ljetni rok",
  "jesenski rok": "Jesenski rok",
};

const termAliases = {
  "prvi rok": "ljetni rok",
  "drugi rok": "jesenski rok",
  "ljetni rok": "ljetni rok",
  "jesenski rok": "jesenski rok",
};

const legacyTermAliases = {
  "ljetni rok": ["prvi rok"],
  "jesenski rok": ["drugi rok"],
};

const termOrder = {
  "ljetni rok": 0,
  "jesenski rok": 1,
};

const appRoot = document.querySelector("#app-root");

if (!appRoot) {
  throw new Error("Nedostaje korijenski element aplikacije.");
}

const pageState = {
  year: "",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSearch(value) {
  return String(value)
    .toLocaleLowerCase("hr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("đ", "d");
}

function slugPart(value) {
  return normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTerm(term) {
  return termAliases[term] || term;
}

function formatTerm(term) {
  return termLabels[normalizeTerm(term)] || term;
}

function examIdForTerm(exam, term) {
  return [
    slugPart(exam.subject),
    exam.year,
    slugPart(term),
    slugPart(exam.level || "bez-razine"),
  ].join("-");
}

function examId(exam) {
  return examIdForTerm(exam, normalizeTerm(exam.term));
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(examIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

function englishReadingIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function englishReadingStorageKeys(readingExam) {
  const ids = [
    readingExam.id,
    ...(legacyTermAliases[readingExam.term] || []).map((term) =>
      englishReadingIdForTerm(readingExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:english-reading:${id}`);
}

const exams = archiveData.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return { ...exam, term, id: examIdForTerm(exam, term) };
});
const examsById = buildExamMap(exams);
const englishReadingExams = (englishReadingData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: englishReadingIdForTerm(exam, term),
  };
});
const englishReadingByArchiveUrl = new Map(
  englishReadingExams.map((exam) => [exam.archiveUrl, exam]),
);
const englishPracticeParts = [
  {
    id: "citanje",
    label: "Čitanje",
    description: "Razumijevanje pročitanoga teksta.",
  },
  {
    id: "slusanje",
    label: "Slušanje",
    description: "Razumijevanje slušanoga teksta.",
  },
  {
    id: "esej",
    label: "Esej",
    description: "Pisani sastav iz ispita.",
  },
];
const subjectCounts = new Map();

for (const exam of exams) {
  subjectCounts.set(exam.subject, (subjectCounts.get(exam.subject) || 0) + 1);
}

const allSubjects = [...subjectCounts.keys()].sort((a, b) => {
  return a.localeCompare(b, "hr");
});

function icon(iconName, className) {
  return `
    <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg#${iconName}"></use>
    </svg>
  `;
}

function subjectIcon(subject, className) {
  return icon(subjectIcons[subject] || "book-open", className);
}

function subjectColor(subject) {
  return subjectColors[subject] || "#001d4d";
}

function downloadIcon() {
  return `
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13.5h10" />
    </svg>
  `;
}

function formatLevel(level) {
  return level ? `${level} razina` : "Bez razine";
}

function levelBadge(level) {
  return level
    ? `<span class="level-badge">${escapeHtml(level)}</span>`
    : `<span class="level-badge level-badge--empty">-</span>`;
}

function subjectUrl(subject) {
  return `./?predmet=${encodeURIComponent(subject)}`;
}

function examUrl(exam, practicePart = "") {
  const params = new URLSearchParams({
    predmet: exam.subject,
    ispit: exam.id,
  });

  if (practicePart) {
    params.set("cjelina", practicePart);
  }

  return `./?${params.toString()}#predmeti`;
}

function englishReadingUrl(readingExam) {
  return `./engleski-citanje.html?exam=${encodeURIComponent(readingExam.id)}`;
}

function readingExamForArchive(exam) {
  return englishReadingByArchiveUrl.get(exam.url) || null;
}

function interactiveParts(exam) {
  if (exam.subject !== "Engleski jezik") return [];

  const readingExam = readingExamForArchive(exam);

  return englishPracticeParts.map((part) => {
    const isReading = part.id === "citanje";
    const isAvailable = isReading && Boolean(readingExam);

    return {
      ...part,
      available: isAvailable,
      href: isAvailable ? englishReadingUrl(readingExam) : examUrl(exam, part.id),
    };
  });
}

function readEnglishResponses(readingExam) {
  const storedResponses = {};
  try {
    for (const key of englishReadingStorageKeys(readingExam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedResponses, stored);
      }
    }
  } catch {
    return {};
  }
  return storedResponses;
}

function englishQuestionNumbers(readingExam) {
  return readingExam.tasks.flatMap((task) => {
    const questions = [];
    for (let question = task.firstQuestion; question <= task.lastQuestion; question += 1) {
      questions.push(String(question));
    }
    return questions;
  });
}

function englishProgress(exam) {
  const readingExam = readingExamForArchive(exam);
  if (!readingExam) return null;

  const knownQuestions = new Set(englishQuestionNumbers(readingExam));
  const responses = readEnglishResponses(readingExam);
  const answered = Object.entries(responses).filter(
    ([question, answer]) =>
      knownQuestions.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered,
    id: readingExam.id,
    total: knownQuestions.size,
  };
}

function examProgress(exam) {
  const reading = englishProgress(exam);
  const readingPercent =
    reading && reading.total ? Math.round((reading.answered / reading.total) * 100) : 0;
  let percent = readingPercent;
  let label = "Nije započeto";
  let completed = Boolean(reading && reading.total && reading.answered === reading.total);

  if (reading) {
    label = `${reading.answered}/${reading.total} odgovora`;
  }

  if (completed) {
    percent = 100;
    label = "Riješeno";
  }

  return {
    completed,
    label,
    percent: Math.max(0, Math.min(100, percent)),
    reading,
    status: reading?.answered ? "started" : "",
  };
}

function progressMeter(percent, label) {
  const value = Math.max(0, Math.min(100, percent));
  return `
    <div
      class="progress-meter"
      role="progressbar"
      aria-label="${escapeHtml(label)}"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="${value}"
    >
      <span style="width: ${value}%"></span>
    </div>
  `;
}

function route() {
  const params = new URLSearchParams(window.location.search);
  return {
    examId: params.get("ispit"),
    practicePart: params.get("cjelina"),
    subject: params.get("predmet"),
  };
}

function renderApp() {
  const currentRoute = route();

  if (currentRoute.examId) {
    const exam = examsById.get(currentRoute.examId);
    if (exam) {
      renderExamPractice(exam, currentRoute.practicePart);
    } else {
      renderMissing("Matura nije pronađena", "Odabrani ispit nije dostupan.");
    }
    return;
  }

  if (currentRoute.subject) {
    const subject = allSubjects.find((candidate) => candidate === currentRoute.subject);
    if (subject) {
      renderSubjectPage(subject);
    } else {
      renderMissing("Predmet nije pronađen", "Odabrani predmet nije dostupan u arhivi.");
    }
    return;
  }

  renderHome();
}

function renderHome() {
  document.title = "Asistent za Mature - interaktivni ispiti za vježbu";

  appRoot.innerHTML = `
    <div class="home-workspace">
      <div class="home-toolbar">
        <div>
          <p class="eyebrow">Pregled arhive</p>
          <h2>Odaberi predmet</h2>
        </div>
      </div>

      <div id="subject-list"></div>
    </div>
  `;

  renderSubjectGrid();
}

function renderSubjectGrid() {
  const subjectList = appRoot.querySelector("#subject-list");
  const visibleMandatorySubjects = mandatorySubjects.filter((subject) =>
    subjectCounts.has(subject),
  );
  const visibleOptionalSubjects = allSubjects.filter(
    (subject) => !mandatorySubjects.includes(subject),
  );

  subjectList.innerHTML = `
    <section class="subject-group">
      <div class="subject-group__heading">
        <h3>Obavezni predmeti</h3>
      </div>
      <div class="subject-grid subject-grid--mandatory">
        ${
          visibleMandatorySubjects.length
            ? visibleMandatorySubjects.map(renderSubjectCard).join("")
            : `
              <div class="empty-state subject-grid__empty">
                <h3>Nema obaveznih predmeta</h3>
                <p>Trenutačno nema predmeta u ovoj skupini.</p>
              </div>
            `
        }
      </div>
    </section>

    <section class="subject-group">
      <div class="subject-group__heading">
        <h3>Ostali predmeti <span class="subject-group__note">(Poredani abecedno)</span></h3>
      </div>
      <div class="subject-grid">
        ${
          visibleOptionalSubjects.length
            ? visibleOptionalSubjects.map(renderSubjectCard).join("")
            : `
              <div class="empty-state subject-grid__empty">
                <h3>Nema ostalih predmeta</h3>
                <p>Trenutačno nema predmeta u ovoj skupini.</p>
              </div>
            `
        }
      </div>
    </section>
  `;
}

function renderSubjectCard(subject) {
  const colorStyle = ` style="--subject-color: ${subjectColor(subject)}"`;

  return `
    <a class="subject-card" href="${subjectUrl(subject)}"${colorStyle}>
      <span class="subject-symbol">
        ${subjectIcon(subject, "subject-symbol__icon")}
      </span>
      <span class="subject-card__body">
        <strong>${escapeHtml(subject)}</strong>
      </span>
      <span class="subject-card__action">Vježbaj</span>
    </a>
  `;
}

function renderSubjectPage(subject) {
  document.title = `${subject} - Asistent za Mature`;
  const colorStyle = ` style="--subject-color: ${subjectColor(subject)}"`;

  appRoot.innerHTML = `
    <div class="subject-page"${colorStyle}>
      <div class="subject-page__intro">
        <a class="back-link back-link--home" href="./#predmeti">
          ${icon("house", "back-link__icon")}
          <span>Svi predmeti</span>
        </a>
        <div class="subject-title-row">
          <span class="subject-symbol">
            ${subjectIcon(subject, "subject-symbol__icon")}
          </span>
          <h2>${escapeHtml(subject)}</h2>
        </div>
      </div>

      <div class="practice-layout">
        <aside class="filters practice-filters" aria-label="Godine ispita">
          <div class="filters__heading">
            <h2>Godine ispita</h2>
          </div>

          <div class="year-filter-list" id="year-filter-list"></div>
        </aside>

        <div class="subject-results">
          <div id="subject-exam-list"></div>
        </div>
      </div>
    </div>
  `;

  appRoot.querySelector("#year-filter-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-year-filter]");
    if (!button) return;

    pageState.year = button.dataset.yearFilter;
    renderSubjectYearFilter(subject);
    renderSubjectExamList(subject);
  });

  renderSubjectYearFilter(subject);
  renderSubjectExamList(subject);
}

function renderSubjectYearFilter(subject) {
  const subjectYears = [...new Set(exams.filter((exam) => exam.subject === subject).map((exam) => exam.year))].sort(
    (a, b) => b - a,
  );
  const subjectTotal = exams.filter((exam) => exam.subject === subject).length;

  if (pageState.year && !subjectYears.includes(Number(pageState.year))) {
    pageState.year = "";
  }

  appRoot.querySelector("#year-filter-list").innerHTML = [
    renderYearFilterButton("", "Sve godine", subjectTotal),
    ...subjectYears.map((year) => {
      const count = exams.filter((exam) => exam.subject === subject && exam.year === year).length;
      return renderYearFilterButton(String(year), `${year}.`, count);
    }),
  ].join("");
}

function renderYearFilterButton(value, label, count) {
  const active = pageState.year === value;

  return `
    <button
      class="year-filter-button${active ? " year-filter-button--active" : ""}"
      type="button"
      data-year-filter="${escapeHtml(value)}"
      ${active ? 'aria-current="true"' : ""}
    >
      <span>${escapeHtml(label)}</span>
      <small>${count}</small>
    </button>
  `;
}

function filteredSubjectExams(subject) {
  return exams
    .filter((exam) => exam.subject === subject)
    .filter((exam) => !pageState.year || String(exam.year) === pageState.year)
    .sort(compareExams);
}

function compareExams(a, b) {
  const yearOrder = b.year - a.year;
  if (yearOrder) return yearOrder;

  const termComparison =
    (termOrder[normalizeTerm(a.term)] ?? 99) - (termOrder[normalizeTerm(b.term)] ?? 99);
  if (termComparison) return termComparison;

  return (a.level || "").localeCompare(b.level || "", "hr");
}

function renderSubjectExamList(subject) {
  const filtered = filteredSubjectExams(subject);

  if (!filtered.length) {
    appRoot.querySelector("#subject-exam-list").innerHTML = `
      <div class="empty-state">
        <h3>Nema rezultata</h3>
        <p>Odaberi drugu godinu ili se vrati na prikaz svih godina.</p>
      </div>
    `;
    return;
  }

  const byYear = new Map();
  for (const exam of filtered) {
    if (!byYear.has(exam.year)) byYear.set(exam.year, []);
    byYear.get(exam.year).push(exam);
  }

  appRoot.querySelector("#subject-exam-list").innerHTML = [...byYear.entries()]
    .map(([year, yearExams]) => renderPracticeYearBlock(year, yearExams))
    .join("");
}

function renderPracticeYearBlock(year, yearExams) {
  const hasLevels = yearExams.some((exam) => exam.level);

  return `
    <section class="year-block practice-year-block" aria-labelledby="year-${year}">
      <div class="year-heading">
        <h3 id="year-${year}">${year}.</h3>
        <p>školska godina ${year - 1}./${year}.</p>
      </div>
      <div class="practice-table-wrap">
        <table class="practice-exam-table subject-exam-table${
          hasLevels ? " subject-exam-table--with-levels" : " subject-exam-table--without-levels"
        }">
          <colgroup>
            <col class="subject-exam-table__col-term" />
            ${hasLevels ? '<col class="subject-exam-table__col-level" />' : ""}
            <col class="subject-exam-table__col-progress" />
            <col class="subject-exam-table__col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Rok</th>
              ${hasLevels ? "<th>Razina</th>" : ""}
              <th>Napredak</th>
              <th>Materijali</th>
            </tr>
          </thead>
          <tbody>
            ${yearExams.map((exam) => renderSubjectExamRow(exam, hasLevels)).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSubjectExamRow(exam, hasLevels) {
  const progress = examProgress(exam);

  return `
    <tr>
      <td>
        <strong>${escapeHtml(formatTerm(exam.term))}</strong>
        <small>${escapeHtml(exam.schoolYear)}</small>
      </td>
      ${hasLevels ? `<td>${levelBadge(exam.level)}</td>` : ""}
      <td class="subject-exam-table__progress-cell">
        <div class="exam-progress">
          <div class="exam-progress__meter-row">
            ${progressMeter(progress.percent, `Napredak: ${progress.percent}%`)}
            <strong class="exam-progress__percent">${progress.percent}%</strong>
          </div>
        </div>
      </td>
      <td>
        <div class="exam-actions">
          <a class="primary-button" href="${examUrl(exam)}">Vježbaj</a>
          <a
            class="download-icon-link"
            href="${escapeHtml(exam.url)}"
            target="_blank"
            rel="noreferrer"
            aria-label="Preuzmi ${escapeHtml(exam.subject)} ${escapeHtml(exam.year)}. ${escapeHtml(
              formatTerm(exam.term),
            )}"
          >
            ${downloadIcon()}
          </a>
        </div>
      </td>
    </tr>
  `;
}

function renderExamPractice(exam, selectedPartId = "") {
  document.title = `${exam.subject} ${exam.year}. - Asistent za Mature`;

  appRoot.innerHTML = `
    <div class="practice-detail" style="--subject-color: ${subjectColor(exam.subject)}">
      <a class="back-link" href="${subjectUrl(exam.subject)}">Natrag na ${escapeHtml(
        exam.subject,
      )}</a>

      <div class="practice-detail__heading">
        <span class="subject-symbol">
          ${subjectIcon(exam.subject, "subject-symbol__icon")}
        </span>
        <div>
          <p class="eyebrow">Vježba mature</p>
          <h2>${escapeHtml(exam.subject)} ${exam.year}.</h2>
          <p>
            ${escapeHtml(formatTerm(exam.term))} · ${escapeHtml(formatLevel(exam.level))} ·
            školska godina ${escapeHtml(exam.schoolYear)}
          </p>
        </div>
      </div>

      ${renderInteractiveArea(exam, selectedPartId)}
    </div>
  `;
}

function renderInteractiveArea(exam, selectedPartId) {
  const parts = interactiveParts(exam);

  if (!parts.length) {
    return `
      <section class="practice-interactive-card">
        <p class="eyebrow">Interaktivni ispit</p>
        <h3>Interaktivni ispit nije definiran</h3>
        <p>Nema definiranog interaktivnog ispita za sada.</p>
      </section>
    `;
  }

  const selectedPart = selectedPartId
    ? parts.find((part) => part.id === selectedPartId)
    : null;

  return `
    <section class="practice-interactive-card">
      <div class="practice-interactive-card__heading">
        <div>
          <p class="eyebrow">Ispitne cjeline</p>
          <h3>Ispit je podijeljen na više cjelina</h3>
        </div>
      </div>
      <div class="practice-part-grid">
        ${parts.map((part) => renderPracticePart(part, selectedPartId)).join("")}
      </div>
      ${
        selectedPart && !selectedPart.available
          ? renderUnavailableInteractiveNotice(selectedPart)
          : ""
      }
      ${
        selectedPartId && !selectedPart
          ? renderUnavailableInteractiveNotice({ label: "Odabrana cjelina" })
          : ""
      }
    </section>
  `;
}

function renderPracticePart(part, selectedPartId) {
  const active = selectedPartId === part.id;
  const availableClass = part.available ? " practice-part-card--available" : "";
  const unavailableClass = part.available ? "" : " practice-part-card--unavailable";
  const activeClass = active ? " practice-part-card--active" : "";

  return `
    <a
      class="practice-part-card${availableClass}${unavailableClass}${activeClass}"
      href="${escapeHtml(part.href)}"
      ${active ? 'aria-current="true"' : ""}
    >
      <span class="practice-part-card__heading">
        <strong>${escapeHtml(part.label)}</strong>
      </span>
      <small>${escapeHtml(part.description)}</small>
    </a>
  `;
}

function renderUnavailableInteractiveNotice(part) {
  return `
    <div class="practice-unavailable-note">
      <h3>${escapeHtml(part.label)}</h3>
      <p>Nema definiranog interaktivnog ispita za sada.</p>
    </div>
  `;
}

function renderMissing(title, message) {
  document.title = "Asistent za Mature";
  appRoot.innerHTML = `
    <div class="empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <a class="start-link" href="./#predmeti">Vrati se na predmete</a>
    </div>
  `;
}

renderApp();
