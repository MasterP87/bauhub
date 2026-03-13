-- BauHub Initial Schema
-- Migration: 001_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis"; -- for geo queries (optional, can skip if not available)

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('bauunternehmer', 'subunternehmer', 'admin')),
    company         TEXT NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    plz             TEXT NOT NULL,
    gewerke         TEXT[] DEFAULT '{}',
    description     TEXT,
    avatar_url      TEXT,
    portfolio_urls  TEXT[] DEFAULT '{}',
    rating          NUMERIC(3,2) DEFAULT 0,
    rating_count    INTEGER DEFAULT 0,
    verified        BOOLEAN DEFAULT FALSE,
    verification_file TEXT,
    premium_until   TIMESTAMPTZ,
    availability    DATE,
    ical_token      TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROJECTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    gewerke         TEXT[] NOT NULL DEFAULT '{}',
    plz             TEXT NOT NULL,
    radius          INTEGER DEFAULT 50,
    budget_min      NUMERIC(12,2),
    budget_max      NUMERIC(12,2),
    termin_from     DATE,
    termin_to       DATE,
    description     TEXT,
    photos          TEXT[] DEFAULT '{}',
    nachhaltig      BOOLEAN DEFAULT FALSE,
    status          TEXT DEFAULT 'offen' CHECK (status IN ('offen', 'in_bearbeitung', 'abgeschlossen', 'storniert')),
    matching_done   BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- APPLICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.applications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    applicant_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    message         TEXT,
    availability    DATE,
    status          TEXT DEFAULT 'ausstehend' CHECK (status IN ('ausstehend', 'akzeptiert', 'abgelehnt', 'zurueckgezogen')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, applicant_id)
);

-- ============================================================
-- MATCHES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    subunternehmer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    bauunternehmer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    ai_score        NUMERIC(5,2),
    status          TEXT DEFAULT 'vorgeschlagen' CHECK (status IN ('vorgeschlagen', 'bauunternehmer_bestaetigt', 'beide_bestaetigt', 'abgelehnt', 'abgeschlossen')),
    provision_rate  NUMERIC(5,2) DEFAULT 10.0,
    provision_amount NUMERIC(12,2),
    stripe_payment_intent TEXT,
    stripe_transfer_id TEXT,
    bauunternehmer_confirmed_at TIMESTAMPTZ,
    subunternehmer_confirmed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, subunternehmer_id)
);

-- ============================================================
-- RESOURCES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.resources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    category        TEXT NOT NULL CHECK (category IN ('maschinen', 'material', 'fahrzeuge', 'werkzeug', 'sonstiges')),
    description     TEXT,
    price_per_day   NUMERIC(10,2),
    price_type      TEXT DEFAULT 'tag' CHECK (price_type IN ('tag', 'woche', 'monat', 'einmalig')),
    plz             TEXT,
    images          TEXT[] DEFAULT '{}',
    available_from  DATE,
    available_to    DATE,
    status          TEXT DEFAULT 'verfuegbar' CHECK (status IN ('verfuegbar', 'vermietet', 'inaktiv')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FORUM POSTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forum_posts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    category        TEXT NOT NULL CHECK (category IN ('preise_kosten', 'regulierungen', 'tipps_tricks', 'nachhaltigkeit', 'allgemein')),
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    images          TEXT[] DEFAULT '{}',
    moderation_status TEXT DEFAULT 'ausstehend' CHECK (moderation_status IN ('ausstehend', 'genehmigt', 'abgelehnt')),
    moderation_note TEXT,
    ai_moderated    BOOLEAN DEFAULT FALSE,
    likes           INTEGER DEFAULT 0,
    views           INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FORUM REPLIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forum_replies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id         UUID NOT NULL REFERENCES public.forum_posts(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    moderation_status TEXT DEFAULT 'genehmigt',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    message         TEXT NOT NULL,
    read            BOOLEAN DEFAULT FALSE,
    data            JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONSENT LOG TABLE (DSGVO)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.consent_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ip_hash         TEXT,
    consent_type    TEXT NOT NULL,
    consent_given   BOOLEAN NOT NULL,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REVIEWS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reviews (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id        UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    reviewer_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    reviewed_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_id, reviewer_id)
);

-- ============================================================
-- ADMIN REPORTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    total_matches   INTEGER DEFAULT 0,
    total_provision NUMERIC(12,2) DEFAULT 0,
    total_premium   NUMERIC(12,2) DEFAULT 0,
    total_revenue   NUMERIC(12,2) DEFAULT 0,
    new_users       INTEGER DEFAULT 0,
    report_data     JSONB DEFAULT '{}',
    pdf_url         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_plz ON public.users(plz);
CREATE INDEX IF NOT EXISTS idx_users_gewerke ON public.users USING GIN(gewerke);
CREATE INDEX IF NOT EXISTS idx_users_verified ON public.users(verified);
CREATE INDEX IF NOT EXISTS idx_users_premium ON public.users(premium_until);
CREATE INDEX IF NOT EXISTS idx_projects_plz ON public.projects(plz);
CREATE INDEX IF NOT EXISTS idx_projects_gewerke ON public.projects USING GIN(gewerke);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_creator ON public.projects(creator_id);
CREATE INDEX IF NOT EXISTS idx_applications_project ON public.applications(project_id);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON public.applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_matches_project ON public.matches(project_id);
CREATE INDEX IF NOT EXISTS idx_matches_subunternehmer ON public.matches(subunternehmer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_forum_posts_category ON public.forum_posts(category, moderation_status);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER matches_updated_at BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER resources_updated_at BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER forum_posts_updated_at BEFORE UPDATE ON public.forum_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

-- USERS: Public profiles visible to all, edit only own
CREATE POLICY "users_select_all" ON public.users FOR SELECT USING (TRUE);
CREATE POLICY "users_insert_own" ON public.users FOR INSERT WITH CHECK (auth.uid() = auth_id);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (auth.uid() = auth_id);
CREATE POLICY "users_delete_own" ON public.users FOR DELETE USING (auth.uid() = auth_id);

-- PROJECTS: Public read, write only own
CREATE POLICY "projects_select_all" ON public.projects FOR SELECT USING (TRUE);
CREATE POLICY "projects_insert_own" ON public.projects FOR INSERT WITH CHECK (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = creator_id)
);
CREATE POLICY "projects_update_own" ON public.projects FOR UPDATE USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = creator_id)
);
CREATE POLICY "projects_delete_own" ON public.projects FOR DELETE USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = creator_id)
);

-- APPLICATIONS: Applicant and project creator can see
CREATE POLICY "applications_select" ON public.applications FOR SELECT USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = applicant_id)
    OR auth.uid() = (SELECT u.auth_id FROM public.users u JOIN public.projects p ON p.creator_id = u.id WHERE p.id = project_id)
);
CREATE POLICY "applications_insert_own" ON public.applications FOR INSERT WITH CHECK (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = applicant_id)
);
CREATE POLICY "applications_update_own" ON public.applications FOR UPDATE USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = applicant_id)
    OR auth.uid() = (SELECT u.auth_id FROM public.users u JOIN public.projects p ON p.creator_id = u.id WHERE p.id = project_id)
);

-- MATCHES: Only involved parties
CREATE POLICY "matches_select" ON public.matches FOR SELECT USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = subunternehmer_id)
    OR auth.uid() = (SELECT auth_id FROM public.users WHERE id = bauunternehmer_id)
);
CREATE POLICY "matches_update" ON public.matches FOR UPDATE USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = subunternehmer_id)
    OR auth.uid() = (SELECT auth_id FROM public.users WHERE id = bauunternehmer_id)
);

-- RESOURCES: Public read, write own
CREATE POLICY "resources_select_all" ON public.resources FOR SELECT USING (TRUE);
CREATE POLICY "resources_insert_own" ON public.resources FOR INSERT WITH CHECK (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = owner_id)
);
CREATE POLICY "resources_update_own" ON public.resources FOR UPDATE USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = owner_id)
);
CREATE POLICY "resources_delete_own" ON public.resources FOR DELETE USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = owner_id)
);

-- FORUM: Approved posts visible to all, own posts visible
CREATE POLICY "forum_posts_select" ON public.forum_posts FOR SELECT USING (
    moderation_status = 'genehmigt'
    OR auth.uid() = (SELECT auth_id FROM public.users WHERE id = author_id)
);
CREATE POLICY "forum_posts_insert_own" ON public.forum_posts FOR INSERT WITH CHECK (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = author_id)
);
CREATE POLICY "forum_posts_update_own" ON public.forum_posts FOR UPDATE USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = author_id)
);

-- FORUM REPLIES
CREATE POLICY "forum_replies_select" ON public.forum_replies FOR SELECT USING (TRUE);
CREATE POLICY "forum_replies_insert_own" ON public.forum_replies FOR INSERT WITH CHECK (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = author_id)
);

-- NOTIFICATIONS: Only own
CREATE POLICY "notifications_own" ON public.notifications FOR ALL USING (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = user_id)
);

-- REVIEWS: Public read, write per match
CREATE POLICY "reviews_select_all" ON public.reviews FOR SELECT USING (TRUE);
CREATE POLICY "reviews_insert_own" ON public.reviews FOR INSERT WITH CHECK (
    auth.uid() = (SELECT auth_id FROM public.users WHERE id = reviewer_id)
);

-- CONSENT LOG: Insert own, no read
CREATE POLICY "consent_log_insert" ON public.consent_log FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- SERVICE ROLE BYPASS (for Edge Functions)
-- Edge Functions use service_role key which bypasses RLS
-- ============================================================
