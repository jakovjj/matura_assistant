(function () {
  const storageKey = "asistent-za-mature:profile";
  const practiceMetaStorageKey = "asistent-za-mature:practice-sync-meta";
  const practiceEndpoint = "/api/profile/practice";
  const practiceStoragePrefixes = [
    "asistent-za-mature:english-reading:",
    "asistent-za-mature:english-listening:",
    "asistent-za-mature:physics-choice:",
    "asistent-za-mature:math-choice:",
    "asistent-za-mature:croatian-choice:",
    "asistent-za-mature:history-choice:",
    "asistent-za-mature:geography-choice:",
    "asistent-za-mature:abcd-choice:",
  ];
  const canonicalOrigin = "https://matura.com.hr";
  const legacyPracticeHosts = new Set(["matura.jandric.com"]);
  const migrationWindowNameType = "asistent-za-mature:practice-migration";
  const maxSimulationAttempts = 200;
  const maxPracticeItems = 500;
  let practiceSyncPromise = null;
  let pendingPracticeItems = new Map();
  let pendingFlushTimer = 0;
  let suppressPracticeCapture = false;

  function nowIso() {
    return new Date().toISOString();
  }

  function canUseLocalStorage() {
    try {
      const testKey = "asistent-za-mature:storage-test";
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
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

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function parseJsonObject(value) {
    try {
      const parsed = JSON.parse(value || "{}");
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function isPracticeStorageKey(key) {
    return practiceStoragePrefixes.some((prefix) => String(key || "").startsWith(prefix));
  }

  function normalizeTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
  }

  function readPracticeMeta() {
    try {
      const parsed = JSON.parse(localStorage.getItem(practiceMetaStorageKey) || "{}");
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePracticeMeta(meta) {
    try {
      localStorage.setItem(practiceMetaStorageKey, JSON.stringify(meta));
    } catch {
      // Practice still works locally if metadata cannot be written.
    }
  }

  function updatePracticeMeta(key, updatedAt) {
    const meta = readPracticeMeta();
    meta[key] = updatedAt;
    writePracticeMeta(meta);
  }

  function normalizePracticeItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const key = typeof item.key === "string" ? item.key : "";
    if (!isPracticeStorageKey(key)) return null;
    if (!isPlainObject(item.value)) return null;
    return {
      key,
      value: item.value,
      updatedAt: normalizeTimestamp(item.updatedAt) || nowIso(),
    };
  }

  function collectLocalPracticeItems() {
    const meta = readPracticeMeta();
    const items = [];

    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!isPracticeStorageKey(key)) continue;

        const value = parseJsonObject(localStorage.getItem(key));
        if (!value) continue;

        const hasMeta = typeof meta[key] === "string";
        if (!Object.keys(value).length && !hasMeta) continue;

        items.push({
          hasMeta,
          key,
          value,
          updatedAt: normalizeTimestamp(meta[key]) || "",
        });
      }
    } catch {
      return [];
    }

    return items.slice(0, maxPracticeItems);
  }

  function writePracticeStorageItem(item) {
    const normalized = normalizePracticeItem(item);
    if (!normalized) return false;

    suppressPracticeCapture = true;
    try {
      localStorage.setItem(normalized.key, JSON.stringify(normalized.value));
      updatePracticeMeta(normalized.key, normalized.updatedAt);
      return true;
    } catch {
      return false;
    } finally {
      suppressPracticeCapture = false;
    }
  }

  function mergePracticeValues(serverValue, localValue) {
    return {
      ...(isPlainObject(serverValue) ? serverValue : {}),
      ...(isPlainObject(localValue) ? localValue : {}),
    };
  }

  function migrationTargetUrl() {
    const target = new URL(window.location.href);
    target.protocol = "https:";
    target.host = new URL(canonicalOrigin).host;
    target.searchParams.set("azm_migracija", "1");
    return target.toString();
  }

  function startLegacyPracticeMigration() {
    if (!legacyPracticeHosts.has(window.location.hostname) || !canUseLocalStorage()) return false;

    const items = collectLocalPracticeItems()
      .filter((item) => Object.keys(item.value).length)
      .map((item) => ({
        key: item.key,
        value: item.value,
        updatedAt: item.hasMeta ? item.updatedAt : nowIso(),
      }))
      .slice(0, maxPracticeItems);

    if (!items.length) return false;

    try {
      window.name = JSON.stringify({
        type: migrationWindowNameType,
        version: 1,
        createdAt: nowIso(),
        sourceHost: window.location.hostname,
        items,
      });
      window.location.replace(migrationTargetUrl());
      return true;
    } catch {
      return false;
    }
  }

  function consumePracticeMigration() {
    if (window.location.origin !== canonicalOrigin || !window.name || !canUseLocalStorage()) {
      return [];
    }

    let payload;
    try {
      payload = JSON.parse(window.name);
    } catch {
      return [];
    }

    if (
      !payload ||
      payload.type !== migrationWindowNameType ||
      !legacyPracticeHosts.has(payload.sourceHost) ||
      !Array.isArray(payload.items)
    ) {
      return [];
    }

    window.name = "";
    const localMeta = readPracticeMeta();
    const migratedItems = [];

    for (const item of payload.items.slice(0, maxPracticeItems)) {
      const normalized = normalizePracticeItem(item);
      if (!normalized) continue;

      const localValue = parseJsonObject(localStorage.getItem(normalized.key)) || {};
      const localUpdatedAt = normalizeTimestamp(localMeta[normalized.key]);
      const localIsNewer =
        localUpdatedAt && Date.parse(localUpdatedAt) > Date.parse(normalized.updatedAt);
      const value = localIsNewer
        ? mergePracticeValues(normalized.value, localValue)
        : mergePracticeValues(localValue, normalized.value);
      const migratedItem = {
        key: normalized.key,
        value,
        updatedAt: nowIso(),
      };

      if (writePracticeStorageItem(migratedItem)) migratedItems.push(migratedItem);
    }

    if (window.location.search.includes("azm_migracija=")) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("azm_migracija");
      window.history.replaceState(null, "", cleanUrl.toString());
    }

    if (migratedItems.length) {
      window.dispatchEvent(
        new CustomEvent("asistent:practice-progress-synced", {
          detail: {
            downloaded: migratedItems.length,
            migrated: migratedItems.length,
            uploaded: 0,
          },
        }),
      );
    }

    return migratedItems;
  }

  function queuePracticeItem(item) {
    const normalized = normalizePracticeItem(item);
    if (!normalized) return;

    pendingPracticeItems.set(normalized.key, normalized);
    window.clearTimeout(pendingFlushTimer);
    pendingFlushTimer = window.setTimeout(flushPracticeUpdates, 400);
  }

  async function sendPracticeItems(items) {
    if (!window.fetch || !items.length) return null;

    let payload = null;
    for (let index = 0; index < items.length; index += 10) {
      const batch = items.slice(index, index + 10);
      const response = await window.fetch(practiceEndpoint, {
        body: JSON.stringify({ items: batch }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Practice sync failed.");
      payload = await response.json();
    }

    return payload;
  }

  async function flushPracticeUpdates() {
    window.clearTimeout(pendingFlushTimer);
    pendingFlushTimer = 0;

    const items = [...pendingPracticeItems.values()];
    pendingPracticeItems = new Map();
    if (!items.length) return;

    try {
      await sendPracticeItems(items);
    } catch {
      // Local progress remains available and will be retried during the next profile sync.
    }
  }

  function capturePracticeStorageWrite(key, rawValue) {
    if (suppressPracticeCapture || !isPracticeStorageKey(key)) return;
    const value = parseJsonObject(rawValue);
    if (!value) return;

    const updatedAt = nowIso();
    updatePracticeMeta(key, updatedAt);
    queuePracticeItem({ key, value, updatedAt });
  }

  function capturePracticeStorageRemoval(key) {
    if (suppressPracticeCapture || !isPracticeStorageKey(key)) return;

    const updatedAt = nowIso();
    updatePracticeMeta(key, updatedAt);
    queuePracticeItem({ key, value: {}, updatedAt });
  }

  function installPracticeStorageCapture() {
    if (!window.Storage?.prototype || window.__asistentPracticeStorageCaptureInstalled) return;

    const nativeSetItem = window.Storage.prototype.setItem;
    const nativeRemoveItem = window.Storage.prototype.removeItem;
    window.__asistentPracticeStorageCaptureInstalled = true;

    window.Storage.prototype.setItem = function (key, value) {
      const result = nativeSetItem.apply(this, arguments);
      if (this === window.localStorage) capturePracticeStorageWrite(String(key), String(value));
      return result;
    };

    window.Storage.prototype.removeItem = function (key) {
      const result = nativeRemoveItem.apply(this, arguments);
      if (this === window.localStorage) capturePracticeStorageRemoval(String(key));
      return result;
    };
  }

  async function syncPracticeProgressNow() {
    if (!window.fetch || !canUseLocalStorage()) return { synced: false };

    const response = await window.fetch(practiceEndpoint, { credentials: "same-origin" });
    if (response.status === 401) return { synced: false };
    if (!response.ok) throw new Error("Practice sync failed.");

    const payload = await response.json();
    const serverItems = Array.isArray(payload.items)
      ? payload.items.map(normalizePracticeItem).filter(Boolean)
      : [];
    const serverByKey = new Map(serverItems.map((item) => [item.key, item]));
    const localItems = collectLocalPracticeItems();
    const localByKey = new Map(localItems.map((item) => [item.key, item]));
    const uploadItems = [];
    let downloaded = 0;

    for (const serverItem of serverItems) {
      const localItem = localByKey.get(serverItem.key);
      if (!localItem) {
        if (writePracticeStorageItem(serverItem)) downloaded += 1;
        continue;
      }

      const serverTime = Date.parse(serverItem.updatedAt);
      const localTime = Date.parse(localItem.updatedAt);
      const serverIsNewer =
        localItem.hasMeta &&
        Number.isFinite(serverTime) &&
        Number.isFinite(localTime) &&
        serverTime > localTime;

      if (serverIsNewer) {
        if (writePracticeStorageItem(serverItem)) downloaded += 1;
        continue;
      }

      const updatedAt = localItem.hasMeta ? localItem.updatedAt : nowIso();
      const mergedItem = {
        key: serverItem.key,
        value: mergePracticeValues(serverItem.value, localItem.value),
        updatedAt,
      };
      writePracticeStorageItem(mergedItem);
      uploadItems.push(mergedItem);
    }

    for (const localItem of localItems) {
      if (serverByKey.has(localItem.key)) continue;

      uploadItems.push({
        key: localItem.key,
        value: localItem.value,
        updatedAt: localItem.hasMeta ? localItem.updatedAt : nowIso(),
      });
    }

    const dedupedUploadItems = [
      ...new Map(uploadItems.map((item) => [item.key, normalizePracticeItem(item)])).values(),
    ].filter(Boolean);
    if (dedupedUploadItems.length) await sendPracticeItems(dedupedUploadItems);

    window.dispatchEvent(
      new CustomEvent("asistent:practice-progress-synced", {
        detail: {
          downloaded,
          uploaded: dedupedUploadItems.length,
        },
      }),
    );

    return {
      downloaded,
      synced: true,
      uploaded: dedupedUploadItems.length,
    };
  }

  function syncPracticeProgress() {
    if (practiceSyncPromise) return practiceSyncPromise;

    practiceSyncPromise = syncPracticeProgressNow()
      .catch(() => ({ synced: false }))
      .finally(() => {
        practiceSyncPromise = null;
      });
    return practiceSyncPromise;
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

  function recordPracticeProgress(key, value) {
    if (!isPracticeStorageKey(key) || !isPlainObject(value)) return null;

    const item = {
      key,
      value,
      updatedAt: nowIso(),
    };
    updatePracticeMeta(key, item.updatedAt);
    queuePracticeItem(item);
    return item;
  }

  installPracticeStorageCapture();
  const legacyMigrationStarted = startLegacyPracticeMigration();
  const migratedPracticeItems = legacyMigrationStarted ? [] : consumePracticeMigration();
  const ready = legacyMigrationStarted
    ? Promise.resolve({ migrationStarted: true, synced: false })
    : syncPracticeProgress();

  window.AsistentProfile = {
    getProfile,
    legacyMigrationStarted,
    migratedPracticeItems,
    practiceMetaStorageKey,
    ready,
    recordPracticeProgress,
    recordSimulationAttempt,
    syncPracticeProgress,
    storageKey,
  };
})();
