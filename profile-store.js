(function () {
  const storageKey = "asistent-za-mature:profile";
  const maxSimulationAttempts = 200;

  function nowIso() {
    return new Date().toISOString();
  }

  function readStoredProfile() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  }

  function writeProfile(profile) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(profile));
    } catch {
      // Profile display and solving continue to work if local storage is unavailable.
    }
  }

  function syncSimulationAttempt(attempt) {
    if (!window.fetch) return;

    window.fetch("/api/profile/simulations", {
      body: JSON.stringify({ attempt }),
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch(() => {
      // Server sync is optional; local profile storage is the fallback.
    });
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function stringOrEmpty(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeAttempt(attempt) {
    if (!attempt || typeof attempt !== "object") return null;

    const submittedAt = stringOrEmpty(attempt.submittedAt) || nowIso();
    const examId = stringOrEmpty(attempt.examId);
    const subject = stringOrEmpty(attempt.subject);
    const part = stringOrEmpty(attempt.part);
    if (!examId || !subject) return null;

    const score = numberOrNull(attempt.score);
    const maxScore = numberOrNull(attempt.maxScore);
    const percentage =
      score !== null && maxScore
        ? Math.round((score / maxScore) * 100)
        : numberOrNull(attempt.percentage);

    return {
      id:
        stringOrEmpty(attempt.id) ||
        `sim-${Date.parse(submittedAt) || Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      submittedAt,
      solver: stringOrEmpty(attempt.solver),
      subject,
      part,
      examId,
      year: numberOrNull(attempt.year),
      term: stringOrEmpty(attempt.term),
      level: stringOrEmpty(attempt.level),
      schoolYear: stringOrEmpty(attempt.schoolYear),
      durationMinutes: numberOrNull(attempt.durationMinutes),
      answered: numberOrNull(attempt.answered),
      totalQuestions: numberOrNull(attempt.totalQuestions),
      score,
      maxScore,
      percentage,
      checkingSupported: attempt.checkingSupported !== false,
    };
  }

  function normalizeProfile(profile, createIfMissing = true) {
    const createdAt =
      profile && typeof profile.createdAt === "string"
        ? profile.createdAt
        : createIfMissing
          ? nowIso()
          : "";

    const simulations = Array.isArray(profile?.simulations)
      ? profile.simulations
          .map(normalizeAttempt)
          .filter(Boolean)
          .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
          .slice(0, maxSimulationAttempts)
      : [];

    return {
      version: 1,
      createdAt,
      simulations,
    };
  }

  function getProfile() {
    const stored = readStoredProfile();
    const profile = normalizeProfile(stored);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(profile)) writeProfile(profile);
    return profile;
  }

  function recordSimulationAttempt(attemptInput) {
    const attempt = normalizeAttempt({
      ...attemptInput,
      submittedAt: stringOrEmpty(attemptInput?.submittedAt) || nowIso(),
    });
    if (!attempt) return null;

    const profile = getProfile();
    profile.simulations = [attempt, ...profile.simulations].slice(0, maxSimulationAttempts);
    writeProfile(profile);
    syncSimulationAttempt(attempt);
    return attempt;
  }

  window.AsistentProfile = {
    getProfile,
    recordSimulationAttempt,
    storageKey,
  };
})();
