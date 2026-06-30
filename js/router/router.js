let isPageLoading = false;
let currentPage = null;

window.loadPage = async (page) => {
  // 🔒 Prevent double / rapid clicks
  if (isPageLoading || page === currentPage) return;
  isPageLoading = true;
  window.currentPage = page;

  if (window.setActiveSidebar) {
  window.setActiveSidebar(page);
}


  // 🧹 Remove old CSS
  const oldCSS = document.getElementById("page-style");
  if (oldCSS) oldCSS.remove();

  // 🧹 Remove old JS
  const oldJS = document.getElementById("page-script");
  if (oldJS) oldJS.remove();

  try {
    // 📦 Load HTML
    const res = await fetch(`pages/${page}.html`, { cache: "no-store" });
    const html = await res.text();
    mainContent.innerHTML = html;

    // 🎨 Load CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `css/${page}.css?v=${Date.now()}`;
    link.id = "page-style";
    document.head.appendChild(link);

    // ⚙ Load JS (cache-busted + forced re-execution)
    const script = document.createElement("script");
    script.type = "module";
    script.src = `js/pages/${page}.js?v=${Date.now()}`;
    script.id = "page-script";

    // 🔓 Unlock after script loads
    script.onload = () => {
      isPageLoading = false;
    };

    script.onerror = () => {
      console.error("Failed to load JS for", page);
      isPageLoading = false;
    };

    document.body.appendChild(script);

    // 🌐 Update URL
    history.pushState({ page }, "", "#" + page);

  } catch (err) {
    console.error("Page load error:", err);
    isPageLoading = false;
  }
};

// 🚀 Initial load
window.onload = () => {
  loadPage(location.hash.replace("#", "") || "home");
};

// 🔙 Browser back / forward
window.onpopstate = () => {
  loadPage(location.hash.replace("#", "") || "home");
};
