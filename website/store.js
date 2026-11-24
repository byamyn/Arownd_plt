(() => {
  "use strict";
  const config = window.AROWND_TEAM_CONFIG || {};
  const api = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const key = config.supabasePublishableKey || "";
  const $ = (selector) => document.querySelector(selector);
  const state = $("#store-state");
  const content = $("#store-content");

  const showState = (message) => {
    state.replaceChildren();
    const p = document.createElement("p");
    p.textContent = message;
    state.append(p);
    state.classList.remove("hidden");
    content.classList.add("hidden");
  };
  const safeHttpsUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch { return ""; }
  };
  const setImage = (image, value, alt) => {
    const src = safeHttpsUrl(value);
    if (!src) return;
    image.addEventListener("load", () => image.classList.remove("hidden"), { once: true });
    image.addEventListener("error", () => image.classList.add("hidden"), { once: true });
    image.src = src;
    image.alt = alt || "";
  };
  const formatPrice = (value) => new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const slugFromUrl = () => {
    const querySlug = new URLSearchParams(location.search).get("slug");
    if (querySlug) return querySlug;
    const match = location.pathname.match(/^\\/store\\/([^/]+)\\/?$/i);
    return match ? decodeURIComponent(match[1]) : "";
  };
  const normalizePhone = (value) => String(value || "").replace(/[^+\d]/g, "");
  const appendSocial = (container, label, value) => {
    const href = safeHttpsUrl(value);
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    container.append(link);
    container.classList.remove("hidden");
  };

  function renderOffer(offer) {
    const card = document.createElement("article");
    card.className = "product-card";
    const imageWrap = document.createElement("div");
    imageWrap.className = "product-image-wrap";
    const fallback = document.createElement("span");
    fallback.className = "image-fallback";
    fallback.textContent = "A";
    imageWrap.append(fallback);
    const image = document.createElement("img");
    image.className = "product-image hidden";
    const primary = (offer.images || []).find((item) => item.is_primary) || (offer.images || [])[0];
    if (primary?.url) {
      image.addEventListener("load", () => fallback.classList.add("hidden"), { once: true });
      setImage(image, primary.url, offer.product?.name || "صورة المنتج");
      imageWrap.append(image);
    }
    const info = document.createElement("div");
    info.className = "product-info";
    if (offer.product?.brand) {
      const brand = document.createElement("p");
      brand.className = "product-brand";
      brand.textContent = offer.product.brand;
      info.append(brand);
    }
    const name = document.createElement("h3");
    name.className = "product-name";
    name.textContent = offer.product?.name || "منتج";
    info.append(name);
    if (offer.product?.description) {
      const description = document.createElement("p");
      description.className = "product-description";
      description.textContent = offer.product.description;
      info.append(description);
    }
    const priceRow = document.createElement("div");
    priceRow.className = "price-row";
    const price = document.createElement("span");
    price.className = "price";
    price.textContent = formatPrice(offer.price);
    priceRow.append(price);
    const currency = document.createElement("span");
    currency.className = "currency";
    currency.textContent = "دج";
    priceRow.append(currency);
    if (Number(offer.old_price) > Number(offer.price)) {
      const old = document.createElement("span");
      old.className = "old-price";
      old.textContent = formatPrice(offer.old_price);
      priceRow.append(old);
    }
    info.append(priceRow);
    card.append(imageWrap, info);
    return card;
  }

  async function loadStore() {
    $("#year").textContent = String(new Date().getFullYear());
    const slug = slugFromUrl().trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 80) {
      showState("رابط المتجر غير صالح أو غير متاح.");
      return;
    }
    if (!api || !key) {
      showState("تعذر تحميل المتجر حالياً.");
      return;
    }
    try {
      const response = await fetch(api + "/rest/v1/rpc/get_public_store_by_slug", {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ _slug: slug })
      });
      if (!response.ok) throw new Error("store_lookup_failed");
      const result = await response.json();
      if (!result?.store) {
        showState("هذا المتجر غير موجود أو غير متاح.");
        return;
      }
      const store = result.store;
      const offers = Array.isArray(result.offers) ? result.offers : [];
      $("#store-name").textContent = store.name || "متجر Arownd";
      $("#store-mark").textContent = (store.name || "A").slice(0, 1).toUpperCase();
      setImage($("#store-cover"), store.cover_url, "");
      setImage($("#store-logo"), store.logo_url, store.name || "شعار المتجر");
      if (store.is_verified) $("#verified").classList.remove("hidden");
      const locationText = [store.commune, store.address_line].filter(Boolean).join("، ");
      if (locationText) {
        $("#store-location").textContent = locationText;
        $("#store-location").classList.remove("hidden");
      }
      if (store.description) {
        $("#store-description").textContent = store.description;
        $("#store-description").classList.remove("hidden");
      }
      const phone = normalizePhone(store.phone);
      if (phone && /^\+?\d{8,15}$/.test(phone)) {
        $("#phone-link").href = "tel:" + phone;
        $("#phone-link").classList.remove("hidden");
      }
      const whatsapp = normalizePhone(store.whatsapp || store.phone).replace(/^\+/, "");
      if (whatsapp && /^\d{8,15}$/.test(whatsapp)) {
        $("#whatsapp-link").href = "https://wa.me/" + whatsapp;
        $("#whatsapp-link").classList.remove("hidden");
      }
      if (Number.isFinite(Number(store.latitude)) && Number.isFinite(Number(store.longitude)) && store.latitude !== null && store.longitude !== null) {
        $("#map-link").href = "https://www.google.com/maps?q=" + encodeURIComponent(store.latitude + "," + store.longitude);
        $("#map-link").classList.remove("hidden");
      }
      const hours = store.opening_hours || {};
      $("#hours").textContent = hours.open && hours.close ? "ساعات العمل: " + hours.open + " – " + hours.close : "ساعات العمل غير محددة";
      if (Number(store.rating) > 0) {
        $("#rating").textContent = "التقييم " + Number(store.rating).toFixed(1) + " / 5";
        $("#rating").classList.remove("hidden");
      }
      const website = safeHttpsUrl(store.website_url);
      if (website) {
        $("#website-link").href = website;
        $("#website-link").classList.remove("hidden");
      }
      $("#store-meta").classList.remove("hidden");
      const grid = $("#products-grid");
      offers.forEach((offer) => grid.append(renderOffer(offer)));
      $("#product-count").textContent = offers.length + " منتج";
      if (!offers.length) $("#empty-products").classList.remove("hidden");
      $("#share-store").addEventListener("click", async () => {
        const url = location.origin + "/store/" + store.slug;
        if (navigator.share) {
          try { await navigator.share({ title: store.name + " — Arownd", url }); }
          catch (error) { if (error?.name !== "AbortError") await copyLink(url); }
        } else {
          await copyLink(url);
        }
      });
      const socials = $("#social-links");
      appendSocial(socials, "Instagram", store.instagram_url);
      appendSocial(socials, "Facebook", store.facebook_url);
      appendSocial(socials, "TikTok", store.tiktok_url);
      document.title = store.name + " — Arownd";
      const description = (store.description || "تصفح منتجات متجر " + store.name + " وأسعاره على Arownd.").slice(0, 160);
      document.querySelector('meta[name="description"]').content = description;
      document.querySelector('meta[property="og:title"]').content = store.name + " — Arownd";
      document.querySelector('meta[property="og:description"]').content = description;
      state.classList.add("hidden");
      content.classList.remove("hidden");
    } catch {
      showState("تعذر تحميل المتجر حالياً. حاول مرة أخرى لاحقاً.");
    }
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      $("#share-store").textContent = "تم نسخ الرابط";
      window.setTimeout(() => { $("#share-store").textContent = "مشاركة المتجر"; }, 1800);
    } catch {
      window.prompt("انسخ رابط المتجر:", url);
    }
  }
  loadStore();
})();
