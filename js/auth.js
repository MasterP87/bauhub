/**
 * BauHub - Auth & Session Helpers
 */

const BauHubAuth = (() => {
  // Gespeichertes Nutzerprofil aus DB laden
  async function loadUserProfile() {
    const u = localStorage.getItem('bauhub_user');
    if (!u) return null;

    const authUser = JSON.parse(u);
    const config = window.BauHubConfig?.supabase;
    if (!config) return null;

    const token = localStorage.getItem('bauhub_token');
    const res = await fetch(`${config.url}/rest/v1/users?auth_id=eq.${authUser.id}&select=*`, {
      headers: {
        'apikey': config.anonKey,
        'Authorization': `Bearer ${token}`,
      },
    }).catch(() => null);

    if (!res?.ok) return null;
    const profiles = await res.json();
    const profile = profiles[0] || null;

    if (profile) {
      localStorage.setItem('bauhub_profile', JSON.stringify(profile));
    }
    return profile;
  }

  function getProfile() {
    const p = localStorage.getItem('bauhub_profile');
    return p ? JSON.parse(p) : null;
  }

  function isPremium() {
    const p = getProfile();
    if (!p?.premium_until) return false;
    return new Date(p.premium_until) > new Date();
  }

  // Navigation aktualisieren basierend auf Login-Status
  function updateNav() {
    const isLoggedIn = !!localStorage.getItem('bauhub_token');
    const profile = getProfile();

    // Login/Logout Links
    document.querySelectorAll('[data-auth-show]').forEach(el => {
      const show = el.dataset.authShow;
      el.style.display = (show === 'logged-in' && isLoggedIn) || (show === 'logged-out' && !isLoggedIn)
        ? '' : 'none';
    });

    // Nutzername anzeigen
    document.querySelectorAll('[data-user-company]').forEach(el => {
      el.textContent = profile?.company || '';
    });

    // Premium Badge
    if (isPremium()) {
      document.querySelectorAll('[data-premium-badge]').forEach(el => {
        el.style.display = '';
      });
    }

    // Notifications Badge
    if (isLoggedIn) {
      loadNotificationCount();
    }
  }

  async function loadNotificationCount() {
    const count = await window.BauHubAPI?.notifications.list()
      .then(n => n.length).catch(() => 0);

    document.querySelectorAll('[data-notification-count]').forEach(el => {
      el.textContent = count > 0 ? count.toString() : '';
      el.style.display = count > 0 ? '' : 'none';
    });
  }

  // Cookie Consent (DSGVO)
  function initCookieConsent() {
    if (localStorage.getItem('cookie_consent')) return;

    const banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; background: #003087;
      color: white; padding: 1rem 2rem; z-index: 9999; display: flex;
      align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
    `;
    banner.innerHTML = `
      <p style="margin:0;font-size:0.875rem">
        Diese Website verwendet technisch notwendige Cookies.
        <a href="/datenschutz.html" style="color:#90caf9">Datenschutz</a>
      </p>
      <div style="display:flex;gap:0.5rem">
        <button id="cookie-accept" style="background:#00A651;color:white;border:none;padding:0.5rem 1rem;border-radius:4px;cursor:pointer">Akzeptieren</button>
        <button id="cookie-decline" style="background:transparent;color:white;border:1px solid white;padding:0.5rem 1rem;border-radius:4px;cursor:pointer">Ablehnen</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('cookie-accept').onclick = () => {
      localStorage.setItem('cookie_consent', 'accepted');
      banner.remove();
      logConsent(true);
    };
    document.getElementById('cookie-decline').onclick = () => {
      localStorage.setItem('cookie_consent', 'declined');
      banner.remove();
      logConsent(false);
    };
  }

  async function logConsent(given) {
    const config = window.BauHubConfig?.supabase;
    if (!config) return;
    await fetch(`${config.url}/rest/v1/consent_log`, {
      method: 'POST',
      headers: {
        'apikey': config.anonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        consent_type: 'cookies',
        consent_given: given,
        user_agent: navigator.userAgent.substring(0, 200),
      }),
    }).catch(() => {});
  }

  // Toast-Benachrichtigungen
  function toast(message, type = 'info', duration = 4000) {
    const existing = document.getElementById('bauhub-toast');
    if (existing) existing.remove();

    const colors = { success: '#00A651', error: '#dc2626', info: '#003087', warning: '#d97706' };
    const toast = document.createElement('div');
    toast.id = 'bauhub-toast';
    toast.style.cssText = `
      position: fixed; top: 5rem; right: 1rem; background: ${colors[type] || colors.info};
      color: white; padding: 0.875rem 1.25rem; border-radius: 8px; z-index: 10000;
      max-width: 360px; font-size: 0.875rem; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;

    const style = document.createElement('style');
    style.textContent = '@keyframes slideIn { from { transform: translateX(120%); } to { transform: translateX(0); } }';
    document.head.appendChild(style);
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), duration);
    return toast;
  }

  // Formular-Validierung
  function validateForm(formEl) {
    let valid = true;
    formEl.querySelectorAll('[required]').forEach(field => {
      if (!field.value.trim()) {
        field.style.borderColor = '#dc2626';
        valid = false;
      } else {
        field.style.borderColor = '';
      }
    });
    return valid;
  }

  // Loading-State für Buttons
  function setLoading(btn, loading, text = '') {
    if (loading) {
      btn.dataset.originalText = btn.textContent;
      btn.textContent = text || 'Wird verarbeitet...';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.originalText || btn.textContent;
      btn.disabled = false;
    }
  }

  // Initialisierung beim Laden
  function init() {
    document.addEventListener('DOMContentLoaded', () => {
      updateNav();
      initCookieConsent();

      // Logout-Handler
      document.querySelectorAll('[data-logout]').forEach(el => {
        el.onclick = (e) => {
          e.preventDefault();
          window.BauHubAPI?.auth.logout();
        };
      });
    });
  }

  init();

  return {
    loadUserProfile,
    getProfile,
    isPremium,
    updateNav,
    toast,
    validateForm,
    setLoading,
  };
})();

window.BauHubAuth = BauHubAuth;
