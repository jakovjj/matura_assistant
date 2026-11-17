(() => {
  // Visited days are stored as {"YYYY-MM-DD": 1}. The key is synced to the
  // account by profile-store.js, and the server unions days from all devices.
  const storageKey = "asistent-za-mature:study-streak:days";
  const legacyStorageKey = "asistent-za-mature:study-streak";
  const maxStoredDays = 400;
  const maxRenderedMarks = 100;
  const markGap = 13;
  const groupGap = 22;
  const markHeight = 54;

  const pad = (value) => String(value).padStart(2, "0");
  const dayKey = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dayNumber = (key) => {
    const [year, month, day] = String(key || "").split("-").map(Number);
    if (!year || !month || !day) return NaN;
    return Math.round(Date.UTC(year, month - 1, day) / 86400000);
  };
  const isDayKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(key);

  function readDays() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.keys(parsed).filter(isDayKey);
      }
    } catch {
      // Storage may be blocked; the board then stays hidden.
    }
    return [];
  }

  function writeDays(days) {
    const recent = [...new Set(days)].sort().slice(-maxStoredDays);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(Object.fromEntries(recent.map((day) => [day, 1]))),
      );
    } catch {
      // Ignore blocked storage.
    }
  }

  // Converts the first {last, count} format into a list of days.
  function readLegacyDays() {
    try {
      const legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || "null");
      localStorage.removeItem(legacyStorageKey);
      const last = dayNumber(legacy?.last);
      const count = Math.min(maxStoredDays, Math.floor(Number(legacy?.count) || 0));
      if (!Number.isFinite(last) || count < 1) return [];
      return Array.from({ length: count }, (_, offset) =>
        dayKey(new Date((last - offset) * 86400000 + new Date().getTimezoneOffset() * 60000)),
      );
    } catch {
      return [];
    }
  }

  // Records today's visit; returns true when today was not recorded yet.
  function recordVisit() {
    const today = dayKey(new Date());
    const days = readDays();
    const legacyDays = readLegacyDays();
    if (days.includes(today) && !legacyDays.length) return false;
    writeDays([...days, ...legacyDays, today]);
    return !days.includes(today) && !legacyDays.includes(today);
  }

  function streakStats(days) {
    const numbers = [...new Set(days.map(dayNumber))].filter(Number.isFinite).sort((a, b) => a - b);
    const visited = new Set(numbers);
    let count = 0;
    for (let day = dayNumber(dayKey(new Date())); visited.has(day); day -= 1) count += 1;

    let best = 0;
    let run = 0;
    numbers.forEach((day, index) => {
      run = index > 0 && day === numbers[index - 1] + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    });
    return { count, best };
  }

  function daysLabel(count) {
    return count % 10 === 1 && count % 100 !== 11 ? "dan" : "dana";
  }

  // Deterministic wobble so the same mark looks the same on every visit.
  function wobble(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value) - 0.5;
  }

  // Quadratic stroke for one tally mark; the fifth mark crosses its group.
  function markStroke(index) {
    const groupIndex = Math.floor(index / 5);
    const position = index % 5;
    const groupX = groupIndex * (4 * markGap + groupGap);

    if (position === 4) {
      const x1 = groupX - 7 + wobble(index) * 3;
      const y1 = markHeight - 10 + wobble(index + 0.6) * 5;
      const x2 = groupX + 3 * markGap + 7 + wobble(index + 0.3) * 3;
      const y2 = 9 + wobble(index + 0.9) * 5;
      return {
        x1, y1, x2, y2,
        cx: (x1 + x2) / 2 + wobble(index + 1.2) * 4,
        cy: (y1 + y2) / 2 + wobble(index + 1.5) * 6,
      };
    }

    const x = groupX + position * markGap;
    const lean = wobble(index + 2.1) * 6;
    const x1 = x + lean / 2 + wobble(index) * 1.5;
    const x2 = x - lean / 2 + wobble(index + 0.4) * 1.5;
    const y1 = 3 + Math.abs(wobble(index + 0.8)) * 6;
    const y2 = markHeight - 3 - Math.abs(wobble(index + 1.1)) * 6;
    return {
      x1, y1, x2, y2,
      cx: (x1 + x2) / 2 + wobble(index + 1.4) * 4,
      cy: markHeight / 2 + wobble(index + 1.7) * 8,
    };
  }

  function strokePath({ x1, y1, cx, cy, x2, y2 }, dx = 0, dy = 0) {
    const f = (value) => value.toFixed(1);
    return `M${f(x1 + dx)} ${f(y1 + dy)} Q${f(cx + dx)} ${f(cy + dy)} ${f(x2 + dx)} ${f(y2 + dy)}`;
  }

  function tallySvg(count, animateLast) {
    const marks = Math.min(count, maxRenderedMarks);
    const paths = [];
    let minX = Infinity;
    let maxX = -Infinity;
    for (let index = 0; index < marks; index += 1) {
      const stroke = markStroke(index);
      minX = Math.min(minX, stroke.x1, stroke.x2);
      maxX = Math.max(maxX, stroke.x1, stroke.x2);
      const extra =
        animateLast && index === marks - 1 ? ' class="study-streak__mark--new" pathLength="1"' : "";
      // A main stroke plus a thin offset pass gives the dragged-chalk edge.
      paths.push(
        `<path class="study-streak__stroke" d="${strokePath(stroke)}"${extra} />`,
        `<path class="study-streak__stroke study-streak__stroke--edge" d="${strokePath(stroke, 1.6, wobble(index + 3) * 2)}"${extra} />`,
      );
    }
    const padding = 8;
    const x = Math.floor(minX - padding);
    const width = Math.ceil(maxX - minX + padding * 2);
    return `<svg class="study-streak__tally" viewBox="${x} 0 ${width} ${markHeight}" width="${width}" height="${markHeight}" aria-hidden="true" focusable="false">
      <g filter="url(#study-streak-chalk)">${paths.join("")}</g>
    </svg>`;
  }

  function encouragement(count) {
    if (count % 5 === 0) return "Još jedna puna petica na ploči. Bravo!";
    if (count > 30) return "Više od mjesec dana zaredom. Svaka čast na upornosti!";
    if (count >= 14) return "Upornost se isplati, tako se gradi znanje za maturu.";
    if (count >= 7) return "Odlično ti ide, učenje ti postaje navika.";
    return "Dobar početak, svaki dan se zbraja.";
  }

  function render(root, { count, best }, added) {
    const title = `Učiš već <strong>${count}</strong> ${daysLabel(count)} zaredom`;
    const note = encouragement(count);
    const bestNote =
      best > count
        ? `<p class="study-streak__note study-streak__note--best">Najduži niz: ${best} ${daysLabel(best)}</p>`
        : "";

    root.innerHTML = `
      <div class="container">
        <div class="study-streak__board">
          <svg class="study-streak__defs" width="0" height="0" aria-hidden="true" focusable="false">
            <filter id="study-streak-chalk" filterUnits="userSpaceOnUse" x="-2000" y="-50" width="6000" height="200">
              <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="7" result="warp" />
              <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
              <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="3" result="grain" />
              <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.75" result="holes" />
              <feComposite in="rough" in2="holes" operator="in" />
            </filter>
          </svg>
          <div class="study-streak__marks">${tallySvg(count, added)}</div>
          <p class="study-streak__count">${title}</p>
          <p class="study-streak__note">${note}</p>
          ${bestNote}
          <span class="study-streak__chalk" aria-hidden="true"></span>
        </div>
      </div>
    `;
    root.hidden = false;
  }

  const root = document.querySelector("[data-study-streak]");

  // A single day is not a streak yet; the board appears from the second day.
  function update(animateNewMark) {
    if (!root) return;
    const stats = streakStats(readDays());
    if (stats.count >= 2) render(root, stats, animateNewMark);
    else root.hidden = true;
  }

  update(recordVisit());
  // Days from other devices arrive after the account sync.
  window.addEventListener("asistent:practice-progress-synced", () => update(false));
})();
