(() => {
  const siteHeaderRoot = document.querySelector("[data-site-header]");

  if (!siteHeaderRoot) return;

  const noticeConfigPaths = ["./site-notice.txt", "./data/site-notice.txt"];

  // Variants control the banner colour and default icon.
  const ANNOUNCEMENT_VARIANTS = ["announcement", "info", "blue", "svijetloplava"];

  const parseTimestamp = (value) => {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  };

  const parseNoticeConfig = (source) => {
    const config = {};

    source.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      const separatorIndex = line.indexOf("=");

      if (!line || line.startsWith("#") || separatorIndex === -1) return;

      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();

      if (key) config[key] = value;
    });

    const enabled = ["true", "1", "yes", "da"].includes(
      String(config.enabled || "").toLowerCase(),
    );

    return {
      enabled,
      variant: String(config.variant || "").toLowerCase(),
      icon: String(config.icon || "").toLowerCase(),
      message: config.message || "",
      starts: parseTimestamp(config.starts),
      until: parseTimestamp(config.until),
    };
  };

  const createNoticeIcon = (iconName) => {
    const icon = document.createElement("span");
    icon.className = "site-notice__icon";
    icon.setAttribute("aria-hidden", "true");

    if (typeof window.renderLucideIcon === "function") {
      icon.innerHTML = window.renderLucideIcon(iconName || "wrench", "site-notice__icon-svg");
      return icon;
    }

    icon.innerHTML = `
      <svg class="site-notice__icon-svg" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />
      </svg>
    `;
    return icon;
  };

  const fetchNoticeSource = async (configUrl) => {
    if (typeof window.fetch === "function") {
      const response = await fetch(configUrl, { cache: "no-store" });
      return response.ok ? response.text() : "";
    }

    return new Promise((resolve) => {
      const request = new XMLHttpRequest();
      request.open("GET", configUrl.toString(), true);
      request.onreadystatechange = () => {
        if (request.readyState !== XMLHttpRequest.DONE) return;
        resolve(request.status >= 200 && request.status < 300 ? request.responseText : "");
      };
      request.send();
    });
  };

  const renderNotice = async () => {
    const noticeRoot = document.querySelector("[data-site-notice]");

    if (!noticeRoot) return;

    try {
      let configSource = "";

      for (const noticeConfigPath of noticeConfigPaths) {
        const configUrl = new URL(noticeConfigPath, document.baseURI);
        configUrl.searchParams.set("v", Date.now().toString());
        configSource = await fetchNoticeSource(configUrl);

        if (configSource) break;
      }

      const notice = parseNoticeConfig(configSource);

      if (!notice.enabled || !notice.message) return;

      // Optional scheduling window (timestamps include their own offset).
      const now = Date.now();
      if (notice.starts && now < notice.starts) return;
      if (notice.until && now >= notice.until) return;

      const isAnnouncement = ANNOUNCEMENT_VARIANTS.includes(notice.variant);
      const iconName = notice.icon || (isAnnouncement ? "star" : "wrench");

      const inner = document.createElement("div");
      inner.className = "container site-notice__inner";

      const message = document.createElement("p");
      message.className = "site-notice__message";
      message.textContent = notice.message;

      inner.append(createNoticeIcon(iconName));
      inner.append(message);
      noticeRoot.classList.toggle("site-notice--announcement", isAnnouncement);
      noticeRoot.textContent = "";
      noticeRoot.appendChild(inner);
      noticeRoot.hidden = false;
      noticeRoot.removeAttribute("hidden");
    } catch {
      // Missing or temporarily unavailable notice config should not block the page.
    }
  };

  const activePage = siteHeaderRoot.dataset.activePage || "";
  const navItems = [
    {
      id: "home",
      href: "./",
      label: "početna",
    },
    {
      id: "profile",
      href: "./profil.html",
      label: "profil",
      // Shown only when the link collapses on mobile (see styles.css main-nav__icon).
      icon: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
        </svg>
      `,
    },
  ];
  const hasActiveNavItem = navItems.some((item) => item.id === activePage);
  const navClass = hasActiveNavItem ? "main-nav" : "main-nav main-nav--no-active";

  siteHeaderRoot.outerHTML = `
    <header class="site-header">
      <div class="topbar">
        <div class="container topbar__inner">
          <span class="topbar__label">
            matura.com.hr
          </span>
          <div class="topbar__actions">
            <button
              type="button"
              class="topbar__theme-toggle"
              data-site-theme-toggle
              aria-label="Uključi tamni prikaz"
              aria-pressed="false"
              title="Uključi tamni prikaz"
            >
              <svg class="topbar__theme-icon topbar__theme-icon--moon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
              <svg class="topbar__theme-icon topbar__theme-icon--sun" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </svg>
            </button>
            <a href="https://www.ncvvo.hr/" target="_blank" rel="noreferrer">
              ncvvo.hr
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M6 3h7v7M13 3 5 11M3 6v7h7" />
              </svg>
            </a>
            <div class="auth-widget" data-auth-widget></div>
          </div>
        </div>
      </div>

      <div class="site-notice" data-site-notice role="status" aria-live="polite" hidden></div>

      <div class="container masthead">
        <a class="brand" href="./" aria-label="Asistent za maturu naslovnica">
          <img
            class="brand__mark"
            src="./assets/asistent_za_maturu.webp"
            alt=""
            width="56"
            height="56"
            draggable="false"
            decoding="async"
          />
          <span>
            <strong>Asistent za maturu</strong>
            <small>vježba za državnu maturu</small>
          </span>
        </a>

        <div class="masthead__actions">
          <nav class="${navClass}" aria-label="Glavna navigacija">
            ${navItems
              .map((item) => {
                const isActive = item.id === activePage;
                const linkClass = [
                  "main-nav__link",
                  item.icon ? "main-nav__link--icon" : "",
                  isActive ? "main-nav__link--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const iconMarkup = item.icon
                  ? `<span class="main-nav__icon" aria-hidden="true">${item.icon}</span>`
                  : "";
                return `
                  <a
                    class="${linkClass}"
                    href="${item.href}"
                    ${isActive ? 'aria-current="page"' : ""}
                  >
                    ${iconMarkup}<span class="main-nav__label">${item.label}</span>
                  </a>
                `;
              })
              .join("")}
          </nav>
        </div>
      </div>
    </header>
  `;

  const wireThemeToggle = () => {
    const toggle = document.querySelector("[data-site-theme-toggle]");
    if (!toggle) return;

    const syncState = () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const label = isDark ? "Uključi svijetli prikaz" : "Uključi tamni prikaz";
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
      toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
    };

    syncState();

    toggle.addEventListener("click", () => {
      const theme = window.AsistentTheme;
      const current = theme
        ? theme.get()
        : document.documentElement.getAttribute("data-theme") === "dark"
          ? "dark"
          : "light";
      const next = current === "dark" ? "light" : "dark";

      if (theme) {
        theme.set(next);
      } else if (next === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }

      syncState();
    });
  };

  wireThemeToggle();
  renderNotice();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderNotice, { once: true });
  }
})();
