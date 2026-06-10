const archiveData = window.ASISTENT_ZA_MATURE_DATA;

if (!archiveData || !Array.isArray(archiveData.exams)) {
  throw new Error("Nedostaje generirani indeks ispita.");
}

const solverDataSources = {
  englishReading: {
    globalName: "ASISTENT_ZA_MATURE_ENGLISH_READING",
    src: "./data/english-reading.js",
  },
  englishListening: {
    globalName: "ASISTENT_ZA_MATURE_ENGLISH_LISTENING",
    src: "./data/english-listening.js?v=20260608-wma-audio",
  },
  englishEssay: {
    globalName: "ASISTENT_ZA_MATURE_ENGLISH_ESSAY",
    src: "./data/english-essay.js?v=20260602-english-essay",
  },
  croatianWriting: {
    globalName: "ASISTENT_ZA_MATURE_CROATIAN_WRITING",
    src: "./data/croatian-writing.js?v=20260604-croatian-writing",
  },
  physicsChoice: {
    globalName: "ASISTENT_ZA_MATURE_PHYSICS_CHOICE",
    src: "./data/physics-choice.js",
  },
  mathChoice: {
    globalName: "ASISTENT_ZA_MATURE_MATH_CHOICE",
    src: "./data/math-choice.js?v=20260602-math-groups",
  },
  chemistryChoice: {
    globalName: "ASISTENT_ZA_MATURE_CHEMISTRY_CHOICE",
    src: "./data/chemistry-choice.js?v=20260605-chemistry-table-crops",
  },
  croatianChoice: {
    globalName: "ASISTENT_ZA_MATURE_CROATIAN_CHOICE",
    src: "./data/croatian-choice.js?v=20260608-croatian-legacy",
  },
  historyChoice: {
    globalName: "ASISTENT_ZA_MATURE_HISTORY_CHOICE",
    src: "./data/history-choice.js?v=20260603-history-choice",
  },
  geographyChoice: {
    globalName: "ASISTENT_ZA_MATURE_GEOGRAPHY_CHOICE",
    src: "./data/geography-choice.js?v=20260604-geography-choice",
  },
  psychologyChoice: {
    globalName: "ASISTENT_ZA_MATURE_PSYCHOLOGY_CHOICE",
    src: "./data/psychology-choice.js?v=20260605-psychology-choice",
  },
  philosophyChoice: {
    globalName: "ASISTENT_ZA_MATURE_PHILOSOPHY_CHOICE",
    src: "./data/philosophy-choice.js?v=20260609-philosophy-choice",
  },
  sociologyChoice: {
    globalName: "ASISTENT_ZA_MATURE_SOCIOLOGY_CHOICE",
    src: "./data/sociology-choice.js?v=20260608-sociology-choice",
  },
  artChoice: {
    globalName: "ASISTENT_ZA_MATURE_ART_CHOICE",
    src: "./data/art-choice.js?v=20260608-art-choice",
  },
  informaticsChoice: {
    globalName: "ASISTENT_ZA_MATURE_INFORMATICS_CHOICE",
    src: "./data/informatics-choice.js?v=20260609-informatics-choice",
  },
  politicsChoice: {
    globalName: "ASISTENT_ZA_MATURE_POLITICS_CHOICE",
    src: "./data/politics-choice.js?v=20260604-politics-choice",
  },
  abcdChoice: {
    globalName: "ASISTENT_ZA_MATURE_ABCD_CHOICE",
    src: "./data/abcd-choice.js?v=20260602-abcd-choice",
  },
};

const solverDataLoadPromises = new Map();

const mandatorySubjects = [
  "Matematika",
  "Hrvatski jezik",
  "Engleski jezik",
];

const temporarilyUnavailableSubjects = new Set([
  "Biologija",
  "Logika",
  "Njemački jezik",
  "Talijanski jezik",
]);

const subjectIcons = {
  Biologija: "dna",
  "Engleski jezik": "languages",
  Filozofija: "lightbulb",
  Fizika: "atom",
  Geografija: "earth",
  "Hrvatski jezik": "book-open-text",
  Informatika: "binary",
  Kemija: "flask-conical",
  "Likovna umjetnost": "palette",
  Logika: "workflow",
  Matematika: "sigma",
  "Njemački jezik": "languages",
  "Politika i gospodarstvo": "landmark",
  Povijest: "history",
  Psihologija: "brain",
  Sociologija: "users-round",
  "Talijanski jezik": "languages",
};

const subjectColors = {
  Biologija: "#2f5d50",
  "Engleski jezik": "#36517c",
  Filozofija: "#574d3f",
  Fizika: "#225b67",
  Geografija: "#3f5f3b",
  "Hrvatski jezik": "#7a3f4a",
  Informatika: "#2e5c72",
  Kemija: "#315f69",
  "Likovna umjetnost": "#6a4f3d",
  Logika: "#4c5870",
  Matematika: "#4f4b78",
  "Njemački jezik": "#3e5876",
  "Politika i gospodarstvo": "#5c4a42",
  Povijest: "#6a4b3d",
  Psihologija: "#5a4968",
  Sociologija: "#4e5960",
  "Talijanski jezik": "#405e55",
};

const subjectImages = {
  Biologija: "biology",
  "Engleski jezik": "english-dictionary",
  Filozofija: "philosophy-thinker",
  Fizika: "physics",
  Geografija: "geography",
  "Hrvatski jezik": "croatian-writing",
  Informatika: "informatics",
  Kemija: "chemistry",
  "Likovna umjetnost": "art",
  Logika: "logic-chess",
  Matematika: "mathematics",
  "Njemački jezik": "german-brandenburg",
  "Politika i gospodarstvo": "civics",
  Povijest: "history-document",
  Psihologija: "psychology-brain",
  Sociologija: "sociology-crowd",
  "Talijanski jezik": "italian-colosseum",
};

const subjectAccusativeLabels = {
  Biologija: "Biologiju",
  "Engleski jezik": "Engleski jezik",
  Filozofija: "Filozofiju",
  Fizika: "Fiziku",
  Geografija: "Geografiju",
  "Hrvatski jezik": "Hrvatski jezik",
  Informatika: "Informatiku",
  Kemija: "Kemiju",
  "Likovna umjetnost": "Likovnu umjetnost",
  Logika: "Logiku",
  Matematika: "Matematiku",
  "Njemački jezik": "Njemački jezik",
  "Politika i gospodarstvo": "Politiku i gospodarstvo",
  Povijest: "Povijest",
  Psihologija: "Psihologiju",
  Sociologija: "Sociologiju",
  "Talijanski jezik": "Talijanski jezik",
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

const siteOrigin = "https://matura.com.hr";
const siteName = "Asistent za Mature";
const homeSeoTitle = "Državna matura: prethodni ispiti i vježba | Asistent za Mature";
const homeSeoDescription =
  "Vježbaj državnu maturu na prethodnim ispitima i preuzmi NCVVO pakete za 2013.-2025. Prati napredak ili pokreni vremenski ograničenu simulaciju.";

const appRoot = document.querySelector("#app-root");
const homeHeading = document.querySelector("[data-home-heading]");
const homeInformation = document.querySelector("[data-home-information]");

if (!appRoot) {
  throw new Error("Nedostaje korijenski element aplikacije.");
}

let yearNavigationCleanup = null;
let renderAppRequestId = 0;
let serverSimulationAttempts = [];
let serverSimulationAttemptsLoaded = false;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function englishExamIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function prefixedExamIdForTerm(prefix, exam, term) {
  const level = exam.level ? `-${exam.level.toLocaleLowerCase("hr")}` : "";
  return `${prefix}${level}-${exam.year}-${slugPart(term)}`;
}

function archiveUrlKey(exam) {
  return exam.archiveUrl;
}

function archiveExamUrlKey(exam) {
  return exam.url;
}

function croatianWritingArchiveKey(exam) {
  return `${exam.archiveUrl}|${exam.kind}`;
}

function croatianWritingArchiveLookupKey(exam, kind) {
  return `${exam.url}|${kind}`;
}

const solverDefinitions = {
  englishReading: {
    idForTerm: englishExamIdForTerm,
    page: "./engleski-citanje.html",
    storagePrefix: "english-reading",
  },
  englishListening: {
    idForTerm: englishExamIdForTerm,
    page: "./engleski-slusanje.html",
    storagePrefix: "english-listening",
  },
  englishEssay: {
    idForTerm: englishExamIdForTerm,
    page: "./engleski-esej.html",
    storagePrefix: "english-essay",
  },
  croatianWriting: {
    archiveKey: croatianWritingArchiveKey,
    archiveLookupKey: croatianWritingArchiveLookupKey,
    idForTerm: (exam, term) => `${prefixedExamIdForTerm("hrvatski", exam, term)}-${exam.kind}`,
    page: "./hrvatski-pisanje.html",
    storagePrefix: "croatian-writing",
  },
  physicsChoice: {
    idForTerm: (exam, term) => `fizika-${exam.year}-${slugPart(term)}`,
    page: "./fizika.html",
    storagePrefix: "physics-choice",
  },
  mathChoice: {
    idForTerm: (exam, term) => prefixedExamIdForTerm("matematika", exam, term),
    page: "./matematika.html",
    storagePrefix: "math-choice",
  },
  chemistryChoice: {
    idForTerm: (exam, term) => `kemija-${exam.year}-${slugPart(term)}`,
    page: "./kemija.html",
    storagePrefix: "chemistry-choice",
  },
  croatianChoice: {
    idForTerm: (exam, term) => prefixedExamIdForTerm("hrvatski", exam, term),
    page: "./hrvatski.html",
    storagePrefix: "croatian-choice",
  },
  historyChoice: {
    idForTerm: (exam, term) => `povijest-${exam.year}-${slugPart(term)}`,
    page: "./povijest.html",
    storagePrefix: "history-choice",
  },
  geographyChoice: {
    idForTerm: (exam, term) => `geografija-${exam.year}-${slugPart(term)}`,
    page: "./geografija.html",
    storagePrefix: "geography-choice",
  },
  psychologyChoice: {
    idForTerm: (exam, term) => `psihologija-${exam.year}-${slugPart(term)}`,
    page: "./psihologija.html",
    storagePrefix: "psychology-choice",
  },
  philosophyChoice: {
    idForTerm: (exam, term) => `filozofija-${exam.year}-${slugPart(term)}`,
    page: "./filozofija.html",
    storagePrefix: "philosophy-choice",
  },
  sociologyChoice: {
    idForTerm: (exam, term) => `sociologija-${exam.year}-${slugPart(term)}`,
    page: "./sociologija.html",
    storagePrefix: "sociology-choice",
  },
  artChoice: {
    idForTerm: (exam, term) => `likovna-umjetnost-${exam.year}-${slugPart(term)}`,
    page: "./likovna.html",
    storagePrefix: "art-choice",
  },
  informaticsChoice: {
    idForTerm: (exam, term) => `informatika-${exam.year}-${slugPart(term)}`,
    page: "./informatika.html",
    storagePrefix: "informatics-choice",
  },
  politicsChoice: {
    idForTerm: (exam, term) => `politika-i-gospodarstvo-${exam.year}-${slugPart(term)}`,
    page: "./politika.html",
    storagePrefix: "politics-choice",
  },
  abcdChoice: {
    idForTerm: (exam, term) => prefixedExamIdForTerm(slugPart(exam.subject), exam, term),
    page: "./abcd.html",
    storagePrefix: "abcd-choice",
  },
};

function normalizeSolverExam(definition, exam) {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: definition.idForTerm(exam, term),
  };
}

function solverData(key) {
  const source = solverDataSources[key];
  return source ? window[source.globalName] : null;
}

function solverExams(key) {
  const data = solverData(key);
  return Array.isArray(data?.exams) ? data.exams : [];
}

function buildSolverRegistry(definitions) {
  return Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => {
      const exams = solverExams(key).map((exam) => normalizeSolverExam(definition, exam));
      const archiveKey = definition.archiveKey || archiveUrlKey;
      return [
        key,
        {
          ...definition,
          archiveKey,
          archiveLookupKey: definition.archiveLookupKey || archiveExamUrlKey,
          byArchive: new Map(exams.map((exam) => [archiveKey(exam), exam])),
          exams,
        },
      ];
    }),
  );
}

let solverRegistry = buildSolverRegistry(solverDefinitions);

function refreshSolverRegistry() {
  solverRegistry = buildSolverRegistry(solverDefinitions);
}

function loadSolverDataScript(key) {
  const source = solverDataSources[key];
  if (!source) return Promise.resolve();
  if (Array.isArray(solverData(key)?.exams)) return Promise.resolve();
  if (solverDataLoadPromises.has(key)) return solverDataLoadPromises.get(key);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source.src;
    script.async = true;
    script.dataset.asistentSolverData = key;

    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        solverDataLoadPromises.delete(key);
        reject(new Error(`Nije moguće učitati podatke: ${source.src}`));
      },
      { once: true },
    );

    document.head.append(script);
  });

  solverDataLoadPromises.set(key, promise);
  return promise;
}

async function ensureSolverData(keys) {
  const uniqueKeys = [...new Set(keys)].filter(Boolean);
  await Promise.all(uniqueKeys.map(loadSolverDataScript));

  const missingKeys = uniqueKeys.filter((key) => !Array.isArray(solverData(key)?.exams));
  if (missingKeys.length) {
    throw new Error(`Nedostaju interaktivni podatci: ${missingKeys.join(", ")}`);
  }

  refreshSolverRegistry();
}

function solverIdForTerm(solverKey, exam, term) {
  return solverRegistry[solverKey].idForTerm(exam, term);
}

function solverStorageKeys(solverKey, practiceExam) {
  const definition = solverRegistry[solverKey];
  const ids = [
    practiceExam.id,
    ...(legacyTermAliases[practiceExam.term] || []).map((term) =>
      definition.idForTerm(practiceExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:${definition.storagePrefix}:${id}`);
}

function solverOpenScoreStorageKeys(solverKey, practiceExam) {
  return solverStorageKeys(solverKey, practiceExam).map((key) => `${key}:open-scores`);
}

function solverUrl(solverKey, practiceExam, simulation = false) {
  const params = new URLSearchParams({ exam: practiceExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `${solverRegistry[solverKey].page}?${params.toString()}`;
}

function solverExamForArchive(solverKey, exam, archivePart = undefined) {
  const definition = solverRegistry[solverKey];
  return definition.byArchive.get(definition.archiveLookupKey(exam, archivePart)) || null;
}

function englishReadingIdForTerm(exam, term) {
  return solverIdForTerm("englishReading", exam, term);
}

function englishListeningIdForTerm(exam, term) {
  return solverIdForTerm("englishListening", exam, term);
}

function englishEssayIdForTerm(exam, term) {
  return solverIdForTerm("englishEssay", exam, term);
}

function croatianWritingIdForTerm(exam, term) {
  return solverIdForTerm("croatianWriting", exam, term);
}

function physicsChoiceIdForTerm(exam, term) {
  return solverIdForTerm("physicsChoice", exam, term);
}

function mathChoiceIdForTerm(exam, term) {
  return solverIdForTerm("mathChoice", exam, term);
}

function chemistryChoiceIdForTerm(exam, term) {
  return solverIdForTerm("chemistryChoice", exam, term);
}

function croatianChoiceIdForTerm(exam, term) {
  return solverIdForTerm("croatianChoice", exam, term);
}

function historyChoiceIdForTerm(exam, term) {
  return solverIdForTerm("historyChoice", exam, term);
}

function geographyChoiceIdForTerm(exam, term) {
  return solverIdForTerm("geographyChoice", exam, term);
}

function psychologyChoiceIdForTerm(exam, term) {
  return solverIdForTerm("psychologyChoice", exam, term);
}

function philosophyChoiceIdForTerm(exam, term) {
  return solverIdForTerm("philosophyChoice", exam, term);
}

function sociologyChoiceIdForTerm(exam, term) {
  return solverIdForTerm("sociologyChoice", exam, term);
}

function artChoiceIdForTerm(exam, term) {
  return solverIdForTerm("artChoice", exam, term);
}

function informaticsChoiceIdForTerm(exam, term) {
  return solverIdForTerm("informaticsChoice", exam, term);
}

function politicsChoiceIdForTerm(exam, term) {
  return solverIdForTerm("politicsChoice", exam, term);
}

function abcdChoiceIdForTerm(exam, term) {
  return solverIdForTerm("abcdChoice", exam, term);
}

function englishReadingStorageKeys(readingExam) {
  return solverStorageKeys("englishReading", readingExam);
}

function englishListeningStorageKeys(listeningExam) {
  return solverStorageKeys("englishListening", listeningExam);
}

function physicsChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("physicsChoice", choiceExam);
}

function physicsOpenScoreStorageKeys(choiceExam) {
  return solverOpenScoreStorageKeys("physicsChoice", choiceExam);
}

function mathChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("mathChoice", choiceExam);
}

function mathOpenScoreStorageKeys(choiceExam) {
  return solverOpenScoreStorageKeys("mathChoice", choiceExam);
}

function chemistryChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("chemistryChoice", choiceExam);
}

function chemistryOpenScoreStorageKeys(choiceExam) {
  return solverOpenScoreStorageKeys("chemistryChoice", choiceExam);
}

function croatianChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("croatianChoice", choiceExam);
}

function historyChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("historyChoice", choiceExam);
}

function geographyChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("geographyChoice", choiceExam);
}

function psychologyChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("psychologyChoice", choiceExam);
}

function philosophyChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("philosophyChoice", choiceExam);
}

function sociologyChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("sociologyChoice", choiceExam);
}

function artChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("artChoice", choiceExam);
}

function informaticsChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("informaticsChoice", choiceExam);
}

function politicsChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("politicsChoice", choiceExam);
}

function abcdChoiceStorageKeys(choiceExam) {
  return solverStorageKeys("abcdChoice", choiceExam);
}

const exams = archiveData.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return { ...exam, term, id: examIdForTerm(exam, term) };
});
const examsById = buildExamMap(exams);
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
    description: "Pregled pisanoga sastava iz ispita.",
    checkingSupported: false,
  },
];
function englishPracticePartsForExam(exam) {
  if (exam.level === "B") {
    return englishPracticeParts.filter((part) => part.id !== "esej");
  }

  return englishPracticeParts;
}

const modernForeignLanguageDurations = {
  "Engleski jezik": {
    A: { citanje: 70, slusanje: 35, pisanje: 75 },
    B: { citanje: 75, slusanje: 30, pisanje: 75 },
    legacyB: { citanje: 60, slusanje: 25, pisanje: 60 },
  },
  "Njemački jezik": {
    A: { citanje: 70, slusanje: 35, pisanje: 75 },
    B: { citanje: 100, slusanje: 30, pisanje: 100 },
  },
  "Talijanski jezik": {
    A: { citanje: 65, slusanje: 30, pisanje: 55 },
    B: { citanje: 75, slusanje: 25, pisanje: 75 },
  },
};
const modernForeignLanguageSubjects = new Set([
  "Engleski jezik",
  "Njemački jezik",
  "Talijanski jezik",
]);
const unavailableForeignLanguageParts = [
  {
    id: "citanje",
    label: "Čitanje",
    description: "Ispit čitanja.",
  },
  {
    id: "slusanje",
    label: "Slušanje",
    description: "Ispit slušanja.",
  },
  {
    id: "pisanje",
    label: "Pisanje",
    description: "Ispit pisanja.",
  },
];
const singleExamPart = {
  id: "ispit",
  label: "Ispit",
  description: "Ispitna knjižica.",
};
const singleExamDurations = {
  Biologija: 150,
  Filozofija: 150,
  Fizika: 180,
  Geografija: 90,
  Informatika: 100,
  Kemija: 180,
  "Likovna umjetnost": 120,
  Logika: 150,
  Matematika: {
    A: 180,
    B: 150,
    default: 180,
  },
  "Politika i gospodarstvo": 90,
  Povijest: 135,
  Psihologija: 90,
  Sociologija: 90,
};
const twentyFivePercentPassSubjects = new Set([
  "Biologija",
  "Fizika",
  "Geografija",
  "Informatika",
  "Kemija",
  "Matematika",
]);
const croatianComponentThresholdNote =
  "Hrvatski jezik ima i zasebne minimalne pragove po ispitnim cjelinama.";
const subjectCounts = new Map();

for (const exam of exams) {
  subjectCounts.set(exam.subject, (subjectCounts.get(exam.subject) || 0) + 1);
}

const allSubjects = [...subjectCounts.keys()].sort((a, b) => {
  return a.localeCompare(b, "hr");
});
const subjectsBySlug = new Map(allSubjects.map((subject) => [slugPart(subject), subject]));
const examsByPath = new Map(exams.map((exam) => [examPath(exam), exam]));

function icon(iconName, className) {
  if (window.renderLucideIcon) return window.renderLucideIcon(iconName, className);

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

function subjectImage(subject) {
  return subjectImages[subject] || "books";
}

function subjectAccusative(subject) {
  return subjectAccusativeLabels[subject] || subject;
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
    ? `<span class="level-badge${level === "A" ? " level-badge--a" : ""}">${escapeHtml(level)}</span>`
    : `<span class="level-badge level-badge--empty">-</span>`;
}

function subjectPath(subject) {
  return `/predmeti/${slugPart(subject)}/`;
}

function examPath(exam) {
  const parts = [exam.year, slugPart(normalizeTerm(exam.term))];
  if (exam.level) parts.push(slugPart(exam.level));
  return `/ispiti/${slugPart(exam.subject)}/${parts.join("-")}/`;
}

function subjectUrl(subject) {
  return subjectPath(subject);
}

function isSubjectTemporarilyUnavailable(subject) {
  return temporarilyUnavailableSubjects.has(subject);
}

function examUrl(exam, practicePart = "") {
  if (!practicePart) return examPath(exam);

  const params = new URLSearchParams();
  params.set("cjelina", practicePart);

  return `${examPath(exam)}?${params.toString()}`;
}

function sitePageUrl(params = {}) {
  const url = new URL("/", siteOrigin);
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

function subjectCanonicalUrl(subject) {
  return new URL(subjectPath(subject), siteOrigin).toString();
}

function examCanonicalUrl(exam) {
  return new URL(examPath(exam), siteOrigin).toString();
}

function setMetaContent(attribute, key, content) {
  let meta = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attribute, key);
    document.head.append(meta);
  }
  meta.setAttribute("content", content);
}

function websiteStructuredData() {
  return {
    "@type": "WebSite",
    "@id": `${siteOrigin}/#website`,
    url: `${siteOrigin}/`,
    name: siteName,
    description: "Neslužbena arhiva prethodnih ispita državne mature s interaktivnim vježbama.",
    inLanguage: "hr-HR",
    disambiguatingDescription: "Neslužbeni projekt koji nije povezan s NCVVO-om.",
  };
}

function breadcrumbStructuredData(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function setStructuredData(pageData) {
  let script = document.querySelector("#seo-structured-data");
  if (!script) {
    script = document.createElement("script");
    script.id = "seo-structured-data";
    script.type = "application/ld+json";
    document.head.append(script);
  }

  script.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [websiteStructuredData(), pageData],
  });
}

function setPageSeo({
  canonicalUrl,
  description,
  robots = "index, follow, max-image-preview:large",
  schema,
  title,
}) {
  document.title = title;
  setMetaContent("name", "description", description);
  setMetaContent("name", "robots", robots);
  setMetaContent("property", "og:title", title);
  setMetaContent("property", "og:description", description);
  setMetaContent("property", "og:url", canonicalUrl);
  setMetaContent("name", "twitter:title", title);
  setMetaContent("name", "twitter:description", description);

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = canonicalUrl;

  setStructuredData(schema);
}

function setHomeSeo() {
  const canonicalUrl = sitePageUrl();
  setPageSeo({
    canonicalUrl,
    description: homeSeoDescription,
    title: homeSeoTitle,
    schema: {
      "@type": ["CollectionPage", "LearningResource"],
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: "Državna matura: prethodni ispiti i vježba",
      description: homeSeoDescription,
      isPartOf: { "@id": `${siteOrigin}/#website` },
      inLanguage: "hr-HR",
      dateModified: archiveData.generatedAt,
      educationalLevel: "Srednja škola",
      educationalUse: ["vježba", "samoprocjena"],
      learningResourceType: "Arhiva ispita državne mature",
      isBasedOn: archiveData.officialArchiveUrl,
      audience: {
        "@type": "EducationalAudience",
        educationalRole: "student",
      },
      mainEntity: {
        "@type": "ItemList",
        name: "Predmeti državne mature",
        numberOfItems: allSubjects.length,
        itemListElement: allSubjects.map((subject, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: subject,
          url: subjectCanonicalUrl(subject),
        })),
      },
    },
  });
}

function setSubjectSeo(subject) {
  const canonicalUrl = subjectCanonicalUrl(subject);
  const title = `${subject} državna matura: ispiti i vježba | ${siteName}`;
  const description = `${subject}: prethodni ispiti državne mature od 2013. do 2025., službeni NCVVO paketi za preuzimanje i dostupne interaktivne vježbe.`;
  const subjectArchive = subjectExams(subject);

  setPageSeo({
    canonicalUrl,
    description,
    title,
    schema: {
      "@type": "CollectionPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: `${subject} - prethodni ispiti državne mature`,
      description,
      isPartOf: { "@id": `${siteOrigin}/#website` },
      inLanguage: "hr-HR",
      dateModified: archiveData.generatedAt,
      about: {
        "@type": "Thing",
        name: subject,
      },
      breadcrumb: breadcrumbStructuredData([
        { name: "Asistent za Mature", url: sitePageUrl() },
        { name: subject, url: canonicalUrl },
      ]),
      mainEntity: {
        "@type": "ItemList",
        name: `${subject} - arhiva ispita`,
        numberOfItems: subjectArchive.length,
        itemListElement: subjectArchive.map((exam, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: `${exam.subject} ${exam.year}. - ${formatTerm(exam.term)}${
            exam.level ? `, ${exam.level} razina` : ""
          }`,
          url: examCanonicalUrl(exam),
        })),
      },
    },
  });
}

function setExamSeo(exam) {
  const canonicalUrl = examCanonicalUrl(exam);
  const level = exam.level ? `, ${exam.level} razina` : "";
  const examName = `${exam.subject} ${exam.year}. - ${formatTerm(exam.term)}${level}`;
  const title = `${examName} | ${siteName}`;
  const description = `${exam.subject} ${exam.year}., ${exam.term}${level}. Preuzmi službeni NCVVO paket i otvori dostupne interaktivne cjeline za vježbu ili simulaciju mature.`;

  setPageSeo({
    canonicalUrl,
    description,
    title,
    schema: {
      "@type": "WebPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: examName,
      description,
      isPartOf: { "@id": `${siteOrigin}/#website` },
      inLanguage: "hr-HR",
      dateModified: archiveData.generatedAt,
      breadcrumb: breadcrumbStructuredData([
        { name: "Asistent za Mature", url: sitePageUrl() },
        { name: exam.subject, url: subjectCanonicalUrl(exam.subject) },
        { name: examName, url: canonicalUrl },
      ]),
      mainEntity: {
        "@type": "LearningResource",
        name: examName,
        description,
        inLanguage: "hr-HR",
        educationalLevel: "Srednja škola",
        educationalUse: ["vježba", "samoprocjena"],
        learningResourceType: "Ispit državne mature",
        about: {
          "@type": "Thing",
          name: exam.subject,
        },
        isBasedOn: exam.upstreamUrl || exam.sourceUrl || archiveData.officialArchiveUrl,
        encoding: {
          "@type": "MediaObject",
          contentUrl: new URL(exam.url, `${siteOrigin}/`).toString(),
          encodingFormat: "application/zip",
        },
      },
    },
  });
}

function setMissingSeo(title, description) {
  setPageSeo({
    canonicalUrl: sitePageUrl(),
    description,
    robots: "noindex, follow",
    title: `${title} | ${siteName}`,
    schema: {
      "@type": "WebPage",
      "@id": `${sitePageUrl()}#missing-page`,
      url: sitePageUrl(),
      name: title,
      description,
      isPartOf: { "@id": `${siteOrigin}/#website` },
      inLanguage: "hr-HR",
    },
  });
}

function englishReadingUrl(readingExam, simulation = false) {
  return solverUrl("englishReading", readingExam, simulation);
}

function englishListeningUrl(listeningExam, simulation = false) {
  return solverUrl("englishListening", listeningExam, simulation);
}

function englishEssayUrl(essayExam, simulation = false) {
  return solverUrl("englishEssay", essayExam, simulation);
}

function croatianWritingUrl(writingExam, simulation = false) {
  return solverUrl("croatianWriting", writingExam, simulation);
}

function physicsChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("physicsChoice", choiceExam, simulation);
}

function mathChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("mathChoice", choiceExam, simulation);
}

function chemistryChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("chemistryChoice", choiceExam, simulation);
}

function croatianChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("croatianChoice", choiceExam, simulation);
}

function historyChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("historyChoice", choiceExam, simulation);
}

function geographyChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("geographyChoice", choiceExam, simulation);
}

function psychologyChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("psychologyChoice", choiceExam, simulation);
}

function philosophyChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("philosophyChoice", choiceExam, simulation);
}

function sociologyChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("sociologyChoice", choiceExam, simulation);
}

function artChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("artChoice", choiceExam, simulation);
}

function informaticsChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("informaticsChoice", choiceExam, simulation);
}

function politicsChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("politicsChoice", choiceExam, simulation);
}

function abcdChoiceUrl(choiceExam, simulation = false) {
  return solverUrl("abcdChoice", choiceExam, simulation);
}

function readingExamForArchive(exam) {
  return solverExamForArchive("englishReading", exam);
}

function listeningExamForArchive(exam) {
  return solverExamForArchive("englishListening", exam);
}

function essayExamForArchive(exam) {
  return solverExamForArchive("englishEssay", exam);
}

function croatianWritingExamForArchive(exam, kind) {
  return solverExamForArchive("croatianWriting", exam, kind);
}

function physicsChoiceExamForArchive(exam) {
  return solverExamForArchive("physicsChoice", exam);
}

function mathChoiceExamForArchive(exam) {
  return solverExamForArchive("mathChoice", exam);
}

function chemistryChoiceExamForArchive(exam) {
  return solverExamForArchive("chemistryChoice", exam);
}

function croatianChoiceExamForArchive(exam) {
  return solverExamForArchive("croatianChoice", exam);
}

function historyChoiceExamForArchive(exam) {
  return solverExamForArchive("historyChoice", exam);
}

function geographyChoiceExamForArchive(exam) {
  return solverExamForArchive("geographyChoice", exam);
}

function psychologyChoiceExamForArchive(exam) {
  return solverExamForArchive("psychologyChoice", exam);
}

function philosophyChoiceExamForArchive(exam) {
  return solverExamForArchive("philosophyChoice", exam);
}

function sociologyChoiceExamForArchive(exam) {
  return solverExamForArchive("sociologyChoice", exam);
}

function artChoiceExamForArchive(exam) {
  return solverExamForArchive("artChoice", exam);
}

function informaticsChoiceExamForArchive(exam) {
  return solverExamForArchive("informaticsChoice", exam);
}

function politicsChoiceExamForArchive(exam) {
  return solverExamForArchive("politicsChoice", exam);
}

function abcdChoiceExamForArchive(exam) {
  return solverExamForArchive("abcdChoice", exam);
}

function unavailablePart(exam, part) {
  const href = examUrl(exam, part.id);
  return {
    ...part,
    available: false,
    durationMinutes: part.durationMinutes ?? null,
    href,
    simulationHref: href,
  };
}

function unavailableParts(exam, parts) {
  return parts.map((part) => unavailablePart(exam, part));
}

function modernForeignLanguageDuration(exam, partId) {
  const subjectDurations = modernForeignLanguageDurations[exam.subject];
  if (!subjectDurations) return null;

  if (exam.subject === "Engleski jezik" && exam.level === "B" && exam.year < 2022) {
    return subjectDurations.legacyB?.[partId] ?? null;
  }

  return subjectDurations[exam.level || ""]?.[partId] ?? null;
}

function singleExamDuration(exam) {
  const duration = singleExamDurations[exam.subject];
  if (duration && typeof duration === "object") {
    return duration[exam.level || ""] ?? duration.default ?? null;
  }
  return duration ?? null;
}

function withDurations(exam, parts) {
  return parts.map((part) => {
    if (part.durationMinutes != null) return part;

    const durationMinutes =
      modernForeignLanguageDuration(exam, part.id) ??
      singleExamDuration(exam);

    return {
      ...part,
      durationMinutes,
    };
  });
}

function linkedPart(exam, part, practiceExam, urlBuilder, solverKey = "") {
  if (!practiceExam) return unavailablePart(exam, part);

  const solver = solverKey ? solverRegistry[solverKey]?.storagePrefix || "" : "";

  return {
    ...part,
    available: true,
    durationMinutes: practiceExam.durationMinutes ?? part.durationMinutes ?? null,
    examId: practiceExam.id,
    ...(solver ? { solver } : {}),
    href: urlBuilder(practiceExam),
    simulationHref: urlBuilder(practiceExam, true),
  };
}

function isPreviewOnlyPart(part) {
  return part?.checkingSupported === false;
}

function croatianCorePartLabel(exam) {
  if (exam.year >= 2023) return "Čitanje, književnost i hrvatski jezik";
  if (exam.year >= 2021) return "Književnost, neknjiževni tekst i jezik";
  return "Književnost i jezik";
}

function croatianCoreDuration(exam) {
  return exam.year <= 2016 ? 80 : 100;
}

function croatianPracticeParts(exam) {
  const choiceExam = croatianChoiceExamForArchive(exam);
  const corePart = linkedPart(
    exam,
    {
      id: "abcd",
      label: croatianCorePartLabel(exam),
      description: "Zadatci iz ispitne knjižice.",
      durationMinutes: croatianCoreDuration(exam),
    },
    choiceExam,
    croatianChoiceUrl,
  );

  if (exam.year >= 2023 && !exam.level) {
    return [
      corePart,
      linkedPart(
        exam,
        {
          id: "sazetak",
          label: "Sažetak",
          description: "Pregled pisanoga sažetka.",
          durationMinutes: 80,
          checkingSupported: false,
        },
        croatianWritingExamForArchive(exam, "sazetak"),
        croatianWritingUrl,
      ),
      linkedPart(
        exam,
        {
          id: "skolski-esej",
          label: "Školski esej",
          description: "Pregled pisanoga dijela ispita.",
          durationMinutes: 160,
          checkingSupported: false,
        },
        croatianWritingExamForArchive(exam, "skolski-esej"),
        croatianWritingUrl,
      ),
    ];
  }

  const essayPart = {
    id: "skolski-esej",
    label: "Školski esej",
    description: "Pregled pisanoga dijela ispita.",
    durationMinutes: 160,
    checkingSupported: false,
  };
  const essayExam = croatianWritingExamForArchive(exam, "skolski-esej");

  if (exam.year === 2020 && normalizeTerm(exam.term) === "ljetni rok" && !essayExam) {
    return [corePart];
  }

  return [
    corePart,
    linkedPart(
      exam,
      essayPart,
      essayExam,
      croatianWritingUrl,
    ),
  ];
}

function genericAbcdPart(exam, part) {
  const choiceExam = abcdChoiceExamForArchive(exam);
  return linkedPart(
    exam,
    {
      ...part,
      description: part.description || "Interaktivno su dostupni ABCD zadatci iz ispitne knjižice.",
    },
    choiceExam,
    abcdChoiceUrl,
  );
}

function interactiveParts(exam) {
  if (exam.subject === "Engleski jezik") {
    const readingExam = readingExamForArchive(exam);
    const listeningExam = listeningExamForArchive(exam);
    const essayExam = essayExamForArchive(exam);
    const parts = withDurations(
      exam,
      englishPracticePartsForExam(exam).map((part) =>
        part.id === "esej"
          ? {
              ...part,
              id: "pisanje",
            }
          : part,
      ),
    ).map((part) =>
      part.id === "pisanje"
        ? {
            ...part,
            id: "esej",
          }
        : part,
    );

    return parts.map((part) => {
      const isReading = part.id === "citanje";
      const isListening = part.id === "slusanje";
      if (isReading) {
        return linkedPart(exam, part, readingExam, englishReadingUrl, "englishReading");
      }
      if (isListening) {
        return linkedPart(exam, part, listeningExam, englishListeningUrl, "englishListening");
      }
      if (part.id === "esej") {
        return linkedPart(exam, part, essayExam, englishEssayUrl, "englishEssay");
      }
      return unavailablePart(exam, part);
    });
  }

  if (exam.subject === "Hrvatski jezik") {
    return croatianPracticeParts(exam);
  }

  if (exam.subject === "Fizika") {
    const choiceExam = physicsChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "fizika",
          label: "Ispit",
          description: "Zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          requiresManualChecking: true,
        },
        choiceExam,
        physicsChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Matematika") {
    const choiceExam = mathChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "matematika",
          label: "Ispit",
          description: "Zadatci višestrukoga izbora i otvoreni zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          requiresManualChecking: true,
        },
        choiceExam,
        mathChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Kemija") {
    const choiceExam = chemistryChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "kemija",
          label: "Ispit",
          description: "ABCD zadatci ocjenjuju se automatski, a ostali zadatci ručno prema službenim rješenjima.",
          durationMinutes: singleExamDuration(exam),
          requiresManualChecking: true,
        },
        choiceExam,
        chemistryChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Povijest") {
    const choiceExam = historyChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "povijest",
          label: "Ispit",
          description: "Zadatci višestrukoga izbora i otvoreni zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          usesAiChecking: true,
        },
        choiceExam,
        historyChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Geografija") {
    const choiceExam = geographyChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "geografija",
          label: "Ispit",
          description: "Zadatci zatvorenoga tipa i otvoreni zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          usesAiChecking: true,
        },
        choiceExam,
        geographyChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Psihologija") {
    const choiceExam = psychologyChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "psihologija",
          label: "Ispit",
          description: "Zadatci zatvorenoga tipa i otvoreni zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          usesAiChecking: true,
        },
        choiceExam,
        psychologyChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Filozofija") {
    const choiceExam = philosophyChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "filozofija",
          label: "Ispit",
          description: "Zadatci zatvorenoga tipa i otvoreni zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          usesAiChecking: true,
        },
        choiceExam,
        philosophyChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Sociologija") {
    const choiceExam = sociologyChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "sociologija",
          label: "Ispit",
          description: "Zadatci zatvorenoga tipa i otvoreni zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          usesAiChecking: true,
        },
        choiceExam,
        sociologyChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Likovna umjetnost") {
    const choiceExam = artChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "likovna",
          label: "Ispitna knjižica 1",
          description: "ABCD zadatci i zadatci povezivanja provjeravaju se automatski, a otvoreni i crtački zadatci ručno prema službenim rješenjima kada su dostupna.",
          durationMinutes: singleExamDuration(exam),
          requiresManualChecking: true,
        },
        choiceExam,
        artChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Informatika") {
    const choiceExam = informaticsChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "informatika",
          label: "Ispit",
          description: "ABCD zadatci provjeravaju se automatski, a zadatci kratkoga i produženoga odgovora ručno prema službenim rješenjima.",
          durationMinutes: singleExamDuration(exam),
          requiresManualChecking: true,
        },
        choiceExam,
        informaticsChoiceUrl,
      ),
    ];
  }

  if (exam.subject === "Politika i gospodarstvo") {
    const choiceExam = politicsChoiceExamForArchive(exam);
    return [
      linkedPart(
        exam,
        {
          id: "politika",
          label: "Ispit",
          description: "Zadatci zatvorenoga tipa i otvoreni zadatci iz ispitne knjižice.",
          durationMinutes: singleExamDuration(exam),
          requiresManualChecking: true,
        },
        choiceExam,
        politicsChoiceUrl,
      ),
    ];
  }

  if (modernForeignLanguageSubjects.has(exam.subject)) {
    return unavailableParts(exam, withDurations(exam, unavailableForeignLanguageParts));
  }

  const choiceExam = abcdChoiceExamForArchive(exam);
  if (choiceExam) {
    return [
      genericAbcdPart(exam, {
        ...withDurations(exam, [singleExamPart])[0],
        description: "Interaktivno su dostupni ABCD zadatci iz ispitne knjižice.",
      }),
    ];
  }

  return unavailableParts(exam, withDurations(exam, [singleExamPart]));
}

function isStorageObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function readMergedStorageObjects(storageKeys, selectStoredObject = (stored) => stored) {
  const storedObjects = {};
  try {
    for (const key of storageKeys.slice().reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (isStorageObject(stored)) {
        Object.assign(storedObjects, selectStoredObject(stored));
      }
    }
  } catch {
    return {};
  }
  return storedObjects;
}

function readFirstStorageObject(storageKeys) {
  try {
    for (const key of storageKeys.slice().reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (isStorageObject(stored)) return stored;
    }
  } catch {
    return {};
  }
  return {};
}

function readEnglishResponses(readingExam) {
  return readMergedStorageObjects(englishReadingStorageKeys(readingExam));
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

function readEnglishListeningResponses(listeningExam) {
  return readMergedStorageObjects(englishListeningStorageKeys(listeningExam));
}

function englishListeningProgress(exam) {
  const listeningExam = listeningExamForArchive(exam);
  if (!listeningExam) return null;

  const knownQuestions = new Set(englishQuestionNumbers(listeningExam));
  const responses = readEnglishListeningResponses(listeningExam);
  const answered = Object.entries(responses).filter(
    ([question, answer]) =>
      knownQuestions.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered,
    id: listeningExam.id,
    total: knownQuestions.size,
  };
}

function englishEssayProgress() {
  return null;
}

function croatianWritingProgress() {
  return [];
}

function readPhysicsResponses(choiceExam) {
  return readMergedStorageObjects(physicsChoiceStorageKeys(choiceExam));
}

function readPhysicsOpenScores(choiceExam) {
  return readMergedStorageObjects(physicsOpenScoreStorageKeys(choiceExam));
}

function physicsQuestionNumbers(choiceExam) {
  return (choiceExam.tasks || []).flatMap((task) =>
    task.questions.map((question) => String(question.number)),
  );
}

function physicsOpenQuestions(choiceExam) {
  return (choiceExam.openTasks || []).flatMap((task) => task.questions);
}

function physicsProgress(exam) {
  const choiceExam = physicsChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownQuestions = new Set(physicsQuestionNumbers(choiceExam));
  const responses = readPhysicsResponses(choiceExam);
  const answered = Object.entries(responses).filter(
    ([question, answer]) =>
      knownQuestions.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const openQuestions = new Map(
    physicsOpenQuestions(choiceExam).map((question) => [
      String(question.number),
      Number(question.maxPoints),
    ]),
  );
  const openScores = readPhysicsOpenScores(choiceExam);
  const reviewed = Object.entries(openScores).filter(([question, score]) => {
    const maximum = openQuestions.get(question);
    return Number.isInteger(maximum)
      && Number.isInteger(score)
      && score >= 0
      && score <= maximum;
  }).length;

  return {
    answered: answered + reviewed,
    id: choiceExam.id,
    total: knownQuestions.size + openQuestions.size,
  };
}

function readMathResponses(choiceExam) {
  return readMergedStorageObjects(mathChoiceStorageKeys(choiceExam));
}

function readMathOpenScores(choiceExam) {
  return readMergedStorageObjects(mathOpenScoreStorageKeys(choiceExam));
}

function mathQuestionNumbers(choiceExam) {
  return (choiceExam.tasks || []).flatMap((task) =>
    task.questions.map((question) => String(question.number)),
  );
}

function mathOpenQuestions(choiceExam) {
  return (choiceExam.openTasks || []).flatMap((task) => task.questions);
}

function mathProgress(exam) {
  const choiceExam = mathChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownQuestions = new Set(mathQuestionNumbers(choiceExam));
  const responses = readMathResponses(choiceExam);
  const answered = Object.entries(responses).filter(
    ([question, answer]) =>
      knownQuestions.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const openQuestions = new Map(
    mathOpenQuestions(choiceExam).map((question) => [
      String(question.number),
      Number(question.maxPoints),
    ]),
  );
  const openScores = readMathOpenScores(choiceExam);
  const reviewed = Object.entries(openScores).filter(([question, score]) => {
    const maximum = openQuestions.get(question);
    return Number.isInteger(maximum)
      && Number.isInteger(score)
      && score >= 0
      && score <= maximum;
  }).length;

  return {
    answered: answered + reviewed,
    id: choiceExam.id,
    total: knownQuestions.size + openQuestions.size,
  };
}

function readChemistryResponses(choiceExam) {
  return readMergedStorageObjects(chemistryChoiceStorageKeys(choiceExam));
}

function readChemistryOpenScores(choiceExam) {
  return readMergedStorageObjects(chemistryOpenScoreStorageKeys(choiceExam));
}

function chemistryQuestionNumbers(choiceExam) {
  return (choiceExam.tasks || []).flatMap((task) =>
    task.questions.map((question) => String(question.number)),
  );
}

function chemistryOpenQuestions(choiceExam) {
  return (choiceExam.openTasks || []).flatMap((task) => task.questions);
}

function chemistryProgress(exam) {
  const choiceExam = chemistryChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownQuestions = new Set(chemistryQuestionNumbers(choiceExam));
  const responses = readChemistryResponses(choiceExam);
  const answered = Object.entries(responses).filter(
    ([question, answer]) =>
      knownQuestions.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const openQuestions = new Map(
    chemistryOpenQuestions(choiceExam).map((question) => [
      String(question.number),
      Number(question.maxPoints),
    ]),
  );
  const openScores = readChemistryOpenScores(choiceExam);
  const reviewed = Object.entries(openScores).filter(([question, score]) => {
    const maximum = openQuestions.get(question);
    return Number.isInteger(maximum)
      && Number.isInteger(score)
      && score >= 0
      && score <= maximum;
  }).length;

  return {
    answered: answered + reviewed,
    id: choiceExam.id,
    total: knownQuestions.size + openQuestions.size,
  };
}

function readCroatianResponses(choiceExam) {
  return readMergedStorageObjects(croatianChoiceStorageKeys(choiceExam));
}

function croatianQuestionNumbers(choiceExam) {
  return (choiceExam.questions || []).map(String);
}

function croatianProgress(exam) {
  const choiceExam = croatianChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownQuestions = new Set(croatianQuestionNumbers(choiceExam));
  const responses = readCroatianResponses(choiceExam);
  const answered = Object.entries(responses).filter(
    ([question, answer]) =>
      knownQuestions.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered,
    id: choiceExam.id,
    total: knownQuestions.size,
  };
}

function readHistoryChoiceState(choiceExam) {
  return readMergedStorageObjects(historyChoiceStorageKeys(choiceExam));
}

function historyQuestionNumbers(choiceExam) {
  return [
    ...(choiceExam.questions || []).map(String),
    ...(choiceExam.openQuestions || []).map(String),
  ];
}

function historyProgress(exam) {
  const choiceExam = historyChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const stored = readHistoryChoiceState(choiceExam);
  const closedResponses =
    stored.closedResponses && typeof stored.closedResponses === "object"
      ? stored.closedResponses
      : {};
  const openResponses =
    stored.openResponses && typeof stored.openResponses === "object"
      ? stored.openResponses
      : {};
  const answeredClosed = Object.entries(closedResponses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = Object.entries(openResponses).filter(
    ([question, answer]) =>
      knownOpen.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered: answeredClosed + answeredOpen,
    id: choiceExam.id,
    total: historyQuestionNumbers(choiceExam).length,
  };
}

function geographyProgress(exam) {
  const choiceExam = geographyChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const stored = {};
  try {
    for (const key of geographyChoiceStorageKeys(choiceExam).reverse()) {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(stored, value);
      }
    }
  } catch {
    return null;
  }

  const closedResponses =
    stored.closedResponses && typeof stored.closedResponses === "object"
      ? stored.closedResponses
      : {};
  const openResponses =
    stored.openResponses && typeof stored.openResponses === "object"
      ? stored.openResponses
      : {};
  const answeredClosed = Object.entries(closedResponses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = Object.entries(openResponses).filter(
    ([question, answer]) =>
      knownOpen.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered: answeredClosed + answeredOpen,
    id: choiceExam.id,
    total: knownClosed.size + knownOpen.size,
  };
}

function psychologyProgress(exam) {
  const choiceExam = psychologyChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const stored = readMergedStorageObjects(psychologyChoiceStorageKeys(choiceExam));
  const closedResponses =
    stored.closedResponses && typeof stored.closedResponses === "object"
      ? stored.closedResponses
      : {};
  const openResponses =
    stored.openResponses && typeof stored.openResponses === "object"
      ? stored.openResponses
      : {};
  const answeredClosed = Object.entries(closedResponses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = Object.entries(openResponses).filter(
    ([question, answer]) =>
      knownOpen.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered: answeredClosed + answeredOpen,
    id: choiceExam.id,
    total: knownClosed.size + knownOpen.size,
  };
}

function philosophyProgress(exam) {
  const choiceExam = philosophyChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const stored = readMergedStorageObjects(philosophyChoiceStorageKeys(choiceExam));
  const closedResponses =
    stored.closedResponses && typeof stored.closedResponses === "object"
      ? stored.closedResponses
      : {};
  const openResponses =
    stored.openResponses && typeof stored.openResponses === "object"
      ? stored.openResponses
      : {};
  const answeredClosed = Object.entries(closedResponses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = Object.entries(openResponses).filter(
    ([question, answer]) =>
      knownOpen.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered: answeredClosed + answeredOpen,
    id: choiceExam.id,
    total: knownClosed.size + knownOpen.size,
  };
}

function sociologyProgress(exam) {
  const choiceExam = sociologyChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const stored = readMergedStorageObjects(sociologyChoiceStorageKeys(choiceExam));
  const closedResponses =
    stored.closedResponses && typeof stored.closedResponses === "object"
      ? stored.closedResponses
      : {};
  const openResponses =
    stored.openResponses && typeof stored.openResponses === "object"
      ? stored.openResponses
      : {};
  const answeredClosed = Object.entries(closedResponses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = Object.entries(openResponses).filter(
    ([question, answer]) =>
      knownOpen.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered: answeredClosed + answeredOpen,
    id: choiceExam.id,
    total: knownClosed.size + knownOpen.size,
  };
}

function artProgress(exam) {
  const choiceExam = artChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const stored = readMergedStorageObjects(artChoiceStorageKeys(choiceExam));
  const closedResponses =
    stored.closedResponses && typeof stored.closedResponses === "object"
      ? stored.closedResponses
      : {};
  const openResponses =
    stored.openResponses && typeof stored.openResponses === "object"
      ? stored.openResponses
      : {};
  const openScores =
    stored.openScores && typeof stored.openScores === "object"
      ? stored.openScores
      : {};
  const answeredClosed = Object.entries(closedResponses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = new Set();
  Object.entries(openResponses).forEach(([question, answer]) => {
    if (knownOpen.has(question) && typeof answer === "string" && answer.trim()) {
      answeredOpen.add(question);
    }
  });
  Object.entries(openScores).forEach(([question, score]) => {
    const value = score && typeof score === "object" ? score.points : score;
    if (knownOpen.has(question) && value !== "" && value != null && Number.isInteger(Number(value))) {
      answeredOpen.add(question);
    }
  });

  return {
    answered: answeredClosed + answeredOpen.size,
    id: choiceExam.id,
    total: knownClosed.size + knownOpen.size,
  };
}

function informaticsProgress(exam) {
  const choiceExam = informaticsChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const stored = readMergedStorageObjects(informaticsChoiceStorageKeys(choiceExam));
  const closedResponses =
    stored.closedResponses && typeof stored.closedResponses === "object"
      ? stored.closedResponses
      : {};
  const openResponses =
    stored.openResponses && typeof stored.openResponses === "object"
      ? stored.openResponses
      : {};
  const openScores =
    stored.openScores && typeof stored.openScores === "object"
      ? stored.openScores
      : {};
  const answeredClosed = Object.entries(closedResponses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = new Set();
  Object.entries(openResponses).forEach(([question, answer]) => {
    if (knownOpen.has(question) && typeof answer === "string" && answer.trim()) {
      answeredOpen.add(question);
    }
  });
  Object.entries(openScores).forEach(([question, score]) => {
    const value = score && typeof score === "object" ? score.points : score;
    if (knownOpen.has(question) && value !== "" && value != null && Number.isInteger(Number(value))) {
      answeredOpen.add(question);
    }
  });

  return {
    answered: answeredClosed + answeredOpen.size,
    id: choiceExam.id,
    total: knownClosed.size + knownOpen.size,
  };
}

function readPoliticsChoiceResponses(choiceExam) {
  return readMergedStorageObjects(
    politicsChoiceStorageKeys(choiceExam),
    (stored) => stored.closedResponses || stored,
  );
}

function readPoliticsOpenScores(choiceExam) {
  return readMergedStorageObjects(solverOpenScoreStorageKeys("politicsChoice", choiceExam));
}

function politicsProgress(exam) {
  const choiceExam = politicsChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownClosed = new Set((choiceExam.questions || []).map(String));
  const knownOpen = new Set((choiceExam.openQuestions || []).map(String));
  const responses = readPoliticsChoiceResponses(choiceExam);
  const openScores = readPoliticsOpenScores(choiceExam);
  const answeredClosed = Object.entries(responses).filter(
    ([question, answer]) =>
      knownClosed.has(question) && typeof answer === "string" && answer.trim(),
  ).length;
  const answeredOpen = Object.entries(openScores).filter(
    ([question, score]) =>
      knownOpen.has(question) && Number.isInteger(score),
  ).length;

  return {
    answered: answeredClosed + answeredOpen,
    id: choiceExam.id,
    total: knownClosed.size + knownOpen.size,
  };
}

function readAbcdChoiceResponses(choiceExam) {
  return readMergedStorageObjects(abcdChoiceStorageKeys(choiceExam));
}

function abcdChoiceQuestionNumbers(choiceExam) {
  return (choiceExam.questions || []).map(String);
}

function abcdChoiceProgress(exam) {
  if (
    exam.subject === "Matematika"
    || exam.subject === "Kemija"
    || exam.subject === "Povijest"
    || exam.subject === "Geografija"
    || exam.subject === "Psihologija"
    || exam.subject === "Filozofija"
    || exam.subject === "Sociologija"
    || exam.subject === "Likovna umjetnost"
    || exam.subject === "Informatika"
    || exam.subject === "Politika i gospodarstvo"
  ) return null;

  const choiceExam = abcdChoiceExamForArchive(exam);
  if (!choiceExam) return null;

  const knownQuestions = new Set(abcdChoiceQuestionNumbers(choiceExam));
  const responses = readAbcdChoiceResponses(choiceExam);
  const answered = Object.entries(responses).filter(
    ([question, answer]) =>
      knownQuestions.has(question) && typeof answer === "string" && answer.trim(),
  ).length;

  return {
    answered,
    id: choiceExam.id,
    total: knownQuestions.size,
  };
}

function examProgress(exam) {
  const progressItems = [
    englishProgress(exam),
    englishListeningProgress(exam),
    englishEssayProgress(exam),
    ...croatianWritingProgress(exam),
    physicsProgress(exam),
    mathProgress(exam),
    chemistryProgress(exam),
    croatianProgress(exam),
    historyProgress(exam),
    geographyProgress(exam),
    psychologyProgress(exam),
    philosophyProgress(exam),
    sociologyProgress(exam),
    artProgress(exam),
    informaticsProgress(exam),
    politicsProgress(exam),
    abcdChoiceProgress(exam),
  ].filter(Boolean);
  const answered = progressItems.reduce((sum, item) => sum + item.answered, 0);
  const total = progressItems.reduce((sum, item) => sum + item.total, 0);
  let percent = total ? Math.round((answered / total) * 100) : 0;
  let label = "Nije započeto";
  let completed = Boolean(total && answered === total);

  if (total) {
    label = `${answered}/${total} odgovora`;
  }

  if (completed) {
    percent = 100;
    label = "Riješeno";
  }

  return {
    completed,
    label,
    percent: Math.max(0, Math.min(100, percent)),
    status: answered ? "started" : "",
  };
}

function localSimulationAttempts() {
  try {
    const simulations = window.AsistentProfile?.getProfile?.().simulations;
    return Array.isArray(simulations) ? simulations : [];
  } catch {
    return [];
  }
}

function simulationAttemptKey(attempt) {
  return (
    attempt?.id
    || `${attempt?.submittedAt || ""}:${attempt?.examId || ""}:${attempt?.part || ""}`
  );
}

function mergeSimulationAttempts(...lists) {
  const attemptsById = new Map();

  for (const attempt of lists.flat()) {
    if (!attempt || typeof attempt !== "object") continue;
    const key = simulationAttemptKey(attempt);
    if (!key || attemptsById.has(key)) continue;
    attemptsById.set(key, attempt);
  }

  return [...attemptsById.values()];
}

function allSimulationAttempts() {
  return mergeSimulationAttempts(serverSimulationAttempts, localSimulationAttempts());
}

async function loadServerSimulationAttempts() {
  if (serverSimulationAttemptsLoaded || !window.fetch) return;
  serverSimulationAttemptsLoaded = true;

  try {
    const response = await fetch("/api/profile/simulations", { credentials: "same-origin" });
    if (!response.ok) return;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return;

    const data = await response.json();
    if (!Array.isArray(data.simulations)) return;

    serverSimulationAttempts = data.simulations;
    renderApp();
  } catch {
    // Local profile data remains enough for the subject overview.
  }
}

function simulationAttemptPercentage(attempt) {
  if (!attempt || attempt.checkingSupported === false) return null;

  const percentage = numberOrNull(attempt.percentage);
  if (percentage !== null) return percentage;

  const score = numberOrNull(attempt.score);
  const maxScore = numberOrNull(attempt.maxScore);
  if (score === null || !maxScore) return null;

  return Math.round((score / maxScore) * 100);
}

function simulationAttemptMatchesArchiveExam(attempt, exam) {
  if (!attempt || typeof attempt !== "object") return false;

  const attemptYear = numberOrNull(attempt.year);
  const attemptLevel = String(attempt.level || "");

  return (
    attempt.subject === exam.subject
    && attemptYear === exam.year
    && normalizeTerm(attempt.term) === exam.term
    && attemptLevel === String(exam.level || "")
  );
}

function normalizedSimulationPartLabel(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("hr-HR");
}

function normalizedSimulationSolver(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function simulationAttemptMatchesPart(attempt, exam, part, requirePartIdentity = false) {
  if (!attempt || typeof attempt !== "object") return false;
  const sameExamId = Boolean(part.examId && attempt.examId === part.examId);
  if (!sameExamId && !simulationAttemptMatchesArchiveExam(attempt, exam)) return false;

  const attemptPart = normalizedSimulationPartLabel(attempt.part);
  const partLabel = normalizedSimulationPartLabel(part.label);
  const attemptSolver = normalizedSimulationSolver(attempt.solver);
  const partSolver = normalizedSimulationSolver(part.solver);
  const partMatches = Boolean(attemptPart && partLabel && attemptPart === partLabel);
  const solverMatches = Boolean(attemptSolver && partSolver && attemptSolver === partSolver);

  if (partMatches || solverMatches) return true;
  return sameExamId && !requirePartIdentity;
}

function bestSimulationPercentageForPart(exam, part, attempts, requirePartIdentity = false) {
  let best = null;

  for (const attempt of attempts) {
    if (!simulationAttemptMatchesPart(attempt, exam, part, requirePartIdentity)) continue;

    const percentage = simulationAttemptPercentage(attempt);
    if (percentage === null) continue;
    best = best === null ? percentage : Math.max(best, percentage);
  }

  return best === null ? null : Math.max(0, Math.min(100, Math.round(best)));
}

function bestSimulationPercentages(exam, attempts) {
  const parts = interactiveParts(exam).filter((part) => part.checkingSupported !== false);
  const examIdCounts = parts.reduce((counts, part) => {
    if (part.examId) counts.set(part.examId, (counts.get(part.examId) || 0) + 1);
    return counts;
  }, new Map());

  return parts.map((part) => {
    const requirePartIdentity = Boolean(part.examId && examIdCounts.get(part.examId) > 1);
    const percentage = bestSimulationPercentageForPart(
      exam,
      part,
      attempts,
      requirePartIdentity,
    );
    return {
      hasResult: percentage !== null,
      label: part.label,
      percentage: percentage ?? 0,
    };
  });
}

function percentageTone(percentage) {
  if (percentage >= 85) return "excellent";
  if (percentage >= 70) return "good";
  if (percentage >= 50) return "medium";
  if (percentage >= 30) return "low";
  return "poor";
}

function renderBestSimulationPercentageCircle(result) {
  const percentage = Math.max(0, Math.min(100, Math.round(numberOrNull(result.percentage) ?? 0)));
  const tone = result.hasResult ? percentageTone(percentage) : "empty";
  const title = result.hasResult
    ? `${result.label}: ${percentage}%`
    : `${result.label}: nema rezultata`;
  const text = result.hasResult ? `${percentage}%` : "-";
  return `<span class="subject-best-score subject-best-score--${tone}" title="${escapeHtml(
    title,
  )}">${escapeHtml(text)}</span>`;
}

function renderBestSimulationPercentages(results) {
  const safeResults = results.length
    ? results
    : [{ label: "Ispit", percentage: 0 }];
  const label = safeResults
    .map((result) => {
      const percentage = Math.max(0, Math.min(100, Math.round(numberOrNull(result.percentage) ?? 0)));
      return result.hasResult ? `${result.label}: ${percentage}%` : `${result.label}: nema rezultata`;
    })
    .join(", ");

  const content = safeResults
    .map(
      (result, index) =>
        `${index ? '<span class="subject-best-scores__separator" aria-hidden="true">/</span>' : ""}${renderBestSimulationPercentageCircle(result)}`,
    )
    .join("");

  return `<span class="subject-best-scores" aria-label="${escapeHtml(
    `Najbolji rezultati - ${label}`,
  )}">${content}</span>`;
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

function minimumPercent(value) {
  return `≥ ${value}%`;
}

function gradeThresholds(exam) {
  const passThreshold = twentyFivePercentPassSubjects.has(exam.subject) ? 25 : 30;

  return [
    {
      grade: "2",
      label: "Dovoljan",
      range: minimumPercent(passThreshold),
    },
    {
      grade: "3",
      label: "Dobar",
      range: minimumPercent(50),
    },
    {
      grade: "4",
      label: "Vrlo dobar",
      range: minimumPercent(70),
    },
    {
      grade: "5",
      label: "Odličan",
      range: minimumPercent(85),
    },
  ];
}

function gradeThresholdNote(exam) {
  return exam.subject === "Hrvatski jezik" ? croatianComponentThresholdNote : "";
}

function route() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("ispit") || params.has("predmet")) {
    return {
      examId: params.get("ispit"),
      legacyUrl: true,
      practicePart: params.get("cjelina"),
      subject: params.get("predmet"),
    };
  }

  const pathname = window.location.pathname;
  if (pathname.startsWith("/ispiti/")) {
    const exam = examsByPath.get(pathname.endsWith("/") ? pathname : `${pathname}/`);
    return {
      examId: exam?.id || null,
      legacyUrl: false,
      practicePart: params.get("cjelina"),
      subject: exam?.subject || null,
    };
  }

  const subjectMatch = pathname.match(/^\/predmeti\/([^/]+)\/?$/);
  if (subjectMatch) {
    return {
      examId: null,
      legacyUrl: false,
      practicePart: params.get("cjelina"),
      subject: subjectsBySlug.get(subjectMatch[1]) || null,
    };
  }

  return {
    examId: null,
    legacyUrl: false,
    practicePart: params.get("cjelina"),
    subject: null,
  };
}

function solverKeysForSubject(subject) {
  if (subject === "Engleski jezik") {
    return ["englishReading", "englishListening", "englishEssay"];
  }

  if (subject === "Hrvatski jezik") {
    return ["croatianChoice", "croatianWriting"];
  }

  if (subject === "Fizika") return ["physicsChoice"];
  if (subject === "Matematika") return ["mathChoice"];
  if (subject === "Kemija") return ["chemistryChoice"];
  if (subject === "Povijest") return ["historyChoice"];
  if (subject === "Geografija") return ["geographyChoice"];
  if (subject === "Psihologija") return ["psychologyChoice"];
  if (subject === "Filozofija") return ["philosophyChoice"];
  if (subject === "Sociologija") return ["sociologyChoice"];
  if (subject === "Likovna umjetnost") return ["artChoice"];
  if (subject === "Informatika") return ["informaticsChoice"];
  if (subject === "Politika i gospodarstvo") return ["politicsChoice"];

  if (modernForeignLanguageSubjects.has(subject)) {
    return [];
  }

  return ["abcdChoice"];
}

function solverKeysForRoute(currentRoute) {
  if (currentRoute.examId) {
    const exam = examsById.get(currentRoute.examId);
    return exam ? solverKeysForSubject(exam.subject) : [];
  }

  return currentRoute.subject ? solverKeysForSubject(currentRoute.subject) : [];
}

function solverDataReady(keys) {
  return keys.every((key) => Array.isArray(solverData(key)?.exams));
}

function renderDataLoading(currentRoute) {
  cleanupYearNavigation();
  const isExam = Boolean(currentRoute?.examId);
  const rowCount = isExam ? 3 : 6;
  const rows = Array.from(
    { length: rowCount },
    () => '<div class="skeleton-block skeleton-block--row"></div>',
  ).join("");
  appRoot.innerHTML = `
    <div class="skeleton-loading" aria-hidden="true">
      <div class="skeleton-block skeleton-block--${isExam ? "title" : "bar"}"></div>
      ${rows}
    </div>
    <span class="visually-hidden" role="status">Učitavam podatke ispita…</span>
  `;
}

async function renderApp() {
  const requestId = ++renderAppRequestId;
  const currentRoute = route();
  syncHomeHeadingVisibility(currentRoute);
  const requiredSolverKeys = solverKeysForRoute(currentRoute);

  if (!solverDataReady(requiredSolverKeys)) {
    renderDataLoading(currentRoute);

    try {
      await ensureSolverData(requiredSolverKeys);
    } catch {
      if (requestId !== renderAppRequestId) return;
      renderMissing(
        "Podatci nisu učitani",
        "Interaktivni podatci za odabrani ispit nisu se mogli učitati. Pokušaj osvježiti stranicu.",
      );
      return;
    }

    if (requestId !== renderAppRequestId) return;
  }

  if (currentRoute.examId) {
    const exam = examsById.get(currentRoute.examId);
    if (exam) {
      if (currentRoute.legacyUrl) {
        history.replaceState(null, "", examUrl(exam, currentRoute.practicePart));
      }
      renderExamPractice(exam, currentRoute.practicePart);
    } else {
      renderMissing("Matura nije pronađena", "Odabrani ispit nije dostupan.");
    }
    return;
  }

  if (currentRoute.subject) {
    const subject = allSubjects.find((candidate) => candidate === currentRoute.subject);
    if (subject) {
      if (currentRoute.legacyUrl) {
        history.replaceState(null, "", subjectUrl(subject));
      }
      renderSubjectPage(subject);
    } else {
      renderMissing("Predmet nije pronađen", "Odabrani predmet nije dostupan u arhivi.");
    }
    return;
  }

  renderHome();
}

function syncHomeHeadingVisibility(currentRoute) {
  const isHomeRoute = !currentRoute.examId && !currentRoute.subject;
  document.documentElement.classList.toggle("is-app-subpage", !isHomeRoute);

  if (homeHeading) {
    homeHeading.hidden = !isHomeRoute;
  }

  if (homeInformation) {
    homeInformation.hidden = !isHomeRoute;
  }
}

function renderHome() {
  cleanupYearNavigation();
  setHomeSeo();

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
  const visibleOptionalSubjects = allSubjects
    .filter((subject) => !mandatorySubjects.includes(subject))
    .sort((a, b) => {
      const aUnavailable = isSubjectTemporarilyUnavailable(a);
      const bUnavailable = isSubjectTemporarilyUnavailable(b);

      if (aUnavailable !== bUnavailable) {
        return aUnavailable ? 1 : -1;
      }

      return a.localeCompare(b, "hr");
    });

  subjectList.innerHTML = `
    <section class="subject-group">
      <div class="subject-group__heading">
        <h3>Obavezne mature</h3>
      </div>
      <div class="subject-grid subject-grid--mandatory">
        ${
          visibleMandatorySubjects.length
            ? visibleMandatorySubjects.map(renderSubjectCard).join("")
            : `
              <div class="empty-state subject-grid__empty">
                <h3>Nema obaveznih matura</h3>
                <p>Trenutačno nema predmeta u ovoj skupini.</p>
              </div>
            `
        }
      </div>
    </section>

    <section class="subject-group">
      <div class="subject-group__heading">
        <h3>Izborne mature</h3>
      </div>
      <div class="subject-grid">
        ${
          visibleOptionalSubjects.length
            ? visibleOptionalSubjects.map(renderSubjectCard).join("")
            : `
              <div class="empty-state subject-grid__empty">
                <h3>Nema izbornih matura</h3>
                <p>Trenutačno nema predmeta u ovoj skupini.</p>
              </div>
            `
        }
      </div>
    </section>
  `;
}

function renderSubjectCard(subject) {
  const colorStyle = ` style="--subject-color: ${subjectColor(subject)}; --subject-image: url('./assets/subjects/${subjectImage(subject)}.webp')"`;
  const actionLabel = `Vježbaj ${subjectAccusative(subject)}`;
  const unavailable = isSubjectTemporarilyUnavailable(subject);
  const subjectStatus = unavailable
    ? `<span class="subject-card__status subject-card__status--unavailable">U izradi</span>`
    : "";
  const cardClass = `subject-card${unavailable ? " subject-card--unavailable" : ""}`;
  const tagName = unavailable ? "span" : "a";
  const hrefAttribute = unavailable ? ' aria-disabled="true"' : ` href="${subjectUrl(subject)}"`;
  const actionIcon = unavailable ? "wrench" : "arrow-right";

  return `
    <${tagName} class="${cardClass}"${hrefAttribute}${colorStyle}>
      <span class="subject-symbol">
        ${subjectIcon(subject, "subject-symbol__icon")}
      </span>
      <span class="subject-card__body">
        <strong>${escapeHtml(actionLabel)}</strong>
        ${subjectStatus}
      </span>
      <span class="subject-card__action" aria-hidden="true">
        ${icon(actionIcon, "subject-card__action-icon")}
      </span>
    </${tagName}>
  `;
}

function renderSubjectPage(subject) {
  cleanupYearNavigation();
  setSubjectSeo(subject);
  const colorStyle = ` style="--subject-color: ${subjectColor(subject)}"`;

  appRoot.innerHTML = `
    <div class="subject-page"${colorStyle}>
      <div class="subject-page__intro">
        <a class="back-link back-link--home" href="./" aria-label="Svi predmeti">
          ${icon("house", "back-link__icon back-link__icon--desktop")}
          ${icon("arrow-left", "back-link__icon back-link__icon--mobile")}
          <span class="back-link__label">Svi predmeti</span>
        </a>
        <div class="subject-title-row">
          <span class="subject-symbol">
            ${subjectIcon(subject, "subject-symbol__icon")}
          </span>
          <h2>${escapeHtml(subject)}</h2>
        </div>
      </div>

      <div class="practice-layout">
        <aside class="filters practice-filters" aria-label="Brza navigacija po godinama ispita">
          <div class="filters__heading">
            <h2>Godine ispita</h2>
          </div>

          <nav class="year-jump-list" id="year-jump-list" aria-label="Godine ispita"></nav>
        </aside>

        <div class="subject-results">
          <div id="subject-exam-list"></div>
        </div>
      </div>
    </div>
  `;

  renderSubjectYearNavigation(subject);
  renderSubjectExamList(subject);
  setupYearNavigation();
}

function cleanupYearNavigation() {
  if (!yearNavigationCleanup) return;

  yearNavigationCleanup();
  yearNavigationCleanup = null;
}

function subjectYears(subject) {
  return [
    ...new Set(exams.filter((exam) => exam.subject === subject).map((exam) => exam.year)),
  ].sort((a, b) => b - a);
}

function activeYearFromHash(years) {
  const hashMatch = window.location.hash.match(/^#year-(\d{4})$/);
  if (!hashMatch) return years[0] || "";

  const hashYear = Number(hashMatch[1]);
  return years.includes(hashYear) ? hashYear : years[0] || "";
}

function renderSubjectYearNavigation(subject) {
  const years = subjectYears(subject);
  const activeYear = activeYearFromHash(years);

  appRoot.querySelector("#year-jump-list").innerHTML = years
    .map((year) => renderYearJumpLink(year, year === activeYear))
    .join("");
}

function renderYearJumpLink(year, active) {
  return `
    <a
      class="year-jump-link${active ? " year-jump-link--active" : ""}"
      href="#year-${year}"
      data-year-link="${year}"
      ${active ? 'aria-current="location"' : ""}
    >
      ${year}.
    </a>
  `;
}

function setupYearNavigation() {
  const nav = appRoot.querySelector("#year-jump-list");
  const sections = [...appRoot.querySelectorAll("[data-year-section]")];

  if (!nav || !sections.length) return;

  let pendingFrame = 0;

  const setActiveYear = (year) => {
    nav.querySelectorAll("[data-year-link]").forEach((link) => {
      const active = link.dataset.yearLink === year;
      link.classList.toggle("year-jump-link--active", active);

      if (active) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const updateActiveYear = () => {
    pendingFrame = 0;

    const threshold = Math.min(window.innerHeight * 0.35, 220);
    let activeSection = sections[0];

    for (const section of sections) {
      if (section.getBoundingClientRect().top <= threshold) {
        activeSection = section;
      } else {
        break;
      }
    }

    setActiveYear(activeSection.dataset.yearSection);
  };

  const requestActiveYearUpdate = () => {
    if (pendingFrame) return;
    pendingFrame = window.requestAnimationFrame(updateActiveYear);
  };

  const jumpToYearSection = (section) => {
    document.documentElement.style.scrollBehavior = "auto";
    section.scrollIntoView({ block: "start" });

    window.requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = "";
    });
  };

  const handleYearClick = (event) => {
    const link = event.target.closest("[data-year-link]");
    if (!link) return;

    const year = link.dataset.yearLink;
    const section = document.getElementById(`year-${year}`);
    if (!section) return;

    event.preventDefault();
    setActiveYear(year);
    history.pushState(null, "", link.getAttribute("href"));
    jumpToYearSection(section);
  };

  nav.addEventListener("click", handleYearClick);
  window.addEventListener("scroll", requestActiveYearUpdate, { passive: true });
  window.addEventListener("resize", requestActiveYearUpdate);
  window.addEventListener("hashchange", requestActiveYearUpdate);

  requestActiveYearUpdate();

  const hashTargetId = window.location.hash.slice(1);
  if (hashTargetId.startsWith("year-")) {
    const hashTarget = document.getElementById(hashTargetId);
    if (hashTarget) {
      window.requestAnimationFrame(() => jumpToYearSection(hashTarget));
    }
  }

  yearNavigationCleanup = () => {
    if (pendingFrame) {
      window.cancelAnimationFrame(pendingFrame);
    }
    nav.removeEventListener("click", handleYearClick);
    window.removeEventListener("scroll", requestActiveYearUpdate);
    window.removeEventListener("resize", requestActiveYearUpdate);
    window.removeEventListener("hashchange", requestActiveYearUpdate);
  };
}

function subjectExams(subject) {
  return exams.filter((exam) => exam.subject === subject).sort(compareExams);
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
  const filtered = subjectExams(subject);
  const simulationAttempts = allSimulationAttempts();

  if (!filtered.length) {
    appRoot.querySelector("#subject-exam-list").innerHTML = `
      <div class="empty-state">
        <h3>Nema ispita</h3>
        <p>Za odabrani predmet trenutačno nema dostupnih paketa.</p>
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
    .map(([year, yearExams]) => renderPracticeYearBlock(year, yearExams, simulationAttempts))
    .join("");
}

function renderPracticeYearBlock(year, yearExams, simulationAttempts) {
  const hasLevels = yearExams.some((exam) => exam.level);

  return `
    <section
      class="year-block practice-year-block"
      id="year-${year}"
      data-year-section="${year}"
      aria-labelledby="year-${year}-heading"
    >
      <div class="year-heading">
        <h3 id="year-${year}-heading">${year}.</h3>
        <p>školska godina ${year - 1}./${year}.</p>
      </div>
      <div class="practice-table-wrap">
        <table class="practice-exam-table subject-exam-table">
          <colgroup>
            <col class="subject-exam-table__col-term" />
            <col class="subject-exam-table__col-progress" />
            <col class="subject-exam-table__col-best" />
            <col class="subject-exam-table__col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th><span class="visually-hidden">Rok i razina</span></th>
              <th>Napredak</th>
              <th title="Najbolji rezultat virtualne mature">Najbolji rezultat</th>
              <th>Materijali</th>
            </tr>
          </thead>
          <tbody>
            ${yearExams
              .map((exam) => renderSubjectExamRow(exam, hasLevels, simulationAttempts))
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSubjectExamRow(exam, hasLevels, simulationAttempts) {
  const progress = examProgress(exam);
  const bestPercentages = bestSimulationPercentages(exam, simulationAttempts);

  return `
    <tr>
      <td data-label="Rok">
        <div class="subject-exam-table__exam-label">
          <strong>${escapeHtml(formatTerm(exam.term))}</strong>
          ${hasLevels ? levelBadge(exam.level) : ""}
        </div>
      </td>
      <td class="subject-exam-table__progress-cell" data-label="Napredak">
        <div class="exam-progress">
          <div class="exam-progress__meter-row">
            ${progressMeter(progress.percent, `Napredak: ${progress.percent}%`)}
            <strong class="exam-progress__percent">${progress.percent}%</strong>
          </div>
        </div>
      </td>
      <td class="subject-exam-table__best-cell" data-label="Rezultat">
        ${renderBestSimulationPercentages(bestPercentages)}
      </td>
      <td data-label="Materijali">
        <div class="exam-actions">
          <a class="primary-button" href="${examUrl(exam)}">Otvori maturu</a>
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
  cleanupYearNavigation();
  setExamSeo(exam);

  appRoot.innerHTML = `
    <div class="practice-detail" style="--subject-color: ${subjectColor(exam.subject)}">
      <a class="back-link" href="${subjectUrl(exam.subject)}">
        ${icon("arrow-left", "back-link__icon")}
        <span>Natrag na ${escapeHtml(exam.subject)}</span>
      </a>

      <div class="practice-detail__heading">
        <span class="subject-symbol">
          ${subjectIcon(exam.subject, "subject-symbol__icon")}
        </span>
        <div class="practice-detail__title-row">
          <h2>${escapeHtml(exam.subject)} ${exam.year}.</h2>
          <p>${escapeHtml(formatLevel(exam.level))}, ${escapeHtml(exam.term)}</p>
        </div>
      </div>

      <div class="practice-detail__content">
        <div class="practice-detail__main">
          ${renderInteractiveArea(exam, selectedPartId)}
        </div>
        ${renderGradeThresholds(exam)}
      </div>
    </div>
  `;
}

function renderGradeThresholds(exam) {
  const note = gradeThresholdNote(exam);

  return `
    <aside class="grade-thresholds" aria-label="Pragovi ocjena">
      <div class="grade-thresholds__heading">
        <h3>Pragovi ocjena</h3>
        <p>Postotci riješenosti ispita</p>
      </div>
      <table class="grade-thresholds__table">
        <thead>
          <tr>
            <th>Ocjena</th>
            <th>Postotak</th>
          </tr>
        </thead>
        <tbody>
          ${gradeThresholds(exam)
            .map(
              (threshold) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(threshold.grade)}</strong>
                    <span>${escapeHtml(threshold.label)}</span>
                  </td>
                  <td>${escapeHtml(threshold.range)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
      ${note ? `<p class="grade-thresholds__note">${escapeHtml(note)}</p>` : ""}
    </aside>
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

  return `
    <section class="practice-exam-selection">
      <div class="practice-exam-list">
        ${parts.map((part) => renderPracticeExamRow(part, selectedPartId)).join("")}
      </div>
      ${parts.some((part) => part.available && !isPreviewOnlyPart(part)) ? renderSimulationNote() : ""}
    </section>
  `;
}

function renderPreviewPracticeActions(part, active) {
  if (part.available) {
    return `
      <a
        class="primary-button"
        href="${escapeHtml(part.href)}"
        ${active ? 'aria-current="true"' : ""}
      >
        Pregledaj
      </a>
    `;
  }

  return `
    <button class="primary-button" type="button" disabled>
      Pregledaj
    </button>
  `;
}

function renderSolvablePracticeActions(part, active) {
  if (part.available) {
    return `
      <a
        class="primary-button"
        href="${escapeHtml(part.href)}"
        ${active ? 'aria-current="true"' : ""}
      >
        Otvori vježbu
      </a>
      <a
        class="secondary-button"
        href="${escapeHtml(part.simulationHref)}"
        data-simulation-start-link
        data-simulation-duration="${escapeHtml(part.durationMinutes ?? "")}"
      >
        Simuliraj maturu
      </a>
    `;
  }

  return `
    <button class="primary-button" type="button" disabled>
      Otvori vježbu
    </button>
    <button class="secondary-button" type="button" disabled>
      Simuliraj maturu
    </button>
  `;
}

function renderPracticeExamRow(part, selectedPartId) {
  const active = selectedPartId === part.id;
  const activeClass = active ? " practice-exam-row--active" : "";
  const duration = part.durationMinutes != null && Number.isFinite(Number(part.durationMinutes))
    ? `${part.durationMinutes} min`
    : "Trajanje nije podešeno";

  return `
    <article class="practice-exam-row${activeClass}">
      <div class="practice-exam-row__name">
        <strong>${escapeHtml(part.label)}</strong>
        ${part.available ? "" : '<small class="practice-exam-row__status">Trenutno nedostupno</small>'}
      </div>
      <div class="practice-exam-row__duration">
        ${escapeHtml(duration)}
      </div>
      <div class="practice-exam-row__actions">
        ${
          isPreviewOnlyPart(part)
            ? renderPreviewPracticeActions(part, active)
            : renderSolvablePracticeActions(part, active)
        }
      </div>
    </article>
  `;
}

function browserShouldHandleNavigation(event, link) {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (link.target && link.target !== "_self") ||
    link.hasAttribute("download")
  );
}

function handleSimulationStartLinkClick(event) {
  const link = event.target instanceof Element
    ? event.target.closest("[data-simulation-start-link]")
    : null;
  if (!link || !appRoot.contains(link)) return;
  if (browserShouldHandleNavigation(event, link)) return;
  if (!window.openExamSimulationStartDialog) return;

  event.preventDefault();

  window.openExamSimulationStartDialog({
    durationMinutes: link.dataset.simulationDuration,
    onCancel: () => window.AsistentAnalytics?.track?.("simulation_cancel"),
    onConfirm: ({ confirmedAt }) => {
      window.rememberExamSimulationStart?.({
        confirmedAt,
        targetUrl: link.href,
      });
      window.location.assign(link.href);
    },
  });
}

function renderSimulationNote() {
  return `
    <p class="simulation-note">
      <strong>Simulacija mature</strong> ima vremensko ograničenje prema trajanju
      odabranog ispita. Odgovori i napredak rješavanja iz simulacije ne spremaju se.
      Provjera svih zadataka odvija se odjednom na kraju (nema međuprovjere zadatak po zadatak).
    </p>
  `;
}

function renderMissing(title, message) {
  cleanupYearNavigation();
  setMissingSeo(title, message);
  appRoot.innerHTML = `
    <div class="empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <a class="start-link" href="./">Vrati se na predmete</a>
    </div>
  `;
}

appRoot.addEventListener("click", handleSimulationStartLinkClick);
window.addEventListener("asistent:practice-progress-synced", renderApp);
window.AsistentProfile?.ready?.then(renderApp).catch(() => {});
loadServerSimulationAttempts();
renderApp();
