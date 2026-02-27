const Extractor = (() => {
  const normalize = (text) => text?.toLowerCase().replace(/\s+/g, " ").trim() || "";

  // Country code subdomains to ignore when parsing brand from domain
  // e.g. ca.shein.com → "shein", not "ca"
  const COUNTRY_SUBDOMAINS = new Set([
    "ca", "uk", "us", "au", "fr", "de", "it", "es", "jp", "kr",
    "in", "br", "mx", "nl", "be", "se", "no", "dk", "fi", "pt",
    "pl", "cz", "ro", "gr", "hu", "at", "ch", "nz", "sg", "hk",
    "tw", "th", "my", "id", "ph", "vn", "ae", "sa", "za", "ng",
    "ke", "eg", "pk", "bd", "lk", "www", "shop", "store", "m",
  ]);

  // Major retailer/marketplace domains where the domain name is NOT the product brand
  const RETAILER_DOMAINS = new Set([
    "amazon", "walmart", "target", "ebay", "etsy", "shopify",
    "wayfair", "wish", "aliexpress", "alibaba", "taobao", "jd",
    "rakuten", "mercadolibre", "flipkart", "snapdeal", "noon",
    "bestbuy", "costco", "samsclub", "macys", "nordstrom",
    "bloomingdales", "saks", "neiman", "zappos", "revolve",
    "asos", "shein", "temu", "fashionnova", "boohoo",
  ]);

  // --- Helpers ---------------------------------------------------------------

  // Extracts the meaningful brand name from a hostname
  // ca.shein.com → "shein"
  // www.amazon.co.uk → "amazon"
  // shop.lululemon.com → "lululemon"
  const brandFromHostname = (hostname) => {
    const parts = hostname.replace(/^www\./, "").split(".");
    // Filter out country codes, generic subdomains, and TLDs (co, com, net, etc.)
    const tlds = new Set(["com", "co", "net", "org", "io", "ca", "uk", "au"]);
    const meaningful = parts.filter(
      (p) => p.length > 2 && !COUNTRY_SUBDOMAINS.has(p) && !tlds.has(p)
    );
    return meaningful[0] || parts[0] || null;
  };

  const isRetailerDomain = (hostname) => {
    const brand = brandFromHostname(hostname);
    return brand ? RETAILER_DOMAINS.has(brand.toLowerCase()) : false;
  };

  // --- JSON-LD ---------------------------------------------------------------

  const extractFromJsonLd = () => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const entries = Array.isArray(data) ? data : [data];
        for (const entry of entries) {
          const type = entry["@type"];
          if (type === "Product" || type === "ItemPage") {
            const brand =
              entry.brand?.name ||
              entry.brand ||
              entry.manufacturer?.name ||
              null;
            const product =
              entry.name || entry.description?.slice(0, 60) || null;
            const country =
              entry.countryOfOrigin ||
              entry.offers?.availableAtOrFrom?.address?.addressCountry ||
              null;
            if (brand || product) return { brand, product, country };
          }
        }
      } catch {
        continue;
      }
    }
    return null;
  };

  // --- Amazon-specific -------------------------------------------------------
  // Amazon stores the product brand in #bylineInfo or #brand,
  // separate from the Amazon site identity

  const extractFromAmazon = () => {
    if (!location.hostname.includes("amazon")) return null;

    // #bylineInfo contains "Visit the Nike Store" or "Brand: Nike"
    const byline = document.querySelector("#bylineInfo");
    let brand = null;
    if (byline) {
      const text = byline.textContent || "";
      // "Visit the Nike Store" → "Nike"
      const visitMatch = text.match(/visit the (.+?) store/i);
      // "Brand: Nike" → "Nike"
      const brandMatch = text.match(/brand[:\s]+(.+)/i);
      brand = visitMatch?.[1]?.trim() || brandMatch?.[1]?.trim() || null;
    }

    // Fallback to #brand element
    if (!brand) {
      brand = document.querySelector("#brand")?.textContent?.trim() || null;
    }

    // Product title from dedicated element
    const product =
      document.querySelector("#productTitle")?.textContent?.trim() ||
      document.querySelector("#title")?.textContent?.trim() ||
      null;

    if (brand || product) return { brand, product, country: null };
    return null;
  };

  // --- Shein-specific --------------------------------------------------------
  // Shein product pages store brand info in data attributes and specific elements

  const extractFromShein = () => {
    if (!location.hostname.includes("shein")) return null;

    // Shein sells its own brand — the brand is always "SHEIN" or a sub-brand
    // Try to get the actual sub-brand from the product page
    const brandEl =
      document.querySelector(".product-intro__head-brand") ||
      document.querySelector("[class*='brand-name']") ||
      null;

    const brand = brandEl?.textContent?.trim() || "SHEIN";

    const product =
      document.querySelector(".product-intro__head-name")?.textContent?.trim() ||
      document.querySelector("h1")?.textContent?.trim() ||
      null;

    return { brand, product, country: null };
  };

  // --- Open Graph ------------------------------------------------------------

  const extractFromOpenGraph = () => {
    const hostname = location.hostname;

    // Don't use og:site_name if it's a retailer (it'll just say "Amazon" etc.)
    const siteName = isRetailerDomain(hostname)
      ? null
      : document.querySelector('meta[property="og:site_name"]')?.content || null;

    const product =
      document.querySelector('meta[property="og:title"]')?.content || null;

    if (siteName || product) return { brand: siteName, product, country: null };
    return null;
  };

  // --- Schema.org Microdata --------------------------------------------------

  const extractFromMicrodata = () => {
    const productEl = document.querySelector(
      '[itemtype*="schema.org/Product"], [itemtype*="schema.org/ItemPage"]'
    );
    if (!productEl) return null;

    const brand =
      productEl.querySelector('[itemprop="brand"]')?.textContent ||
      productEl.querySelector('[itemprop="manufacturer"]')?.textContent ||
      null;
    const product =
      productEl.querySelector('[itemprop="name"]')?.textContent || null;
    const country =
      productEl.querySelector('[itemprop="countryOfOrigin"]')?.textContent || null;

    if (brand || product) {
      return {
        brand: normalize(brand),
        product: normalize(product),
        country: normalize(country),
      };
    }
    return null;
  };

  // --- Heuristic Fallback ----------------------------------------------------

  const extractFromHeuristics = () => {
    const hostname = location.hostname.replace(/^www\./, "");
    const domainBrand = brandFromHostname(hostname);

    // Don't use the domain brand if it's a generic retailer/marketplace
    const brand = isRetailerDomain(hostname) ? null : domainBrand;

    const h1 = document.querySelector("h1")?.textContent || "";
    const title = document.title || "";
    const product = h1 || title.split(/[-|—]/)[0].trim() || null;

    return { brand, product, country: null };
  };

  // --- Main ------------------------------------------------------------------

  const extract = () => {
    const jsonLd = extractFromJsonLd();
    if (jsonLd?.brand) return jsonLd;

    const amazon = extractFromAmazon();
    if (amazon?.brand) return amazon;

    const shein = extractFromShein();
    if (shein?.brand) return shein;

    const og = extractFromOpenGraph();
    if (og?.brand) return og;

    const microdata = extractFromMicrodata();
    if (microdata?.brand) return microdata;

    return extractFromHeuristics();
  };

  return { extract };
})();
