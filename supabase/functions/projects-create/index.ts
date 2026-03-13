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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Nicht authentifiziert" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Nutzer aus JWT ermitteln
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Ungültiger Token");

    const { data: userProfile } = await supabase
      .from("users")
      .select("id, role")
      .eq("auth_id", user.id)
      .single();

    if (!userProfile) throw new Error("Nutzerprofil nicht gefunden");
    if (userProfile.role !== "bauunternehmer") {
      return new Response(JSON.stringify({ error: "Nur Bauunternehmer können Projekte erstellen" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { title, gewerke, plz, radius, budget_min, budget_max, termin_from, termin_to, description, photos, nachhaltig } = body;

    if (!title || !gewerke?.length || !plz) {
      return new Response(JSON.stringify({ error: "Titel, Gewerke und PLZ sind Pflichtfelder" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        creator_id: userProfile.id,
        title,
        gewerke: Array.isArray(gewerke) ? gewerke : [gewerke],
        plz,
        radius: radius || 50,
        budget_min: budget_min || null,
        budget_max: budget_max || null,
        termin_from: termin_from || null,
        termin_to: termin_to || null,
        description: description || "",
        photos: photos || [],
        nachhaltig: nachhaltig || false,
        status: "offen",
      })
      .select()
      .single();

    if (projectError) throw projectError;

    // Matching-Workflow in n8n asynchron triggern
    const n8nUrl = Deno.env.get("N8N_WEBHOOK_MATCHING");
    if (n8nUrl) {
      fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, ...project }),
      }).catch(() => {});
    }

    // Direkt matching-run aufrufen (als Fallback)
    const matchingUrl = `${supabaseUrl}/functions/v1/matching-run`;
    fetch(matchingUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ projectId: project.id }),
    }).catch(() => {});

    return new Response(
      JSON.stringify({ success: true, project }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
