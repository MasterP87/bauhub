# BauHub – Vollständige Setup-Anleitung

## Übersicht der Komponenten

| Schritt | Dienst | Zeit | Kosten |
|---------|--------|------|--------|
| 1 | Supabase Projekt + DB | 30 Min | Kostenlos |
| 2 | Edge Functions deployen | 15 Min | Kostenlos |
| 3 | GitHub + Vercel/Netlify | 20 Min | Kostenlos |
| 4 | Oracle Cloud + n8n | 45 Min | Kostenlos |
| 5 | Stripe Connect | 30 Min | % pro Transaktion |
| 6 | Domain (optional) | 10 Min | ~10 €/Jahr |

---

## SCHRITT 1: Supabase einrichten

### 1.1 Projekt anlegen
1. Gehe zu https://supabase.com → "New Project"
2. Region: **eu-central-1 (Frankfurt)**
3. Datenbankpasswort notieren
4. Warte bis Projekt bereit (ca. 2 Min)

### 1.2 Projekt-Daten notieren
- Dashboard → Settings → API:
  - **Project URL** → `SUPABASE_URL`
  - **anon public** Key → `SUPABASE_ANON_KEY`
  - **service_role** Key → `SUPABASE_SERVICE_ROLE_KEY`
- Dashboard → Settings → General: **Reference ID** → `PROJECT_REF`

### 1.3 Datenbank-Schema anlegen
1. Supabase → SQL Editor → "New Query"
2. Inhalt von `supabase/migrations/001_initial_schema.sql` einfügen
3. "Run" klicken

### 1.4 Storage Bucket anlegen
1. Supabase → Storage → "New Bucket"
2. Name: `documents`, **Public: An**
3. Nochmal: Name: `avatars`, **Public: An**
4. Name: `portfolio`, **Public: An**

### 1.5 Edge Function Secrets setzen
1. Supabase → Edge Functions → Secrets
2. Diese Secrets hinzufügen:
```
STRIPE_SECRET_KEY = sk_live_...
ANTHROPIC_API_KEY = sk-ant-api03-...
SITE_URL = https://bauhub.vercel.app
ADMIN_API_KEY = (zufälliger 32-Zeichen String)
STRIPE_PREMIUM_PRICE_ID = price_...
# N8N Webhooks (nach Schritt 4 eintragen):
N8N_WEBHOOK_USER_VERIFY = https://n8n.yourdomain.com/webhook/user-verify
N8N_WEBHOOK_MATCHING = https://n8n.yourdomain.com/webhook/matching
N8N_WEBHOOK_APPLICATION = https://n8n.yourdomain.com/webhook/application
N8N_WEBHOOK_MATCH_CONFIRM = https://n8n.yourdomain.com/webhook/match-confirm
N8N_WEBHOOK_FORUM_MODERATE = https://n8n.yourdomain.com/webhook/forum-moderate
```

### 1.6 Edge Functions deployen
**Via Supabase CLI:**
```bash
# CLI installieren
npm install -g supabase

# Login
supabase login

# Alle Functions deployen
cd /pfad/zu/bauhub-site
for fn in users-register users-verify projects-create projects-apply matching-run matches-confirm premium-subscribe forum-create forum-moderate resources-create admin-report; do
  supabase functions deploy $fn --project-ref YOUR_PROJECT_REF --no-verify-jwt
done
```

**Alternativ via GitHub Actions** (automatisch bei Push auf main):
1. GitHub Repo erstellen und Code pushen
2. Secrets in GitHub Settings → Secrets hinzufügen:
   - `SUPABASE_ACCESS_TOKEN` (von https://supabase.com/dashboard/account/tokens)
   - `SUPABASE_PROJECT_REF`
   - Plus alle anderen .env.example Variablen

---

## SCHRITT 2: Website auf Vercel deployen

### 2.1 GitHub Repository
```bash
cd /home/karl/Dokumente/Bauhub/bauhub-site
git init
git add .
git commit -m "Initial BauHub commit"
git remote add origin https://github.com/IHR_NAME/bauhub.git
git push -u origin main
```

### 2.2 Vercel Setup
1. https://vercel.com → "Add New Project"
2. GitHub Repo importieren
3. Settings → Environment Variables hinzufügen:
   - `SUPABASE_URL` = `https://YOUR_PROJECT_REF.supabase.co`
   - `SUPABASE_ANON_KEY` = `eyJ...`
   - `STRIPE_PUBLIC_KEY` = `pk_live_...`
4. "Deploy" klicken

### 2.3 vercel.json anpassen
In `vercel.json`: `YOUR_PROJECT_REF` durch echten Supabase Project Ref ersetzen.

---

## SCHRITT 3: Oracle Cloud + n8n

### 3.1 Oracle Cloud Instanz
1. https://cloud.oracle.com → Kostenloser Account
2. Compute → Instances → Create Instance
3. Settings:
   - **Image**: Ubuntu 22.04 LTS
   - **Shape**: VM.Standard.A1.Flex (4 OCPU, 24 GB RAM) – Always Free!
   - **SSH Key**: Eigenen Public Key hochladen
4. Öffentliche IP notieren

### 3.2 Server vorbereiten
```bash
# SSH einloggen
ssh ubuntu@DEINE_IP

# System aktualisieren
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw

# Firewall konfigurieren
sudo ufw allow 22,80,443,5678/tcp
sudo ufw enable

# Docker installieren
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# Docker Compose Plugin
sudo apt install -y docker-compose-plugin
```

### 3.3 n8n installieren
```bash
# Verzeichnis anlegen
mkdir -p ~/n8n && cd ~/n8n

# .env Datei erstellen (Werte aus .env.example eintragen!)
nano .env

# docker-compose.yml kopieren
# (Inhalt aus n8n/docker-compose.yml einfügen)
nano docker-compose.yml

# n8n starten
docker compose up -d

# Status prüfen
docker compose ps
docker compose logs -f n8n
```

### 3.4 HTTPS mit Nginx + Let's Encrypt
```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# nginx Konfiguration (Inhalt aus n8n/nginx.conf anpassen)
sudo nano /etc/nginx/sites-available/n8n
# yourdomain.com durch echte Domain ersetzen!

sudo ln -s /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL Zertifikat
sudo certbot --nginx -d n8n.yourdomain.com
```

### 3.5 n8n Workflows importieren
1. Öffne https://n8n.yourdomain.com (Login: admin / Passwort aus .env)
2. Credentials anlegen:
   - **Supabase**: Service Role Key
   - **Stripe**: Secret Key
   - **Anthropic**: API Key
   - **E-Mail (SMTP)**: Brevo SMTP Daten
3. Workflows importieren: Menü → Import Workflow
   - Alle 8 JSON-Dateien aus `n8n/workflows/` nacheinander importieren
4. In jedem Workflow Webhooks aktivieren, URL notieren
5. Workflow auf "Active" schalten

---

## SCHRITT 4: Stripe Connect

### 4.1 Stripe Account
1. https://dashboard.stripe.com → Account erstellen
2. Connect → Get started → Platform
3. Business-Daten eingeben

### 4.2 API Keys notieren
- Developers → API Keys:
  - **Publishable Key** → `STRIPE_PUBLIC_KEY`
  - **Secret Key** → `STRIPE_SECRET_KEY`

### 4.3 Webhook einrichten
1. Developers → Webhooks → "Add endpoint"
2. URL: `https://n8n.yourdomain.com/webhook/stripe-webhook`
3. Events auswählen:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
4. Webhook Secret notieren → `STRIPE_WEBHOOK_SECRET`

### 4.4 Premium-Preis anlegen
1. Products → Create Product: "BauHub Premium"
2. Preis: 19 € / Monat
3. Price ID notieren → `STRIPE_PREMIUM_PRICE_ID`

---

## SCHRITT 5: End-to-End Test

### Test 1: Registrierung & Verifizierung
1. Öffne `https://bauhub.vercel.app/login.html`
2. Tab "Registrierung" → Als Subunternehmer registrieren
3. Testdokument hochladen (Screenshot einer Gewerbeanmeldung)
4. n8n Execution Log prüfen: Workflow "User Verification" sollte laufen
5. Supabase → users Tabelle: `verified` sollte `true` sein

### Test 2: Projekt & Matching
1. Als Bauunternehmer einloggen
2. `projekt-erstellen.html` → Projekt anlegen
3. n8n: "Project Matching" Workflow sollte 10 Subunternehmer benachrichtigen
4. Supabase → matches Tabelle: Einträge sollten vorhanden sein

### Test 3: Premium
1. Dashboard → "Jetzt upgraden"
2. Stripe Checkout öffnet sich (Test-Karte: 4242 4242 4242 4242)
3. n8n: Stripe Webhook → Premium Subscription
4. Supabase: `premium_until` gesetzt

### Test 4: Forum-Post
1. `forum.html` → Neuen Beitrag erstellen
2. n8n: Forum Moderation Workflow läuft
3. Beitrag nach ca. 5 Sek. sichtbar (KI genehmigt)

---

## SCHRITT 6: Go-Live

### Checkliste
- [ ] Stripe auf Live-Modus umschalten
- [ ] Impressum mit echten Daten ausfüllen (`impressum.html`)
- [ ] Datenschutz mit Supabase EU-Server-Adresse ergänzen (`datenschutz.html`)
- [ ] SUPABASE_URL in `vercel.json` und `netlify.toml` eingetragen
- [ ] Alle Edge Function Secrets in Supabase gesetzt
- [ ] n8n alle 8 Workflows aktiviert
- [ ] Erste 10 Beta-Nutzer einladen

### Monitoring
- n8n: `https://n8n.yourdomain.com` → Executions täglich prüfen
- Supabase: Dashboard → Reports → API Usage
- Stripe: Dashboard → Payments
- Vercel: Dashboard → Analytics

---

## Kostenkalkulation (monatlich)

| Dienst | Kostenlos bis | Danach |
|--------|---------------|--------|
| Supabase | 500 MB DB, 2 GB Storage, 5M Anfragen | $25/Monat |
| Vercel | 100 GB Bandbreite | $20/Monat |
| Oracle Cloud | Always Free (4 OCPU, 24 GB) | Immer kostenlos |
| Stripe | 0,25% + 0,10 € pro Transaktion | Pay-per-use |
| Anthropic | API-Guthaben | ~0,25 € / 1000 Moderationen |
| Brevo E-Mail | 300 E-Mails/Tag | $9/Monat |
| **Gesamt** | **0 € bis ~2000 User** | **~55 €/Monat** |

---

## Support

Bei Problemen:
- Supabase Logs: Dashboard → Logs → Edge Functions
- n8n Logs: `docker compose logs -f n8n`
- Vercel: Dashboard → Deployments → Build Logs
