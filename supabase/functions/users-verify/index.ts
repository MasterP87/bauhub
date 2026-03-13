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

    const { userId, fileUrl } = await req.json();

    if (!userId || !fileUrl) {
      return new Response(JSON.stringify({ error: "userId und fileUrl erforderlich" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifizierungsdatei in user-Profil speichern
    await supabase.from("users").update({ verification_file: fileUrl }).eq("id", userId);

    // n8n User-Verification Workflow auslösen
    const n8nUrl = Deno.env.get("N8N_WEBHOOK_USER_VERIFY");
    if (n8nUrl) {
      const response = await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, fileUrl }),
      });

      if (response.ok) {
        const result = await response.json();
        // Wenn n8n bereits geprüft hat, status zurückgeben
        if (result.verified !== undefined) {
          await supabase.from("users")
            .update({ verified: result.verified })
            .eq("id", userId);

          return new Response(
            JSON.stringify({ success: true, verified: result.verified, message: result.message }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Direkte KI-Prüfung via Claude (Fallback wenn n8n nicht verfügbar)
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (claudeKey && fileUrl.match(/\.(jpg|jpeg|png|pdf|webp)$/i)) {
      const isImage = fileUrl.match(/\.(jpg|jpeg|png|webp)$/i);

      const messages: any[] = [{
        role: "user",
        content: isImage ? [
          {
            type: "image",
            source: { type: "url", url: fileUrl },
          },
          {
            type: "text",
            text: "Ist dieses Bild ein offizielles deutsches Geschäftsdokument wie eine Handwerksrolle, Gewerbeanmeldung oder Meisterbrief? Antworte mit JSON: {\"valid\": true/false, \"reason\": \"kurze Begründung\", \"document_type\": \"Dokumenttyp\"}",
          },
        ] : [{ type: "text", text: `Dokument-URL: ${fileUrl}. Kann ohne Bildzugang nicht geprüft werden. Bitte manuell prüfen.` }],
      }];

      const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 256,
          messages,
        }),
      });

      if (claudeResponse.ok) {
        const claudeData = await claudeResponse.json();
        const text = claudeData.content?.[0]?.text || "{}";
        const parsed = JSON.parse(text.match(/\{.*\}/s)?.[0] || "{}");

        if (parsed.valid === true) {
          await supabase.from("users").update({ verified: true }).eq("id", userId);
          await supabase.from("notifications").insert({
            user_id: userId,
            type: "verification_approved",
            title: "Verifizierung erfolgreich",
            message: `Ihr Dokument (${parsed.document_type || "Gewerbedokument"}) wurde erfolgreich verifiziert.`,
          });
          return new Response(
            JSON.stringify({ success: true, verified: true, message: "Verifizierung erfolgreich" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "Dokument eingereicht. Prüfung läuft." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
