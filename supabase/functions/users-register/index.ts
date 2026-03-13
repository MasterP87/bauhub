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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { email, password, role, company, plz, gewerke } = await req.json();

    if (!email || !password || !role || !company || !plz) {
      return new Response(JSON.stringify({ error: "Pflichtfelder fehlen" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth-Nutzer anlegen
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    });

    if (authError) throw authError;

    // Profil in users-Tabelle anlegen
    const { data: userProfile, error: profileError } = await supabase
      .from("users")
      .insert({
        auth_id: authData.user.id,
        email,
        role,
        company,
        plz,
        gewerke: gewerke || [],
      })
      .select()
      .single();

    if (profileError) {
      // Rollback: Auth-Nutzer löschen
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw profileError;
    }

    // n8n Webhook: Verifizierungs-Workflow triggern
    const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_USER_REGISTER");
    if (n8nWebhookUrl) {
      await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userProfile.id, email, company, role }),
      }).catch(() => {}); // Non-blocking
    }

    // Bestätigungs-E-Mail senden (Supabase Auth)
    await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      options: { redirectTo: `${Deno.env.get("SITE_URL")}/login.html?verified=1` },
    }).catch(() => {});

    return new Response(
      JSON.stringify({
        success: true,
        message: "Registrierung erfolgreich. Bitte E-Mail bestätigen.",
        userId: userProfile.id,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
