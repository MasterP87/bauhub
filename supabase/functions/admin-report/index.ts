import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminApiKey = Deno.env.get("ADMIN_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    // Admin-Auth prüfen
    const apiKey = req.headers.get("x-api-key");
    if (adminApiKey && apiKey !== adminApiKey) {
      return new Response(JSON.stringify({ error: "Nicht autorisiert" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Neue Nutzer im letzten Monat
    const { count: newUsers } = await supabase
      .from("users")
      .select("id", { count: "exact" })
      .gte("created_at", firstOfLastMonth.toISOString())
      .lt("created_at", firstOfMonth.toISOString());

    // Abgeschlossene Matches
    const { data: matches } = await supabase
      .from("matches")
      .select("provision_amount, provision_rate")
      .eq("status", "beide_bestaetigt")
      .gte("created_at", firstOfLastMonth.toISOString());

    const totalProvision = (matches || []).reduce(
      (sum, m) => sum + (m.provision_amount || 0), 0
    );

    // Premium-Nutzer
    const { count: premiumCount } = await supabase
      .from("users")
      .select("id", { count: "exact" })
      .gt("premium_until", firstOfLastMonth.toISOString());

    const premiumRevenue = (premiumCount || 0) * 19;
    const totalRevenue = totalProvision + premiumRevenue;

    // Projekte im letzten Monat
    const { count: newProjects } = await supabase
      .from("projects")
      .select("id", { count: "exact" })
      .gte("created_at", firstOfLastMonth.toISOString());

    const reportData = {
      period: `${firstOfLastMonth.toLocaleDateString("de-DE")} – ${firstOfMonth.toLocaleDateString("de-DE")}`,
      new_users: newUsers || 0,
      new_projects: newProjects || 0,
      total_matches: matches?.length || 0,
      total_provision_eur: totalProvision,
      premium_users: premiumCount || 0,
      premium_revenue_eur: premiumRevenue,
      total_revenue_eur: totalRevenue,
      generated_at: now.toISOString(),
    };

    // Report in DB speichern
    await supabase.from("admin_reports").insert({
      period_start: firstOfLastMonth,
      period_end: firstOfMonth,
      total_matches: matches?.length || 0,
      total_provision: totalProvision,
      total_premium: premiumRevenue,
      total_revenue: totalRevenue,
      new_users: newUsers || 0,
      report_data: reportData,
    }).catch(() => {});

    // KI-Zusammenfassung via Claude
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    let summary = "";
    if (claudeKey) {
      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          messages: [{
            role: "user",
            content: `Erstelle eine kurze Managementzusammenfassung (3 Sätze) für diesen Monatsreport einer Bau-Vermittlungsplattform auf Deutsch:
${JSON.stringify(reportData, null, 2)}`,
          }],
        }),
      }).catch(() => null);

      if (claudeResp?.ok) {
        const data = await claudeResp.json();
        summary = data.content?.[0]?.text || "";
      }
    }

    // n8n PDF-Report triggern
    const n8nUrl = Deno.env.get("N8N_WEBHOOK_MONTHLY_REPORT");
    if (n8nUrl) {
      fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reportData, summary }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ success: true, report: reportData, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
