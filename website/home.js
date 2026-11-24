(() => {
  // Keep invitation links created before the public homepage was introduced working.
  if (new URLSearchParams(window.location.search).has("invite")) {
    window.location.replace("/console/" + window.location.search + window.location.hash);
    return;
  }
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#primary-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      nav.classList.toggle("open", !expanded);
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }));
  }
  const year = document.querySelector("#current-year");
  if (year) year.textContent = String(new Date().getFullYear());
})();