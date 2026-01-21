(() => {
  const PSC_LIBRARY_LINK =
    "https://www.publicsafety.gc.ca/cnt/rsrcs/lbrr/ctlg/index-en.aspx?l=7";
  const CHECKOUT_HINTS = [
    "checkout",
    "cart",
    "basket",
    "bag",
    "payment",
    "pay",
    "order",
    "place-order",
    "confirm",
  ];
  const HIGH_RISK_TERMS = [
    { term: "forced labor", weight: 3, reason: "Forced labor reference" },
    { term: "slave labor", weight: 3, reason: "Slave labor reference" },
    { term: "debt bondage", weight: 3, reason: "Debt bondage reference" },
    { term: "child labor", weight: 3, reason: "Child labor reference" },
    { term: "human trafficking", weight: 3, reason: "Trafficking reference" },
    { term: "xinjiang", weight: 3, reason: "High-risk region reference" },
    { term: "uyghur", weight: 3, reason: "High-risk region reference" },
  ];
  const MODERATE_RISK_TERMS = [
    { term: "sweatshop", weight: 1, reason: "Sweatshop reference" },
    { term: "supply chain", weight: 1, reason: "Supply chain mention" },
    { term: "conflict minerals", weight: 1, reason: "Conflict minerals" },
    { term: "cobalt", weight: 1, reason: "Cobalt sourcing" },
    { term: "palm oil", weight: 1, reason: "Palm oil sourcing" },
    { term: "fast fashion", weight: 1, reason: "Fast fashion indicator" },
  ];

  let lastUrl = location.href;
  let bannerEl = null;

  const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

  const isCheckoutUrl = (url) => {
    const normalized = normalize(url);
    return CHECKOUT_HINTS.some((hint) => normalized.includes(hint));
  };

  const getPageContextText = () => {
    const parts = [];
    if (document.title) {
      parts.push(document.title);
    }
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite?.content) {
      parts.push(ogSite.content);
    }
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle?.content) {
      parts.push(ogTitle.content);
    }
    const h1 = document.querySelector("h1");
    if (h1?.textContent) {
      parts.push(h1.textContent);
    }
    const description = document.querySelector('meta[name="description"]');
    if (description?.content) {
      parts.push(description.content);
    }

    const bodyText = document.body?.innerText || "";
    const truncatedBody = bodyText.slice(0, 20000);
    parts.push(truncatedBody);
    return normalize(parts.join(" "));
  };

  const evaluateRisk = (text) => {
    const matches = [];
    let score = 0;

    HIGH_RISK_TERMS.forEach((item) => {
      if (text.includes(item.term)) {
        matches.push({ level: "High", ...item });
        score += item.weight;
      }
    });

    MODERATE_RISK_TERMS.forEach((item) => {
      if (text.includes(item.term)) {
        matches.push({ level: "Moderate", ...item });
        score += item.weight;
      }
    });

    if (matches.some((match) => match.level === "High")) {
      return { level: "High Risk", matches };
    }

    if (score > 0) {
      return { level: "Moderate Risk", matches };
    }

    return { level: "Low Risk", matches };
  };

  const buildBanner = (risk) => {
    const container = document.createElement("div");
    container.id = "ethical-risk-banner";

    const heading = document.createElement("div");
    heading.className = "ethical-risk-heading";
    heading.textContent = "Ethical Sourcing Risk Check";

    const level = document.createElement("div");
    level.className = `ethical-risk-level ethical-risk-${risk.level
      .toLowerCase()
      .replace(/\s+/g, "-")}`;
    level.textContent = risk.level;

    const note = document.createElement("div");
    note.className = "ethical-risk-note";
    note.textContent =
      "This is a heuristic indicator for checkout pages, not a determination.";

    const matchList = document.createElement("ul");
    matchList.className = "ethical-risk-matches";

    if (risk.matches.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No risk indicators detected in visible page text.";
      matchList.appendChild(item);
    } else {
      risk.matches.slice(0, 5).forEach((match) => {
        const item = document.createElement("li");
        item.textContent = `${match.reason} (${match.term})`;
        matchList.appendChild(item);
      });
    }

    const link = document.createElement("a");
    link.href = PSC_LIBRARY_LINK;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "ethical-risk-link";
    link.textContent =
      "Check Public Safety Canada Library Catalogue reports";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ethical-risk-close";
    closeButton.textContent = "Hide";
    closeButton.addEventListener("click", () => {
      container.remove();
    });

    container.appendChild(heading);
    container.appendChild(level);
    container.appendChild(note);
    container.appendChild(matchList);
    container.appendChild(link);
    container.appendChild(closeButton);

    return container;
  };

  const updateBanner = () => {
    if (!isCheckoutUrl(location.href)) {
      if (bannerEl) {
        bannerEl.remove();
        bannerEl = null;
      }
      return;
    }

    const contextText = getPageContextText();
    const risk = evaluateRisk(contextText);

    if (!bannerEl) {
      bannerEl = buildBanner(risk);
      document.body.appendChild(bannerEl);
      return;
    }

    const level = bannerEl.querySelector(".ethical-risk-level");
    const matches = bannerEl.querySelector(".ethical-risk-matches");

    if (level) {
      level.className = `ethical-risk-level ethical-risk-${risk.level
        .toLowerCase()
        .replace(/\s+/g, "-")}`;
      level.textContent = risk.level;
    }

    if (matches) {
      matches.innerHTML = "";
      if (risk.matches.length === 0) {
        const item = document.createElement("li");
        item.textContent =
          "No risk indicators detected in visible page text.";
        matches.appendChild(item);
      } else {
        risk.matches.slice(0, 5).forEach((match) => {
          const item = document.createElement("li");
          item.textContent = `${match.reason} (${match.term})`;
          matches.appendChild(item);
        });
      }
    }
  };

  const monitorLocationChanges = () => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      updateBanner();
    }
  };

  updateBanner();
  setInterval(monitorLocationChanges, 1000);
})();
