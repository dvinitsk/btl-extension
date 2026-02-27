import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const ktcRiskLevel = (score: number): "high" | "moderate" | "low" => {
  if (score < 30) return "high";
  if (score < 50) return "moderate";
  return "low";
};

const ktcReason = (brand: string, score: number, rank: number, themes: Record<string, number>): string => {
  // Find the weakest theme to surface in the reason
  const themeLabels: Record<string, string> = {
    theme_commitment:   "Commitment & Governance",
    theme_traceability: "Traceability & Risk Assessment",
    theme_purchasing:   "Purchasing Practices",
    theme_recruitment:  "Recruitment",
    theme_worker_voice: "Worker Voice",
    theme_monitoring:   "Monitoring",
    theme_remedy:       "Remedy",
  };

  const weakest = Object.entries(themes)
    .filter(([, v]) => v !== null)
    .sort(([, a], [, b]) => a - b)[0];

  const weakestLabel = weakest ? themeLabels[weakest[0]] : null;

  if (score === 0) {
    return `${brand} scored 0/100 on the KnowTheChain 2023 Apparel & Footwear Benchmark, indicating no public disclosure on forced labour practices.`;
  }

  const base = `${brand} ranked ${rank}/65 with a score of ${Math.round(score)}/100 on the KnowTheChain 2023 Apparel & Footwear Benchmark.`;
  const weakness = weakestLabel ? ` Weakest area: ${weakestLabel} (${Math.round(weakest[1])}/100).` : "";
  return base + weakness;
};

// ─── Claude fallback ─────────────────────────────────────────────────────────

const assessWithClaude = async (brand: string, product: string | null, country: string | null) => {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are an ethical sourcing risk analyst. Assess the forced labor risk for the following product purchase.

Brand: ${brand}
Product category: ${product || "unknown"}
Country of origin: ${country || "unknown"}

Respond in this exact JSON format with no additional text:
{
  "risk_level": "high" | "moderate" | "low",
  "reason": "one sentence explanation",
  "confidence": "high" | "medium" | "low"
}

Base your assessment on known supply chain issues, industry reputation, and sourcing regions. If you have no meaningful information about this brand, set risk_level to "low" and confidence to "low".`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
};

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { brand, product, country } = await req.json();

    if (!brand) {
      return new Response(JSON.stringify({ error: "brand is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const normalizedBrand = brand.toLowerCase().trim();

    // ── 1. Check KTC assessments ──────────────────────────────────────────────
    const { data: ktcMatches, error: ktcError } = await supabase
      .rpc("search_ktc", { search_term: normalizedBrand });

    if (ktcError) throw ktcError;
      

    if (ktcError) throw ktcError;

    if (ktcMatches && ktcMatches.length > 0) {
      const match = ktcMatches[0];
      const themes = {
        theme_commitment:   match.theme_commitment,
        theme_traceability: match.theme_traceability,
        theme_purchasing:   match.theme_purchasing,
        theme_recruitment:  match.theme_recruitment,
        theme_worker_voice: match.theme_worker_voice,
        theme_monitoring:   match.theme_monitoring,
        theme_remedy:       match.theme_remedy,
      };

      return new Response(
        JSON.stringify({
          source: "ktc",
          brand: match.brand,
          risk_level: ktcRiskLevel(match.ktc_score),
          ktc_score: match.ktc_score,
          ktc_rank: match.ktc_rank,
          benchmark_year: match.benchmark_year,
          themes,
          reason: ktcReason(match.brand, match.ktc_score, match.ktc_rank, themes),
          disclaimer: "Risk level reflects transparency score, not confirmed violations. Source: KnowTheChain 2023 Apparel & Footwear Benchmark.",
          source_url: match.source_url,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Claude fallback ────────────────────────────────────────────────────
    try {
      const aiResult = await assessWithClaude(brand, product, country);
      return new Response(
        JSON.stringify({
          source: "ai",
          risk_level: aiResult.risk_level,
          reason: aiResult.reason,
          confidence: aiResult.confidence,
          disclaimer: "This assessment was generated by AI and is not based on verified benchmark data.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (aiErr) {
      console.error("[BTL] Claude fallback failed:", aiErr);
      return new Response(
        JSON.stringify({
          source: "ai",
          risk_level: "unknown",
          reason: "AI assessment unavailable.",
          disclaimer: "Could not complete assessment. Please research this brand independently.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
