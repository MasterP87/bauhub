#!/usr/bin/env node
/**
 * BauHub Config Injector
 * Injiziert Umgebungsvariablen in js/config.js beim Build.
 * Wird von Vercel/Netlify beim Deployment ausgeführt.
 */
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'js', 'config.js');

const config = `
window.__SUPABASE_URL__ = '${process.env.SUPABASE_URL || ''}';
window.__SUPABASE_ANON_KEY__ = '${process.env.SUPABASE_ANON_KEY || ''}';
window.__STRIPE_PUBLIC_KEY__ = '${process.env.STRIPE_PUBLIC_KEY || ''}';
`;

// config.js aktualisieren
let content = fs.readFileSync(configPath, 'utf8');
if (!content.includes('window.__SUPABASE_URL__')) {
  content = config + '\n' + content;
  fs.writeFileSync(configPath, content);
  console.log('✅ Config injiziert');
} else {
  // Vorhandene Werte ersetzen
  content = content
    .replace(/window\.__SUPABASE_URL__\s*=\s*'[^']*';/, `window.__SUPABASE_URL__ = '${process.env.SUPABASE_URL || ''}';`)
    .replace(/window\.__SUPABASE_ANON_KEY__\s*=\s*'[^']*';/, `window.__SUPABASE_ANON_KEY__ = '${process.env.SUPABASE_ANON_KEY || ''}';`)
    .replace(/window\.__STRIPE_PUBLIC_KEY__\s*=\s*'[^']*';/, `window.__STRIPE_PUBLIC_KEY__ = '${process.env.STRIPE_PUBLIC_KEY || ''}';`);
  fs.writeFileSync(configPath, content);
  console.log('✅ Config aktualisiert');
}
