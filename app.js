const archiveData = window.ASISTENT_ZA_MATURE_DATA;
const englishReadingData = window.ASISTENT_ZA_MATURE_ENGLISH_READING;
const englishListeningData = window.ASISTENT_ZA_MATURE_ENGLISH_LISTENING;
const englishEssayData = window.ASISTENT_ZA_MATURE_ENGLISH_ESSAY;
const physicsChoiceData = window.ASISTENT_ZA_MATURE_PHYSICS_CHOICE;
const mathChoiceData = window.ASISTENT_ZA_MATURE_MATH_CHOICE;
const croatianChoiceData = window.ASISTENT_ZA_MATURE_CROATIAN_CHOICE;
const historyChoiceData = window.ASISTENT_ZA_MATURE_HISTORY_CHOICE;
const abcdChoiceData = window.ASISTENT_ZA_MATURE_ABCD_CHOICE;

if (!archiveData || !Array.isArray(archiveData.exams)) {
  throw new Error("Nedostaje generirani indeks ispita.");
}

const mandatorySubjects = [
  "Matematika",
  "Hrvatski jezik",
  "Engleski jezik",
];

const temporarilyUnavailableSubjects = new Set([
  "Biologija",
  "Etika",
  "Filozofija",
  "Francuski jezik",
  "Glazbena umjetnost",
  "Grčki jezik",
  "Informatika",
  "Kemija",
  "Latinski jezik",
  "Likovna umjetnost",
  "Logika",
  "Mađarski jezik",
  "Mađarski jezik i književnost",
  "Njemački jezik",
  "Politika i gospodarstvo",
  "Psihologija",
  "Sociologija",
  "Srpski jezik",
  "Španjolski jezik",
  "Talijanski jezik",
  "Talijanski jezik i književnost",
  "Vjeronauk",
]);

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

const subjectImages = {
  Biologija: "biology",
  "Engleski jezik": "english-dictionary",
  Etika: "ethics-justice",
  Filozofija: "philosophy-thinker",
  Fizika: "physics",
  "Francuski jezik": "french-eiffel",
  Geografija: "geography",
  "Glazbena umjetnost": "music",
  "Grčki jezik": "greek-columns",
  "Hrvatski jezik": "croatian-writing",
  Informatika: "informatics",
  Kemija: "chemistry",
  "Latinski jezik": "latin-rome",
  "Likovna umjetnost": "art",
  Logika: "logic-chess",
  "Mađarski jezik": "hungarian-budapest",
  "Mađarski jezik i književnost": "books",
  Matematika: "mathematics",
  "Njemački jezik": "german-brandenburg",
  "Politika i gospodarstvo": "civics",
  Povijest: "history-document",
  Psihologija: "psychology-brain",
  Sociologija: "sociology-crowd",
  "Srpski jezik": "serbian-typewriter",
  "Španjolski jezik": "spanish-madrid",
  "Talijanski jezik": "italian-colosseum",
  "Talijanski jezik i književnost": "literature-book",
  Vjeronauk: "religion-bible",
};

const subjectAccusativeLabels = {
  Biologija: "Biologiju",
  "Engleski jezik": "Engleski jezik",
  Etika: "Etiku",
  Filozofija: "Filozofiju",
  Fizika: "Fiziku",
  "Francuski jezik": "Francuski jezik",
  Geografija: "Geografiju",
  "Glazbena umjetnost": "Glazbenu umjetnost",
  "Grčki jezik": "Grčki jezik",
  "Hrvatski jezik": "Hrvatski jezik",
  Informatika: "Informatiku",
  Kemija: "Kemiju",
  "Latinski jezik": "Latinski jezik",
  "Likovna umjetnost": "Likovnu umjetnost",
  Logika: "Logiku",
  "Mađarski jezik": "Mađarski jezik",
  "Mađarski jezik i književnost": "Mađarski jezik i književnost",
  Matematika: "Matematiku",
  "Njemački jezik": "Njemački jezik",
  "Politika i gospodarstvo": "Politiku i gospodarstvo",
  Povijest: "Povijest",
  Psihologija: "Psihologiju",
  Sociologija: "Sociologiju",
  "Srpski jezik": "Srpski jezik",
  "Španjolski jezik": "Španjolski jezik",
  "Talijanski jezik": "Talijanski jezik",
  "Talijanski jezik i književnost": "Talijanski jezik i književnost",
  Vjeronauk: "Vjeronauk",
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
const homeHeading = document.querySelector("[data-home-heading]");

if (!appRoot) {
  throw new Error("Nedostaje korijenski element aplikacije.");
}

let yearNavigationCleanup = null;
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

function englishReadingIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function englishListeningIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function englishEssayIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function physicsChoiceIdForTerm(exam, term) {
  return `fizika-${exam.year}-${slugPart(term)}`;
}

function mathChoiceIdForTerm(exam, term) {
  const level = exam.level ? `-${exam.level.toLocaleLowerCase("hr")}` : "";
  return `matematika${level}-${exam.year}-${slugPart(term)}`;
}

function croatianChoiceIdForTerm(exam, term) {
  const level = exam.level ? `-${exam.level.toLocaleLowerCase("hr")}` : "";
  return `hrvatski${level}-${exam.year}-${slugPart(term)}`;
}

function historyChoiceIdForTerm(exam, term) {
  return `povijest-${exam.year}-${slugPart(term)}`;
}

function abcdChoiceIdForTerm(exam, term) {
  const level = exam.level ? `-${exam.level.toLocaleLowerCase("hr")}` : "";
  return `${slugPart(exam.subject)}${level}-${exam.year}-${slugPart(term)}`;
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

function englishListeningStorageKeys(listeningExam) {
  const ids = [
    listeningExam.id,
    ...(legacyTermAliases[listeningExam.term] || []).map((term) =>
      englishListeningIdForTerm(listeningExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:english-listening:${id}`);
}

function englishEssayStorageKeys(essayExam) {
  const ids = [
    essayExam.id,
    ...(legacyTermAliases[essayExam.term] || []).map((term) =>
      englishEssayIdForTerm(essayExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:english-essay:${id}`);
}

function physicsChoiceStorageKeys(choiceExam) {
  const ids = [
    choiceExam.id,
    ...(legacyTermAliases[choiceExam.term] || []).map((term) =>
      physicsChoiceIdForTerm(choiceExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:physics-choice:${id}`);
}

function physicsOpenScoreStorageKeys(choiceExam) {
  return physicsChoiceStorageKeys(choiceExam).map((key) => `${key}:open-scores`);
}

function mathChoiceStorageKeys(choiceExam) {
  const ids = [
    choiceExam.id,
    ...(legacyTermAliases[choiceExam.term] || []).map((term) =>
      mathChoiceIdForTerm(choiceExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:math-choice:${id}`);
}

function mathOpenScoreStorageKeys(choiceExam) {
  return mathChoiceStorageKeys(choiceExam).map((key) => `${key}:open-scores`);
}

function croatianChoiceStorageKeys(choiceExam) {
  const ids = [
    choiceExam.id,
    ...(legacyTermAliases[choiceExam.term] || []).map((term) =>
      croatianChoiceIdForTerm(choiceExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:croatian-choice:${id}`);
}

function historyChoiceStorageKeys(choiceExam) {
  const ids = [
    choiceExam.id,
    ...(legacyTermAliases[choiceExam.term] || []).map((term) =>
      historyChoiceIdForTerm(choiceExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:history-choice:${id}`);
}

function abcdChoiceStorageKeys(choiceExam) {
  const ids = [
    choiceExam.id,
    ...(legacyTermAliases[choiceExam.term] || []).map((term) =>
      abcdChoiceIdForTerm(choiceExam, term),
    ),
  ];

  return [...new Set(ids)].map((id) => `asistent-za-mature:abcd-choice:${id}`);
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
const englishListeningExams = (englishListeningData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: englishListeningIdForTerm(exam, term),
  };
});
const englishListeningByArchiveUrl = new Map(
  englishListeningExams.map((exam) => [exam.archiveUrl, exam]),
);
const englishEssayExams = (englishEssayData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: englishEssayIdForTerm(exam, term),
  };
});
const englishEssayByArchiveUrl = new Map(
  englishEssayExams.map((exam) => [exam.archiveUrl, exam]),
);
const physicsChoiceExams = (physicsChoiceData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: physicsChoiceIdForTerm(exam, term),
  };
});
const physicsChoiceByArchiveUrl = new Map(
  physicsChoiceExams.map((exam) => [exam.archiveUrl, exam]),
);
const mathChoiceExams = (mathChoiceData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: mathChoiceIdForTerm(exam, term),
  };
});
const mathChoiceByArchiveUrl = new Map(
  mathChoiceExams.map((exam) => [exam.archiveUrl, exam]),
);
const croatianChoiceExams = (croatianChoiceData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: croatianChoiceIdForTerm(exam, term),
  };
});
const croatianChoiceByArchiveUrl = new Map(
  croatianChoiceExams.map((exam) => [exam.archiveUrl, exam]),
);
const historyChoiceExams = (historyChoiceData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: historyChoiceIdForTerm(exam, term),
  };
});
const historyChoiceByArchiveUrl = new Map(
  historyChoiceExams.map((exam) => [exam.archiveUrl, exam]),
);
const abcdChoiceExams = (abcdChoiceData?.exams || []).map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: abcdChoiceIdForTerm(exam, term),
  };
});
const abcdChoiceByArchiveUrl = new Map(
  abcdChoiceExams.map((exam) => [exam.archiveUrl, exam]),
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
  "Francuski jezik": {
    A: { citanje: 65, slusanje: 30, pisanje: 55 },
    B: { citanje: 75, slusanje: 25, pisanje: 75 },
  },
  "Njemački jezik": {
    A: { citanje: 70, slusanje: 35, pisanje: 75 },
    B: { citanje: 100, slusanje: 30, pisanje: 100 },
  },
  "Španjolski jezik": {
    A: { citanje: 65, slusanje: 30, pisanje: 55 },
    B: { citanje: 75, slusanje: 25, pisanje: 75 },
  },
  "Talijanski jezik": {
    A: { citanje: 65, slusanje: 30, pisanje: 55 },
    B: { citanje: 75, slusanje: 25, pisanje: 75 },
  },
};
const modernForeignLanguageSubjects = new Set([
  "Engleski jezik",
  "Francuski jezik",
  "Njemački jezik",
  "Španjolski jezik",
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
const literatureLanguageSubjects = new Set([
  "Mađarski jezik",
  "Mađarski jezik i književnost",
  "Srpski jezik",
]);
const literatureLanguageParts = [
  {
    id: "knjizevnost-jezik",
    label: "Književnost i jezik",
    description: "Zadatci iz književnosti i jezika.",
  },
  {
    id: "skolski-esej",
    label: "Školski esej",
    description: "Pisani dio ispita.",
  },
];
const literatureLanguageDurations = {
  "Mađarski jezik": {
    "knjizevnost-jezik": 80,
    "skolski-esej": 180,
  },
  "Mađarski jezik i književnost": {
    "knjizevnost-jezik": 80,
    "skolski-esej": 180,
  },
  "Srpski jezik": {
    "knjizevnost-jezik": 90,
    "skolski-esej": 150,
  },
};
const italianLiteratureParts = [
  {
    id: "strukturirani-ispit",
    label: "Strukturirani ispit",
    description: "Zadatci iz jezika i književnosti.",
    durationMinutes: 100,
  },
  {
    id: "pisani-rad",
    label: "Pisani rad",
    description: "Pisani dio ispita.",
    durationMinutes: 180,
  },
];
const musicPracticeParts = [
  {
    id: "glazba-u-kontekstu",
    label: "Glazba u kontekstu",
    description: "Prva ispitna knjižica.",
    durationMinutes: 20,
  },
  {
    id: "slusanje-upoznavanje-glazbe",
    label: "Slušanje i upoznavanje glazbe",
    description: "Druga ispitna knjižica sa zvučnim zapisom.",
    durationMinutes: 70,
  },
];
const singleExamPart = {
  id: "ispit",
  label: "Ispit",
  description: "Ispitna knjižica.",
};
const singleExamDurations = {
  Biologija: 150,
  Etika: 150,
  Filozofija: 150,
  Fizika: 180,
  Geografija: 90,
  "Grčki jezik": 120,
  Informatika: 100,
  Kemija: 180,
  "Latinski jezik": 120,
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
  Vjeronauk: 70,
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

function icon(iconName, className) {
  return `
    <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg?v=20260603-subject-status#${iconName}"></use>
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
    ? `<span class="level-badge">${escapeHtml(level)}</span>`
    : `<span class="level-badge level-badge--empty">-</span>`;
}

function subjectUrl(subject) {
  return `./?predmet=${encodeURIComponent(subject)}`;
}

function isSubjectTemporarilyUnavailable(subject) {
  return temporarilyUnavailableSubjects.has(subject);
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

function englishReadingUrl(readingExam, simulation = false) {
  const params = new URLSearchParams({ exam: readingExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./engleski-citanje.html?${params.toString()}`;
}

function englishListeningUrl(listeningExam, simulation = false) {
  const params = new URLSearchParams({ exam: listeningExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./engleski-slusanje.html?${params.toString()}`;
}

function englishEssayUrl(essayExam, simulation = false) {
  const params = new URLSearchParams({ exam: essayExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./engleski-esej.html?${params.toString()}`;
}

function physicsChoiceUrl(choiceExam, simulation = false) {
  const params = new URLSearchParams({ exam: choiceExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./fizika.html?${params.toString()}`;
}

function mathChoiceUrl(choiceExam, simulation = false) {
  const params = new URLSearchParams({ exam: choiceExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./matematika.html?${params.toString()}`;
}

function croatianChoiceUrl(choiceExam, simulation = false) {
  const params = new URLSearchParams({ exam: choiceExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./hrvatski.html?${params.toString()}`;
}

function historyChoiceUrl(choiceExam, simulation = false) {
  const params = new URLSearchParams({ exam: choiceExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./povijest.html?${params.toString()}`;
}

function abcdChoiceUrl(choiceExam, simulation = false) {
  const params = new URLSearchParams({ exam: choiceExam.id });
  if (simulation) params.set("nacin", "simulacija");
  return `./abcd.html?${params.toString()}`;
}

function readingExamForArchive(exam) {
  return englishReadingByArchiveUrl.get(exam.url) || null;
}

function listeningExamForArchive(exam) {
  return englishListeningByArchiveUrl.get(exam.url) || null;
}

function essayExamForArchive(exam) {
  return englishEssayByArchiveUrl.get(exam.url) || null;
}

function physicsChoiceExamForArchive(exam) {
  return physicsChoiceByArchiveUrl.get(exam.url) || null;
}

function mathChoiceExamForArchive(exam) {
  return mathChoiceByArchiveUrl.get(exam.url) || null;
}

function croatianChoiceExamForArchive(exam) {
  return croatianChoiceByArchiveUrl.get(exam.url) || null;
}

function historyChoiceExamForArchive(exam) {
  return historyChoiceByArchiveUrl.get(exam.url) || null;
}

function abcdChoiceExamForArchive(exam) {
  return abcdChoiceByArchiveUrl.get(exam.url) || null;
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

function literatureLanguageDuration(exam, partId) {
  return literatureLanguageDurations[exam.subject]?.[partId] ?? null;
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
      literatureLanguageDuration(exam, part.id) ??
      singleExamDuration(exam);

    return {
      ...part,
      durationMinutes,
    };
  });
}

function linkedPart(exam, part, practiceExam, urlBuilder) {
  if (!practiceExam) return unavailablePart(exam, part);

  return {
    ...part,
    available: true,
    durationMinutes: practiceExam.durationMinutes ?? part.durationMinutes ?? null,
    href: urlBuilder(practiceExam),
    simulationHref: urlBuilder(practiceExam, true),
  };
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
      unavailablePart(exam, {
        id: "sazetak",
        label: "Sažetak",
        description: "Pisani sažetak.",
        durationMinutes: 80,
      }),
      unavailablePart(exam, {
        id: "skolski-esej",
        label: "Školski esej",
        description: "Pisani dio ispita.",
        durationMinutes: 160,
      }),
    ];
  }

  return [
    corePart,
    unavailablePart(exam, {
      id: "skolski-esej",
      label: "Školski esej",
      description: "Pisani dio ispita.",
      durationMinutes: 160,
    }),
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
      if (isReading) return linkedPart(exam, part, readingExam, englishReadingUrl);
      if (isListening) return linkedPart(exam, part, listeningExam, englishListeningUrl);
      if (part.id === "esej") return linkedPart(exam, part, essayExam, englishEssayUrl);
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
        },
        choiceExam,
        mathChoiceUrl,
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
        },
        choiceExam,
        historyChoiceUrl,
      ),
    ];
  }

  if (modernForeignLanguageSubjects.has(exam.subject)) {
    return unavailableParts(exam, withDurations(exam, unavailableForeignLanguageParts));
  }

  if (literatureLanguageSubjects.has(exam.subject)) {
    return withDurations(exam, literatureLanguageParts).map((part) =>
      part.id === "knjizevnost-jezik"
        ? genericAbcdPart(exam, part)
        : unavailablePart(exam, part),
    );
  }

  if (exam.subject === "Talijanski jezik i književnost") {
    return italianLiteratureParts.map((part) =>
      part.id === "strukturirani-ispit"
        ? genericAbcdPart(exam, part)
        : unavailablePart(exam, part),
    );
  }

  if (exam.subject === "Glazbena umjetnost") {
    return unavailableParts(exam, musicPracticeParts);
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

function readEnglishListeningResponses(listeningExam) {
  const storedResponses = {};
  try {
    for (const key of englishListeningStorageKeys(listeningExam).reverse()) {
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

function readEnglishEssayDraft(essayExam) {
  try {
    for (const key of englishEssayStorageKeys(essayExam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        return typeof stored.essayText === "string" ? stored.essayText : "";
      }
    }
  } catch {
    return "";
  }
  return "";
}

function englishEssayProgress(exam) {
  const essayExam = essayExamForArchive(exam);
  if (!essayExam) return null;

  return {
    answered: readEnglishEssayDraft(essayExam).trim() ? 1 : 0,
    id: essayExam.id,
    total: 1,
  };
}

function readPhysicsResponses(choiceExam) {
  const storedResponses = {};
  try {
    for (const key of physicsChoiceStorageKeys(choiceExam).reverse()) {
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

function readPhysicsOpenScores(choiceExam) {
  const storedScores = {};
  try {
    for (const key of physicsOpenScoreStorageKeys(choiceExam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedScores, stored);
      }
    }
  } catch {
    return {};
  }
  return storedScores;
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
  const storedResponses = {};
  try {
    for (const key of mathChoiceStorageKeys(choiceExam).reverse()) {
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

function readMathOpenScores(choiceExam) {
  const storedScores = {};
  try {
    for (const key of mathOpenScoreStorageKeys(choiceExam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedScores, stored);
      }
    }
  } catch {
    return {};
  }
  return storedScores;
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

function readCroatianResponses(choiceExam) {
  const storedResponses = {};
  try {
    for (const key of croatianChoiceStorageKeys(choiceExam).reverse()) {
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
  const storedState = {};
  try {
    for (const key of historyChoiceStorageKeys(choiceExam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedState, stored);
      }
    }
  } catch {
    return {};
  }
  return storedState;
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

function readAbcdChoiceResponses(choiceExam) {
  const storedResponses = {};
  try {
    for (const key of abcdChoiceStorageKeys(choiceExam).reverse()) {
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

function abcdChoiceQuestionNumbers(choiceExam) {
  return (choiceExam.questions || []).map(String);
}

function abcdChoiceProgress(exam) {
  if (exam.subject === "Matematika" || exam.subject === "Povijest") return null;

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
    physicsProgress(exam),
    mathProgress(exam),
    croatianProgress(exam),
    historyProgress(exam),
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

function interactiveExamIds(exam) {
  return new Set(
    [
      readingExamForArchive(exam)?.id,
      listeningExamForArchive(exam)?.id,
      essayExamForArchive(exam)?.id,
      physicsChoiceExamForArchive(exam)?.id,
      mathChoiceExamForArchive(exam)?.id,
      croatianChoiceExamForArchive(exam)?.id,
      historyChoiceExamForArchive(exam)?.id,
      abcdChoiceExamForArchive(exam)?.id,
    ].filter(Boolean),
  );
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

function simulationAttemptMatchesExam(attempt, exam, examIds) {
  if (!attempt || typeof attempt !== "object") return false;
  if (examIds.has(attempt.examId)) return true;

  const attemptYear = numberOrNull(attempt.year);
  const attemptLevel = String(attempt.level || "");

  return (
    attempt.subject === exam.subject
    && attemptYear === exam.year
    && normalizeTerm(attempt.term) === exam.term
    && attemptLevel === String(exam.level || "")
  );
}

function bestSimulationPercentage(exam, attempts) {
  const examIds = interactiveExamIds(exam);
  let best = null;

  for (const attempt of attempts) {
    if (!simulationAttemptMatchesExam(attempt, exam, examIds)) continue;

    const percentage = simulationAttemptPercentage(attempt);
    if (percentage === null) continue;
    best = best === null ? percentage : Math.max(best, percentage);
  }

  return best === null ? null : Math.max(0, Math.min(100, Math.round(best)));
}

function percentageTone(percentage) {
  if (percentage >= 85) return "excellent";
  if (percentage >= 70) return "good";
  if (percentage >= 50) return "medium";
  if (percentage >= 30) return "low";
  return "poor";
}

function renderBestSimulationPercentage(percentage) {
  if (percentage === null) {
    return `<span class="subject-best-score subject-best-score--empty" aria-label="Nema rezultata">/</span>`;
  }

  const tone = percentageTone(percentage);
  return `
    <span class="subject-best-score subject-best-score--${tone}">
      ${escapeHtml(`${percentage}%`)}
    </span>
  `;
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
  return {
    examId: params.get("ispit"),
    practicePart: params.get("cjelina"),
    subject: params.get("predmet"),
  };
}

function renderApp() {
  const currentRoute = route();
  syncHomeHeadingVisibility(currentRoute);

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

function syncHomeHeadingVisibility(currentRoute) {
  const isHomeRoute = !currentRoute.examId && !currentRoute.subject;
  document.documentElement.classList.toggle("is-app-subpage", !isHomeRoute);

  if (homeHeading) {
    homeHeading.hidden = !isHomeRoute;
  }
}

function renderHome() {
  cleanupYearNavigation();
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
        <h3>Ostali predmeti <span class="subject-group__note">(Dostupni prvo)</span></h3>
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
  document.title = `${subject} - Asistent za Mature`;
  const colorStyle = ` style="--subject-color: ${subjectColor(subject)}"`;

  appRoot.innerHTML = `
    <div class="subject-page"${colorStyle}>
      <div class="subject-page__intro">
        <a class="back-link back-link--home" href="./">
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
        <table class="practice-exam-table subject-exam-table${
          hasLevels ? " subject-exam-table--with-levels" : " subject-exam-table--without-levels"
        }">
          <colgroup>
            <col class="subject-exam-table__col-term" />
            ${hasLevels ? '<col class="subject-exam-table__col-level" />' : ""}
            <col class="subject-exam-table__col-progress" />
            <col class="subject-exam-table__col-best" />
            <col class="subject-exam-table__col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Rok</th>
              ${hasLevels ? "<th>Razina</th>" : ""}
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
  const bestPercentage = bestSimulationPercentage(exam, simulationAttempts);

  return `
    <tr>
      <td>
        <strong>${escapeHtml(formatTerm(exam.term))}</strong>
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
      <td class="subject-exam-table__best-cell">
        ${renderBestSimulationPercentage(bestPercentage)}
      </td>
      <td>
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
  document.title = `${exam.subject} ${exam.year}. - Asistent za Mature`;

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
      ${parts.some((part) => part.available) ? renderSimulationNote() : ""}
    </section>
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
          part.available
            ? `
              <a
                class="primary-button"
                href="${escapeHtml(part.href)}"
                ${active ? 'aria-current="true"' : ""}
              >
                Otvori vježbu
              </a>
              <a class="secondary-button" href="${escapeHtml(part.simulationHref)}">
                Simuliraj maturu
              </a>
            `
            : `
              <button class="primary-button" type="button" disabled>
                Otvori vježbu
              </button>
              <button class="secondary-button" type="button" disabled>
                Simuliraj maturu
              </button>
            `
        }
      </div>
    </article>
  `;
}

function renderSimulationNote() {
  return `
    <p class="simulation-note">
      <strong>Simulacija mature</strong> ima vremensko ograničenje prema trajanju
      odabranog ispita. Odgovori i napredak iz simulacije ne spremaju se.
    </p>
  `;
}

function renderMissing(title, message) {
  cleanupYearNavigation();
  document.title = "Asistent za Mature";
  appRoot.innerHTML = `
    <div class="empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <a class="start-link" href="./">Vrati se na predmete</a>
    </div>
  `;
}

window.addEventListener("asistent:practice-progress-synced", renderApp);
window.AsistentProfile?.ready?.then(renderApp).catch(() => {});
loadServerSimulationAttempts();
renderApp();
