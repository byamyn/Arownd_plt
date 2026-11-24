(() => {
  "use strict";
  const config = window.AROWND_TEAM_CONFIG || {};
  const api = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const key = config.supabasePublishableKey || "";
  const $ = (selector) => document.querySelector(selector);
  const state = $("#profile-state");
  const content = $("#profile-content");
  const usernameFromUrl = () => {
    const queryName = new URLSearchParams(location.search).get("username");
    if (queryName) return queryName;
    const match = location.pathname.match(/^\/@([a-z0-9]+(?:[._-][a-z0-9]+)*)\/?$/i);
    return match ? match[1] : "";
  };
  const showState = (message) => {
    state.replaceChildren();
    const p = document.createElement("p");
    p.textContent = message;
    state.append(p);
    state.classList.remove("hidden");
    content.classList.add("hidden");
  };
  async function loadProfile() {
    $("#year").textContent = String(new Date().getFullYear());
    const username = usernameFromUrl().trim().toLowerCase();
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(username) || username.length < 3 || username.length > 30) {
      showState("رابط الملف الشخصي غير صالح أو غير متاح.");
      return;
    }
    if (!api || !key) {
      showState("تعذر تحميل الملف الشخصي حالياً.");
      return;
    }
    try {
      const response = await fetch(api + "/rest/v1/rpc/get_public_personal_profile", {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ _username: username })
      });
      if (!response.ok) throw new Error("profile_unavailable");
      const rows = await response.json();
      const profile = Array.isArray(rows) ? rows[0] : null;
      if (!profile) {
        showState("هذا الملف الشخصي غير متاح للعامة.");
        return;
      }
      $("#profile-name").textContent = profile.full_name || profile.username;
      $("#profile-username").textContent = "@" + profile.username;
      if (profile.commune) {
        $("#profile-location").textContent = profile.commune;
        $("#profile-location").classList.remove("hidden");
      }
      const avatar = $("#profile-avatar");
      const fallback = $("#avatar-fallback");
      fallback.textContent = (profile.username || "A").slice(0, 1).toUpperCase();
      if (profile.avatar_url) {
        try {
          const parsed = new URL(profile.avatar_url);
          if (parsed.protocol === "https:") {
            avatar.addEventListener("load", () => {
              avatar.classList.remove("hidden");
              fallback.classList.add("hidden");
            }, { once: true });
            avatar.addEventListener("error", () => {
              avatar.classList.add("hidden");
              fallback.classList.remove("hidden");
            }, { once: true });
            avatar.src = parsed.href;
            avatar.alt = profile.username + " profile image";
          }
        } catch { /* Keep the neutral avatar fallback. */ }
      }
      document.title = "@" + profile.username + " — Arownd";
      $("#share-profile").addEventListener("click", async () => {
        const url = location.origin + "/@" + profile.username;
        if (navigator.share) {
          try {
            await navigator.share({ title: "@" + profile.username + " — Arownd", url });
          } catch (error) {
            if (error?.name !== "AbortError") await copyLink(url);
          }
        } else {
          await copyLink(url);
        }
      });
      state.classList.add("hidden");
      content.classList.remove("hidden");
    } catch {
      showState("تعذر تحميل الملف الشخصي حالياً. حاول مرة أخرى لاحقاً.");
    }
  }
  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      $("#share-profile").textContent = "تم نسخ الرابط";
      window.setTimeout(() => { $("#share-profile").textContent = "مشاركة الملف"; }, 1800);
    } catch {
      window.prompt("انسخ رابط الملف الشخصي:", url);
    }
  }
  loadProfile();
})();
