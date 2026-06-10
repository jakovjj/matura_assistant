// Asistent za maturu: objašnjenja rješenja za zadatke višestrukoga izbora.
// Predmeti koji su službeno dostupni pozivaju renderButton()/bind() s
// { official: true }; ostali se prikazuju samo kad URL ima ?beta=1. Solver
// poziva renderButton() uz svaki zadatak i bind() da poveže gumbe s kontekstom
// (slika, odgovori).
(() => {
  const LOGO_SRC = "./assets/asistent_za_maturu.webp";
  const ENDPOINT = "/api/ai-explanation";
  const REPORT_ENDPOINT = "/api/ai-explanation/report";
  const MAX_IMAGE_EDGE = 1600;

  const betaEnabled = new URLSearchParams(window.location.search).get("beta") === "1";

  // Asistent je vidljiv ako je predmet službeno objavljen (official) ili je
  // uključen beta način preko ?beta=1.
  function isAvailable(options) {
    return betaEnabled || (options && options.official === true);
  }

  const KATEX_VERSION = "0.16.11";

  let authPromise = null;
  let katexPromise = null;
  let drawer = null;
  let activeController = null;
  let currentContext = null;
  let reported = false;

  // KaTeX se vendora lokalno i učitava lijeno tek kad se prvi put otvori
  // asistent, da ne opterećuje učitavanje samoga rješavača. Ako učitavanje
  // padne, render se vraća na čisti tekst (formule ostaju čitljive kao izvor).
  function ensureKatex() {
    if (katexPromise) return katexPromise;
    katexPromise = new Promise((resolve) => {
      if (window.katex) {
        resolve(window.katex);
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `./vendor/katex/katex.min.css?v=${KATEX_VERSION}`;
      document.head.append(link);

      const script = document.createElement("script");
      script.src = `./vendor/katex/katex.min.js?v=${KATEX_VERSION}`;
      script.onload = () => resolve(window.katex || null);
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
    return katexPromise;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function currentReturnPath() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function fetchAuth() {
    if (!authPromise) {
      authPromise = fetch("/api/auth/me", { credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : { authenticated: false }))
        .then((data) => (data && data.authenticated ? data.user : null))
        .catch(() => null);
    }
    return authPromise;
  }

  // Učeniku se objašnjenje otključava tek nakon prijave.
  function showLoginModal() {
    const existing = document.querySelector(".ai-login-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.className = "ai-login-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Prijava za objašnjenje rješenja");
    const loginHref = `./prijava.html?next=${encodeURIComponent(currentReturnPath())}`;
    modal.innerHTML = `
      <div class="ai-login-modal__backdrop" data-ai-login-close></div>
      <div class="ai-login-modal__panel">
        <button class="ai-login-modal__close" type="button" data-ai-login-close aria-label="Zatvori">&times;</button>
        <img class="ai-login-modal__logo" src="${LOGO_SRC}" alt="" width="56" height="56" />
        <h2>Prijavi se za objašnjenje</h2>
        <p>
          Objašnjenja Asistenta za maturu dostupna su samo prijavljenim korisnicima.
        </p>
        <a class="primary-button ai-login-modal__action" href="${escapeHtml(loginHref)}">Prijavi se</a>
      </div>
    `;
    modal.querySelectorAll("[data-ai-login-close]").forEach((element) => {
      element.addEventListener("click", () => modal.remove());
    });
    document.addEventListener(
      "keydown",
      function onEscape(event) {
        if (event.key === "Escape") {
          modal.remove();
          document.removeEventListener("keydown", onEscape);
        }
      },
    );
    document.body.append(modal);
    modal.querySelector(".ai-login-modal__action")?.focus();
  }

  function ensureDrawer() {
    if (drawer) return drawer;

    const element = document.createElement("div");
    element.className = "ai-drawer";
    element.hidden = true;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "false");
    element.setAttribute("aria-label", "Objašnjenje rješenja");
    element.innerHTML = `
      <div class="ai-drawer__inner">
        <header class="ai-drawer__header">
          <div class="ai-drawer__brand">
            <img class="ai-drawer__logo" src="${LOGO_SRC}" alt="" width="40" height="40" />
            <div class="ai-drawer__heading">
              <strong>Asistent za maturu</strong>
              <span class="ai-drawer__subtitle" data-ai-subtitle></span>
            </div>
          </div>
          <button class="ai-drawer__close" type="button" data-ai-close aria-label="Zatvori objašnjenje">&times;</button>
        </header>
        <div class="ai-drawer__body" data-ai-body></div>
        <footer class="ai-drawer__footer">
          <button class="ai-drawer__report" type="button" data-ai-report>
            ${window.renderLucideIcon ? window.renderLucideIcon("triangle-alert", "ai-drawer__report-icon") : ""}
            <span>Prijavi loše objašnjenje</span>
          </button>
          <span class="ai-drawer__report-status" data-ai-report-status></span>
          <p class="ai-drawer__disclaimer">
            Objašnjenje je generirano koristeći umjetnu inteligenciju te može sadržavati greške.
          </p>
        </footer>
      </div>
    `;

    element.querySelector("[data-ai-close]").addEventListener("click", closeDrawer);
    element.querySelector("[data-ai-report]").addEventListener("click", reportCurrentExplanation);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !element.hidden) closeDrawer();
    });

    document.body.append(element);
    drawer = element;
    return drawer;
  }

  function openDrawer(context) {
    const element = ensureDrawer();
    ensureKatex();
    currentContext = context;
    reported = false;

    element.querySelector("[data-ai-subtitle]").textContent =
      `${context.subject} · zadatak ${context.question}`;
    element.querySelector("[data-ai-body]").innerHTML = thinkingHtml();
    element.querySelector("[data-ai-report-status]").textContent = "";
    const reportButton = element.querySelector("[data-ai-report]");
    reportButton.disabled = false;

    element.hidden = false;
    document.body.classList.add("ai-drawer-open");
    element.querySelector("[data-ai-close]")?.focus();
  }

  function closeDrawer() {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
    if (!drawer) return;
    drawer.hidden = true;
    document.body.classList.remove("ai-drawer-open");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function thinkingHtml() {
    return `<div class="ai-thinking" role="status" aria-label="Asistent razmišlja"><span></span><span></span><span></span></div>`;
  }

  function setBodyHtml(html) {
    const body = drawer?.querySelector("[data-ai-body]");
    if (body) body.innerHTML = html;
  }

  function setBodyMessage(message, tone = "") {
    const body = drawer?.querySelector("[data-ai-body]");
    if (!body) return;
    body.innerHTML = `<p class="ai-drawer__message${tone ? ` ai-drawer__message--${tone}` : ""}">${escapeHtml(message)}</p>`;
  }

  // Klasa boje za podebljanu oznaku na početku retka: točno -> zeleno, netočno
  // ili oznaka slova (npr. "A:") -> crveno.
  function boldClass(inner) {
    const value = inner.trim();
    if (/^neto[čc]no/i.test(value)) return "ai-wrong";
    if (/^to[čc]no/i.test(value)) return "ai-correct";
    if (/^[A-D]\s*[:.)]/.test(value)) return "ai-wrong";
    return "";
  }

  // Obični (ne-matematički) odsječak: escape + **podebljano** + prijelomi.
  function renderTextSegment(segment) {
    return escapeHtml(segment)
      .replace(/\*\*([^*]+)\*\*/g, (match, inner) => {
        const cls = boldClass(inner);
        return `<strong${cls ? ` class="${cls}"` : ""}>${inner}</strong>`;
      })
      .replace(/\n/g, "<br>");
  }

  // Redoslijed je bitan: dulji graničnici ($$, \[ , \]) moraju biti ispred
  // kraćih ($) da se kod jednake pozicije odabere blokovska formula.
  const MATH_DELIMITERS = [
    { open: "$$", close: "$$", display: true },
    { open: "\\[", close: "\\]", display: true },
    { open: "\\(", close: "\\)", display: false },
    { open: "$", close: "$", display: false },
  ];

  function renderMath(tex, displayMode) {
    if (!window.katex) return null;
    try {
      return window.katex.renderToString(tex.trim(), {
        displayMode,
        throwOnError: false,
      });
    } catch {
      return null;
    }
  }

  // Tekst se dijeli na matematičke ($...$, $$...$$, \(...\), \[...\]) i obične
  // odsječke. Nezatvoren graničnik (tijekom streaminga) prikazuje se kao tekst
  // dok ne stigne zatvarač, pa se tada prerenderira kao formula.
  function renderExplanationHtml(text) {
    let out = "";
    let index = 0;
    while (index < text.length) {
      let match = null;
      for (const delimiter of MATH_DELIMITERS) {
        const start = text.indexOf(delimiter.open, index);
        if (start !== -1 && (match === null || start < match.start)) {
          match = { start, delimiter };
        }
      }

      if (!match) {
        out += renderTextSegment(text.slice(index));
        break;
      }

      out += renderTextSegment(text.slice(index, match.start));

      const contentStart = match.start + match.delimiter.open.length;
      const closeIndex = text.indexOf(match.delimiter.close, contentStart);
      if (closeIndex === -1) {
        out += renderTextSegment(text.slice(match.start));
        break;
      }

      // Ako se prije zatvarača pojavi novi isti otvarač (npr. \( ... \( ),
      // ovaj je graničnik neuravnotežen — model je vjerojatno zaboravio
      // zatvoriti. Prikaži otvarač kao tekst i nastavi skeniranje, da jedna
      // pokvarena formula ne proguta i ispravne koje slijede u istom retku.
      const open = match.delimiter.open;
      const close = match.delimiter.close;
      if (open !== close) {
        const nextOpen = text.indexOf(open, contentStart);
        if (nextOpen !== -1 && nextOpen < closeIndex) {
          out += renderTextSegment(text.slice(match.start, contentStart));
          index = contentStart;
          continue;
        }
      }

      const tex = text.slice(contentStart, closeIndex);
      const rendered = renderMath(tex, match.delimiter.display);
      out +=
        rendered != null
          ? rendered
          : renderTextSegment(
              text.slice(match.start, closeIndex + match.delimiter.close.length),
            );
      index = closeIndex + match.delimiter.close.length;
    }
    return out;
  }

  function showRemaining(remaining, unlimited) {
    const subtitle = drawer?.querySelector("[data-ai-subtitle]");
    if (!subtitle || !currentContext) return;
    const base = `${currentContext.subject} · zadatak ${currentContext.question}`;
    if (unlimited) {
      subtitle.textContent = `${base} · neograničeno`;
    } else if (Number.isFinite(remaining)) {
      subtitle.textContent = `${base} · još ${remaining} besplatnih`;
    } else {
      subtitle.textContent = base;
    }
  }

  // Iz deskriptora izvora (url + crop) napravi data URL samo onoga dijela
  // knjižice koji prikazuje zadatak, da OpenAI dobije OCR baš tog zadatka.
  function cropToDataUrl(source) {
    return new Promise((resolve, reject) => {
      if (!source || !source.url) {
        reject(new Error("Nema slike zadatka."));
        return;
      }

      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          const crop = source.crop;
          const hasCrop =
            crop &&
            [crop.x, crop.y, crop.width, crop.height].every((value) => Number.isFinite(Number(value))) &&
            Number(crop.width) > 0 &&
            Number(crop.height) > 0;

          const sx = hasCrop ? Number(crop.x) : 0;
          const sy = hasCrop ? Number(crop.y) : 0;
          const sw = hasCrop ? Number(crop.width) : image.naturalWidth;
          const sh = hasCrop ? Number(crop.height) : image.naturalHeight;

          const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sw, sh));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sw * scale));
          canvas.height = Math.max(1, Math.round(sh * scale));
          const context = canvas.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error("Slika zadatka se nije učitala."));
      image.src = source.url;
    });
  }

  async function explain(context) {
    openDrawer(context);

    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;

    let imageDataUrl = "";
    try {
      imageDataUrl = await cropToDataUrl(context.sourceImage);
    } catch {
      // Slika nije obavezna ako objašnjenje već postoji u spremištu; server odlučuje.
      imageDataUrl = "";
    }
    if (controller.signal.aborted) return;

    // Polazni tekst (ako postoji) šaljemo kao dodatne slike za bolje razumijevanje.
    const contextImages = [];
    for (const source of (context.contextImages || []).slice(0, 3)) {
      try {
        contextImages.push({ dataUrl: await cropToDataUrl(source) });
      } catch {
        // Preskoči kontekstnu sliku koja se ne može izrezati.
      }
      if (controller.signal.aborted) return;
    }

    // Otvoreni (produženi odgovor) zadatci nemaju ABCD odgovor, nego sliku
    // službenoga rješenja koju model objašnjava korak po korak.
    let solutionImage = null;
    if (context.solutionImage) {
      try {
        solutionImage = { dataUrl: await cropToDataUrl(context.solutionImage) };
      } catch {
        solutionImage = null;
      }
      if (controller.signal.aborted) return;
    }

    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          subject: context.subject,
          solver: context.solver,
          examId: context.examId,
          question: context.question,
          kind: context.kind === "open" ? "open" : "choice",
          correctAnswer: context.correctAnswer,
          image: imageDataUrl ? { dataUrl: imageDataUrl } : null,
          contextImages,
          solutionImage,
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setBodyMessage("Nije moguće dohvatiti objašnjenje. Provjeri vezu i pokušaj ponovno.", "error");
      return;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        closeDrawer();
        showLoginModal();
      } else if (response.status === 403) {
        setBodyMessage(
          data.error || "Potrošio si sva besplatna objašnjenja.",
          "error",
        );
        drawer.querySelector("[data-ai-report]").disabled = true;
      } else {
        setBodyMessage(data.error || "Objašnjenje trenutačno nije dostupno.", "error");
        drawer.querySelector("[data-ai-report]").disabled = true;
      }
      return;
    }

    await readExplanationStream(response, controller);
  }

  async function readExplanationStream(response, controller) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let revealed = false;
    let errored = false;

    // Tri točkice (razmišljanje) drže se barem 1.5 s prije prikaza teksta, a
    // KaTeX mora biti učitan da se formule odmah prikažu ispravno renderirane.
    // Točkice ostaju i nakon toga sve dok ne stigne prvi tekst — inače bi tijelo
    // na par sekundi ostalo prazno dok model još razmišlja (npr. reasoning model).
    const renderIfReady = () => {
      if (errored || controller.signal.aborted) return;
      if (!revealed || !text) return;
      setBodyHtml(renderExplanationHtml(text));
    };

    const ready = Promise.all([sleep(1500), ensureKatex()]);
    ready.then(() => {
      revealed = true;
      renderIfReady();
    });

    const handleEvent = (event) => {
      if (event.type === "meta") {
        showRemaining(event.remaining, event.unlimited);
      } else if (event.type === "delta") {
        text += event.text || "";
        renderIfReady();
      } else if (event.type === "done") {
        if (Object.prototype.hasOwnProperty.call(event, "remaining")) {
          showRemaining(event.remaining, event.unlimited);
        }
      } else if (event.type === "error") {
        errored = true;
        setBodyMessage(event.error || "Objašnjenje nije uspjelo.", "error");
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line));
          } catch {
            // Preskoči nepotpunu liniju.
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      errored = true;
      if (!text) setBodyMessage("Objašnjenje je prekinuto. Pokušaj ponovno.", "error");
    }

    await ready;
    if (controller.signal.aborted || errored) return;
    if (text) setBodyHtml(renderExplanationHtml(text));
    else setBodyMessage("Objašnjenje nije stiglo. Pokušaj ponovno.", "error");
  }

  async function reportCurrentExplanation() {
    if (!currentContext || reported) return;
    const reason = window.prompt("Što nije u redu s objašnjenjem? (nije obavezno)", "");
    if (reason === null) return;

    const explanationText = drawer?.querySelector("[data-ai-body]")?.textContent || "";
    const statusElement = drawer?.querySelector("[data-ai-report-status]");
    const reportButton = drawer?.querySelector("[data-ai-report]");
    if (reportButton) reportButton.disabled = true;

    try {
      const response = await fetch(REPORT_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: currentContext.subject,
          solver: currentContext.solver,
          examId: currentContext.examId,
          question: currentContext.question,
          correctAnswer: currentContext.correctAnswer,
          reason,
          explanation: explanationText,
        }),
      });
      if (!response.ok) throw new Error("report failed");
      reported = true;
      if (statusElement) statusElement.textContent = "Hvala na prijavi.";
    } catch {
      if (reportButton) reportButton.disabled = false;
      if (statusElement) statusElement.textContent = "Prijava nije uspjela.";
    }
  }

  async function handleButtonClick(context) {
    const user = await fetchAuth();
    if (!user) {
      showLoginModal();
      return;
    }
    explain(context);
  }

  window.AsistentAI = {
    enabled(options) {
      return isAvailable(options);
    },
    renderButton(question, options) {
      if (!isAvailable(options)) return "";
      return `
        <button
          class="ai-explain-button"
          type="button"
          data-ai-explain="${escapeHtml(question)}"
          aria-label="Objašnjenje rješenja zadatka ${escapeHtml(question)}"
          title="Objašnjenje rješenja (Asistent za maturu)"
        >
          <img class="ai-explain-button__logo" src="${LOGO_SRC}" alt="" width="22" height="22" />
        </button>
      `;
    },
    bind(root, getContext, options) {
      if (!isAvailable(options) || !root || typeof getContext !== "function") return;
      root.querySelectorAll("[data-ai-explain]").forEach((button) => {
        button.addEventListener("click", () => {
          const context = getContext(button.dataset.aiExplain);
          if (context) handleButtonClick(context);
        });
      });
    },
  };
})();
