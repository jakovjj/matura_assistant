(() => {
  const section = document.querySelector("[data-home-news]");
  if (!section) return;

  const track = section.querySelector("[data-home-news-track]");
  const prevButton = section.querySelector("[data-home-news-prev]");
  const nextButton = section.querySelector("[data-home-news-next]");
  if (!track) return;

  const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const cardHtml = (item) => {
    const title = escapeHtml(item.title);
    const url = escapeHtml(item.url);
    const date = escapeHtml(item.date);
    const media = item.image
      ? `<span class="home-news__image">
           <img src="${escapeHtml(item.image)}" alt="" loading="lazy" decoding="async" fetchpriority="low" />
         </span>`
      : `<span class="home-news__image home-news__image--empty" aria-hidden="true"></span>`;
    return `<li class="home-news__item">
        <a href="${url}" target="_blank" rel="noopener">
          ${media}
          <span class="home-news__body">
            ${date ? `<time class="home-news__date">${date}</time>` : ""}
            <span class="home-news__title">${title}</span>
          </span>
        </a>
      </li>`;
  };

  const renderItems = (items) => {
    // Set se duplicira radi besšavne (beskonačne) petlje carousela.
    const html = items.map(cardHtml).join("");
    track.innerHTML = html + html;
  };

  // ---- auto-scroll carousel ----
  const SPEED = 55; // piksela u sekundi
  let rafId = null;
  let lastTs = 0;
  let pos = 0;
  let paused = false;
  let half = 0; // širina jednog (nedupliciranog) seta; mjerimo izvan rAF petlje

  // Mjerenje layouta (scrollWidth) je skupo - radimo ga samo pri učitavanju
  // i resizeu, ne svaki frame, da animacija ne šteka.
  const measure = () => {
    half = track.scrollWidth / 2;
  };

  const frame = (ts) => {
    if (lastTs === 0) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    if (!paused && half > 0) {
      pos += SPEED * dt;
      if (pos >= half) pos -= half; // besšavni preskok na identičan sadržaj
      track.scrollLeft = pos;
    }

    rafId = window.requestAnimationFrame(frame);
  };

  const startAuto = () => {
    if (reduceMotion || rafId !== null) return;
    lastTs = 0;
    rafId = window.requestAnimationFrame(frame);
  };

  const stopAuto = () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const pause = () => {
    paused = true;
  };
  const resume = () => {
    // Sinkroniziraj poziciju jednom (ne svaki frame) ako je korisnik scrollao.
    pos = track.scrollLeft;
    lastTs = 0;
    paused = false;
  };

  const nudge = (direction) => {
    const amount = Math.max(track.clientWidth * 0.8, 300);
    track.scrollBy({ left: direction * amount, behavior: "smooth" });
  };

  if (prevButton) prevButton.addEventListener("click", () => nudge(-1));
  if (nextButton) nextButton.addEventListener("click", () => nudge(1));

  // Pauza dok korisnik prelazi mišem ili koristi tipkovnicu / dodir.
  section.addEventListener("mouseenter", pause);
  section.addEventListener("mouseleave", resume);
  section.addEventListener("focusin", pause);
  section.addEventListener("focusout", resume);
  track.addEventListener("touchstart", pause, { passive: true });
  track.addEventListener("touchend", resume, { passive: true });

  // Ne troši CPU kad kartica nije vidljiva.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAuto();
    else startAuto();
  });

  window.addEventListener("resize", () => {
    const prevHalf = half;
    measure();
    if (prevHalf > 0 && half > 0) {
      pos = (pos / prevHalf) * half; // zadrži relativnu poziciju
    }
  });

  fetch("/api/news", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const items = data && Array.isArray(data.items) ? data.items : [];
      if (!items.length) return; // bez vijesti sekcija ostaje skrivena
      renderItems(items);
      section.hidden = false;
      // Strelice su pomoćne; primarno se carousel pomiče sam.
      if (prevButton) prevButton.hidden = false;
      if (nextButton) nextButton.hidden = false;
      requestAnimationFrame(() => {
        measure();
        startAuto();
      });
    })
    .catch(() => {
      /* tiho preskoči ako srednja.hr nije dostupna */
    });
})();
