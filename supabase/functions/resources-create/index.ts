import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const category = url.searchParams.get("category");
      const maxPrice = url.searchParams.get("maxPrice");
      const plz = url.searchParams.get("plz");

      let query = supabase.from("resources").select("*, users(company, plz, rating)").eq("status", "verfuegbar");
      if (category) query = query.eq("category", category);
      if (maxPrice) query = query.lte("price_per_day", parseFloat(maxPrice));
      if (plz) query = query.eq("plz", plz);

      const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
      if (error) throw error;

      return new Response(JSON.stringify({ resources: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST: Ressource anlegen
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Nicht authentifiziert");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Ungültiger Token");

    const { data: userProfile } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", user.id)
      .single();

    const { title, category, description, price_per_day, price_type, plz, images, available_from, available_to } = await req.json();

    if (!title || !category) {
      return new Response(JSON.stringify({ error: "Titel und Kategorie erforderlich" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: resource, error } = await supabase
      .from("resources")
      .insert({
        owner_id: userProfile.id,
        title,
        category,
        description: description || "",
        price_per_day: price_per_day || null,
        price_type: price_type || "tag",
        plz: plz || null,
        images: images || [],
        available_from: available_from || null,
        available_to: available_to || null,
      })
      .select()
      .single();

    if (error) throw error;

    // n8n Benachrichtigung
    const n8nUrl = Deno.env.get("N8N_WEBHOOK_RESOURCES");
    if (n8nUrl) {
      fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: resource.id, ...resource }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ success: true, resource }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
