import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Nicht authentifiziert");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Ungültiger Token");

    const { data: userProfile } = await supabase
      .from("users")
      .select("id, role")
      .eq("auth_id", user.id)
      .single();

    const { matchId } = await req.json();
    if (!matchId) throw new Error("matchId fehlt");

    const { data: match } = await supabase
      .from("matches")
      .select("*, projects(*)")
      .eq("id", matchId)
      .single();

    if (!match) throw new Error("Match nicht gefunden");

    const isBau = match.bauunternehmer_id === userProfile.id;
    const isSub = match.subunternehmer_id === userProfile.id;
    if (!isBau && !isSub) throw new Error("Nicht berechtigt");

    // Bestätigung setzen
    const updateData: any = {};
    if (isBau && !match.bauunternehmer_confirmed_at) {
      updateData.bauunternehmer_confirmed_at = new Date().toISOString();
      updateData.status = "bauunternehmer_bestaetigt";
    } else if (isSub && match.bauunternehmer_confirmed_at) {
      updateData.subunternehmer_confirmed_at = new Date().toISOString();
      updateData.status = "beide_bestaetigt";
    }

    await supabase.from("matches").update(updateData).eq("id", matchId);

    // Wenn beide bestätigt: Provision via Stripe
    if (updateData.status === "beide_bestaetigt") {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      const project = match.projects;
      const budgetMid = ((project.budget_min || 0) + (project.budget_max || 0)) / 2;
      const provisionRate = match.provision_rate / 100;
      const provisionAmount = Math.round(budgetMid * provisionRate * 100); // in Cent

      if (stripeKey && provisionAmount > 0) {
        try {
          // Stripe Payment Intent erstellen
          const stripeResp = await fetch("https://api.stripe.com/v1/payment_intents", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              amount: provisionAmount.toString(),
              currency: "eur",
              description: `BauHub Provision: ${project.title}`,
              metadata: JSON.stringify({ matchId, projectId: project.id }),
            }),
          });

          if (stripeResp.ok) {
            const pi = await stripeResp.json();
            await supabase.from("matches").update({
              stripe_payment_intent: pi.id,
              provision_amount: provisionAmount / 100,
            }).eq("id", matchId);
          }
        } catch (_) {}
      }

      // n8n für vollständige Stripe-Connect-Abwicklung
      const n8nUrl = Deno.env.get("N8N_WEBHOOK_MATCH_CONFIRM");
      if (n8nUrl) {
        fetch(n8nUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, projectId: match.project_id, provisionAmount: provisionAmount / 100 }),
        }).catch(() => {});
      }

      // Benachrichtigungen
      for (const userId of [match.bauunternehmer_id, match.subunternehmer_id]) {
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "match_confirmed",
          title: "Match bestätigt!",
          message: `Beide Parteien haben das Match für "${project.title}" bestätigt. Die Vermittlung ist abgeschlossen.`,
          data: { matchId, projectId: match.project_id },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, status: updateData.status || "bestaetigt" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
