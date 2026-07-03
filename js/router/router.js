let isPageLoading = false;
let currentPage = null;

window.loadPage = async (page, addToHistory = true) => {
    // Prevent double clicks and duplicate page loads
    if (isPageLoading || page === currentPage) {
        return;
    }

    isPageLoading = true;

    try {
        const mainContent = document.getElementById("mainContent");

        if (!mainContent) {
            throw new Error("mainContent element not found");
        }

        // Sidebar active state
        if (window.setActiveSidebar) {
            window.setActiveSidebar(page);
        }

        // Remove previous JS
        const oldJS = document.getElementById("page-script");
        if (oldJS) {
            oldJS.remove();
        }

        // Save old CSS (don't remove yet)
        const oldCSS = document.getElementById("page-style");

        // Load HTML
        const res = await fetch(`pages/${page}.html`, {
            cache: "no-store"
        });

        if (!res.ok) {
            throw new Error(`Failed to load page: ${page}`);
        }

        const html = await res.text();

        // Create new CSS
        const newCSS = document.createElement("link");
        newCSS.rel = "stylesheet";
        newCSS.href = `css/pages/${page}.css?v=${Date.now()}`;
        newCSS.id = "page-style-new";

        // Wait for CSS to load
        await new Promise((resolve) => {
            newCSS.onload = resolve;
            newCSS.onerror = () => {
                console.warn(`CSS not found for ${page}`);
                resolve();
            };

            document.head.appendChild(newCSS);
        });

        // Remove old CSS only after new CSS loaded
        if (oldCSS) {
            oldCSS.remove();
        }

        newCSS.id = "page-style";

        // Insert HTML
        mainContent.innerHTML = html;

        // Update current page
        currentPage = page;
        window.currentPage = page;

        // Load page JS
        const script = document.createElement("script");
        script.type = "module";
        script.src = `js/pages/${page}.js?v=${Date.now()}`;
        script.id = "page-script";

        script.onload = () => {
            isPageLoading = false;
        };

        script.onerror = () => {
            console.error(`Failed to load JS: ${page}`);
            isPageLoading = false;
        };

        document.body.appendChild(script);

        // Update browser history
        if (addToHistory) {
            const currentHash = location.hash.replace("#", "");

            if (currentHash !== page) {
                history.pushState(
                    { page: page },
                    "",
                    "#" + page
                );
            }
        }

        // Safety unlock
        setTimeout(() => {
            isPageLoading = false;
        }, 2000);

    } catch (err) {
        console.error("Page load error:", err);
        isPageLoading = false;
    }
};

// Initial load
window.addEventListener("load", () => {
    const page = location.hash.replace("#", "") || "home";
    loadPage(page, false);
});

// Browser back/forward
window.addEventListener("popstate", () => {
    const page = location.hash.replace("#", "") || "home";
    loadPage(page, false);
});

