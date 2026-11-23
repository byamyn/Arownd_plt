(() => {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const menuButton = document.getElementById("mobile-menu");
  const closeButton = document.getElementById("sidebar-close");
  const breadcrumb = document.getElementById("breadcrumb-current");
  const panels = [...document.querySelectorAll(".view-panel")];
  const navItems = [...document.querySelectorAll("[data-view]")];
  const dateNode = document.getElementById("today-date");

  const openSidebar = () => {
    sidebar?.classList.add("open");
    backdrop?.classList.add("show");
    menuButton?.setAttribute("aria-expanded", "true");
  };
  const closeSidebar = () => {
    sidebar?.classList.remove("open");
    backdrop?.classList.remove("show");
    menuButton?.setAttribute("aria-expanded", "false");
  };

  function showView(name) {
    const panel = document.getElementById(`view-${name}`);
    if (!panel) return;
    panels.forEach((item) => item.classList.toggle("active", item === panel));
    document.querySelectorAll(".main-nav .nav-item").forEach((item) => {
      const active = item.dataset.view === name;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    breadcrumb.textContent = panel.dataset.title || "Arownd Team";
    document.title = `${panel.dataset.title || "Arownd Team"} — Arownd Team`;
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
    history.replaceState(null, "", `#${name}`);
  }

  navItems.forEach((item) => item.addEventListener("click", () => showView(item.dataset.view)));
  menuButton?.addEventListener("click", openSidebar);
  closeButton?.addEventListener("click", closeSidebar);
  backdrop?.addEventListener("click", closeSidebar);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      document.getElementById("global-search")?.focus();
    }
  });

  const search = document.getElementById("global-search");
  search?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const query = search.value.trim().toLocaleLowerCase("ar");
    if (!query) return;
    const match = [...document.querySelectorAll(".main-nav .nav-item")]
      .find((item) => item.textContent.trim().toLocaleLowerCase("ar").includes(query));
    if (match) {
      showView(match.dataset.view);
      search.value = "";
    }
  });

  if (dateNode) {
    dateNode.textContent = new Intl.DateTimeFormat("ar", {
      day: "numeric", month: "long", year: "numeric"
    }).format(new Date());
  }

  const initialView = location.hash.replace("#", "");
  if (initialView && document.getElementById(`view-${initialView}`)) showView(initialView);
})();