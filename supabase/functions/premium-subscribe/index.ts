import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PREMIUM_PRICE_ID = Deno.env.get("STRIPE_PREMIUM_PRICE_ID") || "price_premium_monthly";
const PREMIUM_AMOUNT = 1900; // 19€ in Cent

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Stripe Webhook oder direkte Aktivierung
    const contentType = req.headers.get("content-type") || "";
    const body = await req.json();

    // Stripe Webhook-Handler
    if (body.type === "checkout.session.completed") {
      const session = body.data.object;
      const userId = session.metadata?.userId;
      if (userId) {
        const premiumUntil = new Date();
        premiumUntil.setMonth(premiumUntil.getMonth() + 1);
        await supabase.from("users")
          .update({ premium_until: premiumUntil.toISOString() })
          .eq("id", userId);

        await supabase.from("notifications").insert({
          user_id: userId,
          type: "premium_activated",
          title: "Premium aktiviert!",
          message: `Ihr Premium-Abonnement ist jetzt aktiv bis ${premiumUntil.toLocaleDateString("de-DE")}.`,
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Direkte Premium-Checkout-Session erstellen
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Nicht authentifiziert");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Ungültiger Token");

    const { data: userProfile } = await supabase
      .from("users")
      .select("id, email, company")
      .eq("auth_id", user.id)
      .single();

    if (!userProfile) throw new Error("Profil nicht gefunden");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost";

    if (!stripeKey) {
      // Fallback: direkt aktivieren (für Entwicklung)
      const premiumUntil = new Date();
      premiumUntil.setMonth(premiumUntil.getMonth() + 1);
      await supabase.from("users")
        .update({ premium_until: premiumUntil.toISOString() })
        .eq("id", userProfile.id);

      return new Response(
        JSON.stringify({ success: true, message: "Premium aktiviert (Demo-Modus)", premium_until: premiumUntil }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Stripe Checkout Session erstellen
    const sessionParams = new URLSearchParams({
      "payment_method_types[]": "card",
      "mode": "subscription",
      "line_items[0][price]": PREMIUM_PRICE_ID,
      "line_items[0][quantity]": "1",
      "customer_email": userProfile.email,
      "metadata[userId]": userProfile.id,
      "success_url": `${siteUrl}/dashboard.html?premium=success`,
      "cancel_url": `${siteUrl}/dashboard.html?premium=cancel`,
    });

    const sessionResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: sessionParams,
    });

    if (!sessionResp.ok) {
      const err = await sessionResp.json();
      throw new Error(err.error?.message || "Stripe Fehler");
    }

    const session = await sessionResp.json();
    return new Response(
      JSON.stringify({ success: true, checkoutUrl: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
