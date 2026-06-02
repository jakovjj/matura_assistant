(() => {
  const siteHeaderRoot = document.querySelector("[data-site-header]");

  if (!siteHeaderRoot) return;

  const activePage = siteHeaderRoot.dataset.activePage || "";
  const navItems = [
    {
      id: "home",
      href: "./",
      label: "početna",
    },
  ];
  const hasActiveNavItem = navItems.some((item) => item.id === activePage);
  const navClass = hasActiveNavItem ? "main-nav" : "main-nav main-nav--no-active";

  siteHeaderRoot.outerHTML = `
    <header class="site-header">
      <div class="topbar">
        <div class="container topbar__inner">
          <span>Neslužbeni projekt za pripremu mature</span>
          <div class="topbar__actions">
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

      <div class="container masthead">
        <a class="brand" href="./" aria-label="Asistent za maturu naslovnica">
          <img
            class="brand__mark"
            src="./assets/asistent_za_maturu.webp"
            alt=""
            width="56"
            height="56"
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
                return `
                  <a
                    class="main-nav__link${isActive ? " main-nav__link--active" : ""}"
                    href="${item.href}"
                    ${isActive ? 'aria-current="page"' : ""}
                  >
                    ${item.label}
                  </a>
                `;
              })
              .join("")}
          </nav>
        </div>
      </div>
    </header>
  `;
})();
