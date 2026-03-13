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
      .select("id, role, company")
      .eq("auth_id", user.id)
      .single();

    if (!userProfile) throw new Error("Profil nicht gefunden");
    if (userProfile.role !== "subunternehmer") {
      return new Response(JSON.stringify({ error: "Nur Subunternehmer können sich bewerben" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectId, message, availability } = await req.json();
    if (!projectId) throw new Error("projectId fehlt");

    // Projekt und Bauunternehmer laden
    const { data: project } = await supabase
      .from("projects")
      .select("id, title, creator_id, status")
      .eq("id", projectId)
      .single();

    if (!project) throw new Error("Projekt nicht gefunden");
    if (project.status !== "offen") {
      return new Response(JSON.stringify({ error: "Projekt ist nicht mehr offen" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bewerbung anlegen
    const { data: application, error: appError } = await supabase
      .from("applications")
      .insert({
        project_id: projectId,
        applicant_id: userProfile.id,
        message: message || "",
        availability: availability || null,
        status: "ausstehend",
      })
      .select()
      .single();

    if (appError) {
      if (appError.code === "23505") {
        return new Response(JSON.stringify({ error: "Sie haben sich bereits beworben" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw appError;
    }

    // Benachrichtigung an Bauunternehmer
    await supabase.from("notifications").insert({
      user_id: project.creator_id,
      type: "new_application",
      title: "Neue Bewerbung eingegangen",
      message: `${userProfile.company} hat sich für "${project.title}" beworben.`,
      data: { projectId, applicationId: application.id },
    });

    // n8n Webhook
    const n8nUrl = Deno.env.get("N8N_WEBHOOK_APPLICATION");
    if (n8nUrl) {
      fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: application.id,
          projectId,
          applicantId: userProfile.id,
          projectTitle: project.title,
          applicantCompany: userProfile.company,
        }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ success: true, application }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
