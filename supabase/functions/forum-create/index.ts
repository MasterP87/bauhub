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
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Ungültiger Token");

    const { data: userProfile } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", user.id)
      .single();

    const { title, content, category, images } = await req.json();

    if (!title || !content || !category) {
      return new Response(JSON.stringify({ error: "Titel, Inhalt und Kategorie sind Pflichtfelder" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: post, error: postError } = await supabase
      .from("forum_posts")
      .insert({
        author_id: userProfile.id,
        title,
        content,
        category,
        images: images || [],
        moderation_status: "ausstehend",
      })
      .select()
      .single();

    if (postError) throw postError;

    // Moderations-Webhook in n8n
    const n8nUrl = Deno.env.get("N8N_WEBHOOK_FORUM_MODERATE");
    if (n8nUrl) {
      fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, title, content, authorId: userProfile.id }),
      }).catch(() => {});
    } else {
      // Direkt forum-moderate aufrufen
      const moderateUrl = `${supabaseUrl}/functions/v1/forum-moderate`;
      fetch(moderateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({ postId: post.id }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ success: true, post, message: "Beitrag eingereicht – wird moderiert" }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
