import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// PLZ-Distanz-Approximation (einfach, basierend auf erstem Zeichen)
function plzDistanceApprox(plz1: string, plz2: string): number {
  const p1 = parseInt(plz1.substring(0, 2) || "0");
  const p2 = parseInt(plz2.substring(0, 2) || "0");
  return Math.abs(p1 - p2) * 8; // Grobe Näherung in km
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { projectId } = await req.json();

    // Projekt laden
    const { data: project, error: projError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projError || !project) throw new Error("Projekt nicht gefunden");
    if (project.matching_done) {
      return new Response(JSON.stringify({ message: "Matching bereits durchgeführt" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Passende Subunternehmer suchen
    const { data: candidates, error: candError } = await supabase
      .from("users")
      .select("id, company, plz, gewerke, verified, premium_until, rating, availability")
      .eq("role", "subunternehmer")
      .eq("verified", true);

    if (candError) throw candError;

    // Scoring-Algorithmus
    const scored = (candidates || [])
      .map((sub) => {
        // Gewerk-Match (wichtigster Faktor)
        const gewerkMatch = sub.gewerke?.some((g: string) =>
          project.gewerke?.some((pg: string) =>
            g.toLowerCase().includes(pg.toLowerCase()) || pg.toLowerCase().includes(g.toLowerCase())
          )
        );
        if (!gewerkMatch) return null;

        // Distanz prüfen
        const dist = plzDistanceApprox(project.plz, sub.plz);
        if (dist > (project.radius || 50)) return null;

        // Score berechnen
        let score = 50;
        score += (5 - dist / 10) * 5; // Nähe: max +25
        score += (sub.rating || 0) * 5; // Rating: max +25
        score += sub.premium_until && new Date(sub.premium_until) > new Date() ? 15 : 0; // Premium: +15
        score += sub.verified ? 10 : 0; // Verifiziert: +10

        // Verfügbarkeit prüfen
        if (project.termin_from && sub.availability) {
          const available = new Date(sub.availability) <= new Date(project.termin_from);
          score += available ? 10 : -20;
        }

        return { ...sub, score: Math.min(100, Math.max(0, score)), distance: dist };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 10); // Top 10

    // KI-Priorisierung mit Claude (optional)
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    let aiRanked = scored;

    if (claudeKey && scored.length > 1) {
      try {
        const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": claudeKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 512,
            messages: [{
              role: "user",
              content: `Du bist ein Matching-Assistent für Bauprojekte.
Projekt: "${project.title}", Gewerke: ${project.gewerke?.join(", ")}, PLZ: ${project.plz}, Budget: ${project.budget_min}-${project.budget_max}€.
Kandidaten (JSON): ${JSON.stringify(scored.map((s: any) => ({ id: s.id, company: s.company, score: s.score, distance: s.distance, rating: s.rating })))}.
Gib die IDs sortiert nach Eignung zurück als JSON-Array: {"ranked_ids": ["id1", "id2", ...]}.`,
            }],
          }),
        });

        if (claudeResp.ok) {
          const claudeData = await claudeResp.json();
          const text = claudeData.content?.[0]?.text || "";
          const parsed = JSON.parse(text.match(/\{.*\}/s)?.[0] || "{}");
          if (parsed.ranked_ids?.length) {
            const idOrder = new Map(parsed.ranked_ids.map((id: string, i: number) => [id, i]));
            aiRanked = scored.sort((a: any, b: any) =>
              (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99)
            );
          }
        }
      } catch (_) { /* KI-Fehler ignorieren, Score-Ranking bleibt */ }
    }

    // Matches in Datenbank speichern
    const matchInserts = aiRanked.map((sub: any) => ({
      project_id: projectId,
      subunternehmer_id: sub.id,
      bauunternehmer_id: project.creator_id,
      ai_score: sub.score,
      status: "vorgeschlagen",
    }));

    if (matchInserts.length > 0) {
      await supabase.from("matches").upsert(matchInserts, { onConflict: "project_id,subunternehmer_id" });
    }

    // Projekt als "matching_done" markieren
    await supabase.from("projects").update({ matching_done: true }).eq("id", projectId);

    // Benachrichtigungen an Subunternehmer senden
    for (const sub of aiRanked.slice(0, 5) as any[]) {
      await supabase.from("notifications").insert({
        user_id: sub.id,
        type: "new_match",
        title: "Neues Projekt gefunden!",
        message: `Projekt "${project.title}" in ${project.plz} passt zu Ihrem Profil. Jetzt bewerben!`,
        data: { projectId },
      });
    }

    // E-Mail via n8n
    const n8nEmailUrl = Deno.env.get("N8N_WEBHOOK_MATCHING_EMAIL");
    if (n8nEmailUrl && aiRanked.length > 0) {
      fetch(n8nEmailUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, matches: aiRanked }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ success: true, matchCount: aiRanked.length, matches: aiRanked }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
