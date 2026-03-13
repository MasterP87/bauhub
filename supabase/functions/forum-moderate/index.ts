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

    const body = await req.json();
    const { postId, decision, note } = body;

    // Manuelle Moderation (von Admin)
    if (decision && postId) {
      await supabase.from("forum_posts").update({
        moderation_status: decision,
        moderation_note: note || null,
        ai_moderated: false,
      }).eq("id", postId);

      return new Response(
        JSON.stringify({ success: true, status: decision }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // KI-Moderation
    if (!postId) throw new Error("postId fehlt");

    const { data: post } = await supabase
      .from("forum_posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (!post) throw new Error("Beitrag nicht gefunden");

    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    let moderationStatus = "genehmigt";
    let moderationNote = "Automatisch genehmigt";

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
          max_tokens: 256,
          messages: [{
            role: "user",
            content: `Moderiere diesen Forenbeitrag für eine deutsche Bauplattform.
Titel: "${post.title}"
Inhalt: "${post.content.substring(0, 500)}"

Prüfe auf: Spam, Beleidigungen, illegale Inhalte, Werbung, Off-Topic.
Antworte mit JSON: {"approve": true/false, "reason": "kurze Begründung auf Deutsch"}`,
          }],
        }),
      });

      if (claudeResp.ok) {
        const data = await claudeResp.json();
        const text = data.content?.[0]?.text || "";
        const parsed = JSON.parse(text.match(/\{.*\}/s)?.[0] || "{}");
        moderationStatus = parsed.approve === false ? "abgelehnt" : "genehmigt";
        moderationNote = parsed.reason || "KI-Moderation";
      }
    }

    await supabase.from("forum_posts").update({
      moderation_status: moderationStatus,
      moderation_note: moderationNote,
      ai_moderated: true,
    }).eq("id", postId);

    // Benachrichtigung an Autor
    await supabase.from("notifications").insert({
      user_id: post.author_id,
      type: "forum_moderation",
      title: moderationStatus === "genehmigt" ? "Beitrag veröffentlicht" : "Beitrag abgelehnt",
      message: moderationStatus === "genehmigt"
        ? `Ihr Beitrag "${post.title}" wurde veröffentlicht.`
        : `Ihr Beitrag "${post.title}" wurde abgelehnt: ${moderationNote}`,
      data: { postId },
    });

    return new Response(
      JSON.stringify({ success: true, status: moderationStatus, note: moderationNote }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
