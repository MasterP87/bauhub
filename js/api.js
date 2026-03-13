/**
 * BauHub - API Client
 * Wrapping aller Supabase Edge Function Aufrufe
 */

const BauHubAPI = (() => {
  const getConfig = () => window.BauHubConfig?.supabase || {};
  const getToken = () => localStorage.getItem('bauhub_token') || '';

  async function call(endpoint, data = {}, options = {}) {
    const config = getConfig();
    const url = `${config.functionsUrl}/${endpoint}`;
    const token = getToken();

    const headers = {
      'Content-Type': 'application/json',
      'apikey': config.anonKey,
    };

    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.serviceRole) headers['Authorization'] = `Bearer ${config.serviceRoleKey}`;

    try {
      const res = await fetch(url, {
        method: options.method || 'POST',
        headers,
        body: options.method === 'GET' ? undefined : JSON.stringify(data),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      return { data: json, error: null };
    } catch (err) {
      console.error(`[BauHubAPI] ${endpoint} Fehler:`, err.message);
      return { data: null, error: err.message };
    }
  }

  async function get(endpoint, params = {}) {
    const config = getConfig();
    const qs = new URLSearchParams(params).toString();
    const url = `${config.functionsUrl}/${endpoint}${qs ? '?' + qs : ''}`;
    const token = getToken();

    const headers = { 'apikey': config.anonKey };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(url, { method: 'GET', headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return { data: json, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  }

  // Supabase REST API (für Datenbankabfragen)
  async function db(table, method = 'GET', body = null, params = {}) {
    const config = getConfig();
    const qs = new URLSearchParams(params).toString();
    const url = `${config.url}/rest/v1/${table}${qs ? '?' + qs : ''}`;
    const token = getToken();

    const headers = {
      'apikey': config.anonKey,
      'Authorization': token ? `Bearer ${token}` : `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : [];
  }

  return {
    // Auth
    auth: {
      async login(email, password) {
        const config = getConfig();
        const res = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { 'apikey': config.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (data.access_token) {
          localStorage.setItem('bauhub_token', data.access_token);
          localStorage.setItem('bauhub_user', JSON.stringify(data.user));
          localStorage.setItem('bauhub_expires', data.expires_at || '');
          return { data, error: null };
        }
        return { data: null, error: data.error_description || data.msg || 'Login fehlgeschlagen' };
      },

      async logout() {
        const config = getConfig();
        const token = getToken();
        await fetch(`${config.url}/auth/v1/logout`, {
          method: 'POST',
          headers: { 'apikey': config.anonKey, 'Authorization': `Bearer ${token}` },
        }).catch(() => {});
        localStorage.removeItem('bauhub_token');
        localStorage.removeItem('bauhub_user');
        localStorage.removeItem('bauhub_expires');
        window.location.href = '/login.html';
      },

      getUser() {
        const u = localStorage.getItem('bauhub_user');
        return u ? JSON.parse(u) : null;
      },

      isLoggedIn() {
        return !!getToken();
      },

      redirectIfNotLoggedIn() {
        if (!getToken()) {
          window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
        }
      },
    },

    // Nutzer
    users: {
      register: (data) => call('users-register', data),
      verify: (data) => call('users-verify', data),
      async getProfile(userId) {
        const config = getConfig();
        const token = getToken();
        const res = await fetch(`${config.url}/rest/v1/users?id=eq.${userId}&select=*`, {
          headers: { 'apikey': config.anonKey, 'Authorization': `Bearer ${token || config.anonKey}` },
        });
        return res.ok ? await res.json() : [];
      },
      async updateProfile(userId, data) {
        const config = getConfig();
        const token = getToken();
        const res = await fetch(`${config.url}/rest/v1/users?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': config.anonKey,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(data),
        });
        return res.ok ? (await res.json())[0] : null;
      },
    },

    // Projekte
    projects: {
      create: (data) => call('projects-create', data),
      apply: (data) => call('projects-apply', data),
      async list(params = {}) {
        const config = getConfig();
        const qs = new URLSearchParams({
          select: '*,users(company,plz,rating,verified)',
          status: 'eq.offen',
          order: 'created_at.desc',
          limit: '20',
          ...params,
        }).toString();
        const res = await fetch(`${config.url}/rest/v1/projects?${qs}`, {
          headers: { 'apikey': config.anonKey },
        });
        return res.ok ? await res.json() : [];
      },
    },

    // Matches
    matches: {
      confirm: (data) => call('matches-confirm', data),
      async list() {
        const config = getConfig();
        const token = getToken();
        const res = await fetch(`${config.url}/rest/v1/matches?select=*,projects(*),users!matches_subunternehmer_id_fkey(company,rating)&order=created_at.desc`, {
          headers: { 'apikey': config.anonKey, 'Authorization': `Bearer ${token}` },
        });
        return res.ok ? await res.json() : [];
      },
    },

    // Premium
    premium: {
      subscribe: (data) => call('premium-subscribe', data),
    },

    // Forum
    forum: {
      create: (data) => call('forum-create', data),
      moderate: (data) => call('forum-moderate', data),
      async list(category = '') {
        const config = getConfig();
        const params = new URLSearchParams({
          select: '*,users(company,avatar_url)',
          moderation_status: 'eq.genehmigt',
          order: 'created_at.desc',
          limit: '30',
        });
        if (category) params.set('category', `eq.${category}`);
        const res = await fetch(`${config.url}/rest/v1/forum_posts?${params}`, {
          headers: { 'apikey': config.anonKey },
        });
        return res.ok ? await res.json() : [];
      },
    },

    // Ressourcen
    resources: {
      create: (data) => call('resources-create', data),
      list: (params) => get('resources-create', params),
    },

    // Benachrichtigungen
    notifications: {
      async list() {
        const config = getConfig();
        const token = getToken();
        if (!token) return [];
        const res = await fetch(`${config.url}/rest/v1/notifications?read=eq.false&order=created_at.desc&limit=20`, {
          headers: { 'apikey': config.anonKey, 'Authorization': `Bearer ${token}` },
        });
        return res.ok ? await res.json() : [];
      },
      async markRead(id) {
        const config = getConfig();
        const token = getToken();
        await fetch(`${config.url}/rest/v1/notifications?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'apikey': config.anonKey,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ read: true }),
        });
      },
    },

    // Verzeichnis (Subunternehmer suchen)
    directory: {
      async search({ gewerke, plz, radius = 50, minRating = 0, verified = false } = {}) {
        const config = getConfig();
        const params = new URLSearchParams({
          select: '*',
          role: 'eq.subunternehmer',
          order: 'premium_until.desc.nullslast,rating.desc',
          limit: '30',
        });
        if (verified) params.set('verified', 'eq.true');
        if (minRating > 0) params.set('rating', `gte.${minRating}`);

        const res = await fetch(`${config.url}/rest/v1/users?${params}`, {
          headers: { 'apikey': config.anonKey },
        });
        if (!res.ok) return [];

        let results = await res.json();

        // PLZ/Radius Filter (client-seitig)
        if (plz && radius) {
          results = results.filter(u => {
            const dist = Math.abs(parseInt(u.plz?.substring(0, 2) || '0') - parseInt(plz.substring(0, 2))) * 8;
            return dist <= radius;
          });
        }

        // Gewerk-Filter
        if (gewerke?.length) {
          results = results.filter(u =>
            u.gewerke?.some(g => gewerke.some(sg => g.toLowerCase().includes(sg.toLowerCase())))
          );
        }

        return results;
      },
    },

    // Admin
    admin: {
      report: (data) => call('admin-report', data),
    },
  };
})();

window.BauHubAPI = BauHubAPI;
