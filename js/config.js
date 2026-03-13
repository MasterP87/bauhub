/**
 * BauHub - Zentrale Konfiguration
 * Umgebungsvariablen werden beim Deployment injiziert.
 * Für lokale Entwicklung: .env.local anlegen und diese Werte überschreiben.
 */

const BauHubConfig = (() => {
  // Vercel/Netlify injizierte Umgebungsvariablen (Build-Zeit)
  const env = {
    SUPABASE_URL: window.__SUPABASE_URL__ || 'https://YOUR_PROJECT_REF.supabase.co',
    SUPABASE_ANON_KEY: window.__SUPABASE_ANON_KEY__ || 'YOUR_ANON_KEY',
    STRIPE_PUBLIC_KEY: window.__STRIPE_PUBLIC_KEY__ || '',
    SITE_URL: window.location.origin,
  };

  // Supabase Edge Function Basis-URL
  const FUNCTIONS_URL = `${env.SUPABASE_URL}/functions/v1`;

  return {
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      functionsUrl: FUNCTIONS_URL,
    },
    stripe: {
      publicKey: env.STRIPE_PUBLIC_KEY,
    },
    siteUrl: env.SITE_URL,
    isDev: env.SUPABASE_URL.includes('localhost') || env.SUPABASE_URL.includes('127.0.0.1'),
  };
})();

window.BauHubConfig = BauHubConfig;
