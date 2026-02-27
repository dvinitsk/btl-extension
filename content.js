(() => {
  const SUPABASE_FUNCTION_URL = BTL_CONFIG.SUPABASE_FUNCTION_URL;
  const SUPABASE_ANON_KEY = BTL_CONFIG.SUPABASE_ANON_KEY;

  const CHECKOUT_HINTS = [
    "checkout", "cart", "basket", "bag", "payment",
    "pay", "order", "place-order", "confirm",
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

  const normalize = (text) => text?.toLowerCase().replace(/\s+/g, " ").trim() || "";

    const AMAZON_SKIP_PATTERNS = ["/cart", "/gp/cart", "/gp/aw/c"];

    const isCheckoutUrl = (url) => {
      const normalized = normalize(url);

      // On Amazon, skip the cart aggregation page — only trigger on
      // product pages (/dp/) or the actual checkout flow (/buy/, /checkout/)
      if (normalized.includes("amazon.")) {
        if (AMAZON_SKIP_PATTERNS.some((p) => normalized.includes(p))) return false;
        return normalized.includes("/dp/") ||
               normalized.includes("/buy/") ||
               normalized.includes("/checkout/");
      }

      return CHECKOUT_HINTS.some((hint) => normalized.includes(hint));
    };

  const getPageContextText = () => {
    const parts = [];
    if (document.title) parts.push(document.title);
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite?.content) parts.push(ogSite.content);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle?.content) parts.push(ogTitle.content);
    const h1 = document.querySelector("h1");
    if (h1?.textContent) parts.push(h1.textContent);
    const description = document.querySelector('meta[name="description"]');
    if (description?.content) parts.push(description.content);
    const bodyText = document.body?.innerText || "";
    parts.push(bodyText.slice(0, 20000));
    return normalize(parts.join(" "));
  };

  const keywordFallback = (text) => {
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
    return {
      source: "keyword",
      risk_level: matches.some((m) => m.level === "High")
        ? "high"
        : score > 0
        ? "moderate"
        : "low",
      matches,
    };
  };

  const assessRisk = async (extracted) => {
    try {
      const response = await fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(extracted),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn("[BTL] Edge Function call failed, falling back to keywords:", err);
      return null;
    }
  };

  // ─── Banner builders ────────────────────────────────────────────────────────

  const THEME_LABELS = {
    theme_commitment:   "Commitment",
    theme_traceability: "Traceability",
    theme_purchasing:   "Purchasing",
    theme_recruitment:  "Recruitment",
    theme_worker_voice: "Worker Voice",
    theme_monitoring:   "Monitoring",
    theme_remedy:       "Remedy",
  };

  const RISK_COLORS = {
    high:     { bg: "#fce8e6", text: "#b3261e", bar: "#e57373" },
    moderate: { bg: "#fff4e5", text: "#8a4b00", bar: "#ffb74d" },
    low:      { bg: "#e6f4ea", text: "#1e7f3b", bar: "#66bb6a" },
    unknown:  { bg: "#f1f3f4", text: "#5f6368", bar: "#bdbdbd" },
  };

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = v;
      else if (k === "innerHTML") node.innerHTML = v;
      else if (k === "href") { node.href = v; node.target = "_blank"; node.rel = "noopener noreferrer"; }
      else node.setAttribute(k, v);
    });
    children.forEach((c) => c && node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  };

  const buildThemeBar = (label, score) => {
    const pct = Math.round(score ?? 0);
    const color = pct >= 50 ? "#66bb6a" : pct >= 25 ? "#ffb74d" : "#e57373";
    const row = el("div", { className: "btl-theme-row" });
    row.appendChild(el("span", { className: "btl-theme-label", textContent: label }));
    const track = el("div", { className: "btl-theme-track" });
    const fill = el("div", { className: "btl-theme-fill" });
    fill.style.width = `${pct}%`;
    fill.style.background = color;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("span", { className: "btl-theme-pct", textContent: `${pct}` }));
    return row;
  };

  const buildHeader = (badgeText, badgeClass) => {
    const header = el("div", { className: "btl-header" });
    header.appendChild(el("span", { className: "btl-title", textContent: "Behind the Label" }));
    header.appendChild(el("span", { className: `btl-badge ${badgeClass}`, textContent: badgeText }));
    return header;
  };

  const buildCloseButton = (container) => {
    const btn = el("button", { className: "btl-close", textContent: "✕" });
    btn.addEventListener("click", () => { container.remove(); bannerEl = null; });
    return btn;
  };

  const buildRiskPill = (riskLevel) => {
    const colors = RISK_COLORS[riskLevel] || RISK_COLORS.unknown;
    const pill = el("div", { className: "btl-risk-pill" });
    pill.style.background = colors.bg;
    pill.style.color = colors.text;
    const labels = { high: "High Risk", moderate: "Moderate Risk", low: "Low Risk", unknown: "Unknown" };
    pill.textContent = labels[riskLevel] || riskLevel.toUpperCase();
    return pill;
  };

  // ─── KTC banner ─────────────────────────────────────────────────────────────

  const buildKtcBanner = (result) => {
    const container = el("div", { id: "btl-banner" });
    const closeBtn = buildCloseButton(container);
    container.appendChild(closeBtn);
    container.appendChild(buildHeader("KnowTheChain 2023", "btl-badge-ktc"));

    // Score + rank row
    const scoreRow = el("div", { className: "btl-score-row" });
    const scoreBlock = el("div", { className: "btl-score-block" });
    scoreBlock.appendChild(el("span", { className: "btl-score-number", textContent: `${Math.round(result.ktc_score)}` }));
    scoreBlock.appendChild(el("span", { className: "btl-score-denom", textContent: "/100" }));
    scoreRow.appendChild(scoreBlock);
    const rankBlock = el("div", { className: "btl-rank-block" });
    rankBlock.appendChild(el("div", { className: "btl-rank-number", textContent: `#${result.ktc_rank}` }));
    rankBlock.appendChild(el("div", { className: "btl-rank-label", textContent: "of 65 brands" }));
    scoreRow.appendChild(rankBlock);
    container.appendChild(scoreRow);

    // Risk pill
    container.appendChild(buildRiskPill(result.risk_level));

    // Theme bars
    if (result.themes) {
      const themesSection = el("div", { className: "btl-themes" });
      themesSection.appendChild(el("div", { className: "btl-themes-title", textContent: "Theme Scores" }));
      Object.entries(THEME_LABELS).forEach(([key, label]) => {
        if (result.themes[key] !== undefined) {
          themesSection.appendChild(buildThemeBar(label, result.themes[key]));
        }
      });
      container.appendChild(themesSection);
    }

    // Reason
    container.appendChild(el("div", { className: "btl-reason", textContent: result.reason }));

    // Disclaimer + source link
    const footer = el("div", { className: "btl-footer" });
    footer.appendChild(el("div", { className: "btl-disclaimer", textContent: result.disclaimer }));
    if (result.source_url) {
      footer.appendChild(el("a", { className: "btl-link", href: result.source_url, textContent: "View full benchmark →" }));
    }
    container.appendChild(footer);

    return container;
  };

  // ─── AI banner ──────────────────────────────────────────────────────────────

  const buildAiBanner = (result) => {
    const container = el("div", { id: "btl-banner" });
    container.appendChild(buildCloseButton(container));
    container.appendChild(buildHeader("AI Assessment", "btl-badge-ai"));
    container.appendChild(buildRiskPill(result.risk_level));
    container.appendChild(el("div", { className: "btl-reason", textContent: result.reason }));
    if (result.confidence) {
      container.appendChild(el("div", { className: "btl-confidence", textContent: `Confidence: ${result.confidence}` }));
    }
    container.appendChild(el("div", { className: "btl-disclaimer", textContent: result.disclaimer }));
    return container;
  };

  // ─── Keyword banner ─────────────────────────────────────────────────────────

  const buildKeywordBanner = (result) => {
    const container = el("div", { id: "btl-banner" });
    container.appendChild(buildCloseButton(container));
    container.appendChild(buildHeader("Keyword Scan", "btl-badge-keyword"));
    container.appendChild(buildRiskPill(result.risk_level));
    container.appendChild(el("div", { className: "btl-reason", textContent: "No benchmark data found. Showing keyword-based indicators." }));
    const list = el("ul", { className: "btl-match-list" });
    if (!result.matches?.length) {
      list.appendChild(el("li", { textContent: "No risk indicators detected on this page." }));
    } else {
      result.matches.slice(0, 5).forEach((m) => {
        list.appendChild(el("li", { textContent: `${m.reason} ("${m.term}")` }));
      });
    }
    container.appendChild(list);
    return container;
  };

  // ─── Router ──────────────────────────────────────────────────────────────────

  const buildBanner = (result) => {
    if (result.source === "ktc")     return buildKtcBanner(result);
    if (result.source === "ai")      return buildAiBanner(result);
    return buildKeywordBanner(result);
  };

  const showBanner = (result) => {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
    bannerEl = buildBanner(result);
    document.body.appendChild(bannerEl);
  };

  // ─── Main ───────────────────────────────────────────────────────────────────

  const updateBanner = async () => {
    if (!isCheckoutUrl(location.href)) {
      if (bannerEl) { bannerEl.remove(); bannerEl = null; }
      return;
    }
    const extracted = Extractor.extract();
    let result = null;
    if (extracted?.brand) result = await assessRisk(extracted);
    if (!result) result = keywordFallback(getPageContextText());
    showBanner(result);
  };

  const monitorLocationChanges = () => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) { lastUrl = currentUrl; updateBanner(); }
  };

  updateBanner();
  setInterval(monitorLocationChanges, 1000);
})();
