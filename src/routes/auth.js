const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ─── Helpers ────────────────────────────────────────────────────────────────

function showError(formEl, message) {
  let box = formEl.querySelector('.error-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'error-box';
    box.style.cssText = `
      background: #fff0f0;
      border: 1px solid #bc0100;
      color: #bc0100;
      padding: 10px 14px;
      font-size: 13px;
      margin-bottom: 16px;
      letter-spacing: 0.5px;
    `;
    formEl.prepend(box);
  }
  box.textContent = message;
  box.style.display = 'block';
}

function showSuccess(formEl, message) {
  clearError(formEl);
  let box = formEl.querySelector('.success-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'success-box';
    box.style.cssText = `
      background: #f0fff4;
      border: 1px solid #16a34a;
      color: #15803d;
      padding: 14px 16px;
      font-size: 13px;
      margin-bottom: 16px;
      letter-spacing: 0.5px;
      line-height: 1.6;
    `;
    formEl.prepend(box);
  }
  box.innerHTML = message;
  box.style.display = 'block';
}

function clearError(formEl) {
  const box = formEl.querySelector('.error-box');
  if (box) box.style.display = 'none';
}

function setLoading(btn, isLoading, originalText) {
  btn.disabled      = isLoading;
  btn.textContent   = isLoading ? 'PLEASE WAIT...' : originalText;
  btn.style.opacity = isLoading ? '0.7' : '1';
  btn.style.cursor  = isLoading ? 'not-allowed' : 'pointer';
}

function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

// ─── Email Confirmation Handler ──────────────────────────────────────────────
// When the user clicks "Confirm your mail" in their inbox, Supabase redirects
// them back to this page with ?token_hash=XXX&type=signup in the URL.
// We detect that here, call the backend to verify it, then start their session.

function showConfirmBanner(message, isError = false) {
  let banner = document.getElementById('confirm-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'confirm-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0;
      padding: 14px 24px;
      font-size: 13px;
      letter-spacing: 0.5px;
      text-align: center;
      z-index: 9999;
    `;
    document.body.prepend(banner);
  }
  banner.style.background   = isError ? '#fff0f0' : '#f0fff4';
  banner.style.borderBottom = isError ? '2px solid #bc0100' : '2px solid #16a34a';
  banner.style.color        = isError ? '#bc0100' : '#15803d';
  banner.innerHTML = message;
}

async function handleEmailConfirmation() {
  const params = new URLSearchParams(window.location.search);
  const hash   = new URLSearchParams(window.location.hash.replace('#', ''));

  const tokenHash    = params.get('token_hash');
  const type         = params.get('type');            // 'signup'
  const accessToken  = hash.get('access_token');      // legacy PKCE flow
  const refreshToken = hash.get('refresh_token');

  // ── Newer Supabase OTP / token_hash flow ─────────────────────────────────
  if (tokenHash && type === 'signup') {
    showConfirmBanner('⏳ Confirming your email, please wait...');
    try {
      const res  = await fetch(`${API_BASE}/auth/confirm`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token_hash: tokenHash, type }),
      });
      const data = await res.json();

      if (res.ok && data.token && data.user) {
        saveSession(data.token, data.user);
        showConfirmBanner('✔ Email confirmed! Redirecting...');
        setTimeout(() => { window.location.href = 'homepage.html'; }, 1200);
      } else {
        showConfirmBanner(data.message || 'Confirmation failed. Please sign up again.', true);
      }
    } catch {
      showConfirmBanner('Network error during confirmation. Please try again.', true);
    }
    return;
  }

  // ── Older implicit / PKCE flow (access_token in URL hash) ────────────────
  if (accessToken) {
    showConfirmBanner('⏳ Setting up your session, please wait...');
    try {
      const res  = await fetch(`${API_BASE}/auth/session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
      });
      const data = await res.json();

      if (res.ok && data.token && data.user) {
        saveSession(data.token, data.user);
        showConfirmBanner('✔ Email confirmed! Redirecting...');
        setTimeout(() => { window.location.href = 'homepage.html'; }, 1200);
      } else {
        showConfirmBanner(data.message || 'Session error. Please log in manually.', true);
      }
    } catch {
      showConfirmBanner('Network error during session setup. Please try again.', true);
    }
  }
}

// Run immediately on every page load — only does something if
// Supabase confirmation params are present in the URL
handleEmailConfirmation();

// ─── Login ───────────────────────────────────────────────────────────────────

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(loginForm);

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn      = document.getElementById('login-btn');

    if (!email || !password) {
      showError(loginForm, 'Please fill in all fields.');
      return;
    }

    setLoading(btn, true, 'LOGIN');

    try {
      const res  = await fetch(`${API_BASE}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(loginForm, data.message || 'Login failed. Please try again.');
        return;
      }

      saveSession(data.token, data.user);
      window.location.href = 'homepage.html';

    } catch (err) {
      showError(loginForm, 'Network error. Please check your connection.');
    } finally {
      setLoading(btn, false, 'LOGIN');
    }
  });
}

// ─── Sign Up ─────────────────────────────────────────────────────────────────

const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(signupForm);

    const name     = document.getElementById('signup-name').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const btn      = document.getElementById('signup-btn');

    if (!name || !email || !password) {
      showError(signupForm, 'Please fill in all fields.');
      return;
    }

    if (password.length < 6) {
      showError(signupForm, 'Password must be at least 6 characters.');
      return;
    }

    setLoading(btn, true, 'SIGN UP');

    try {
      const res  = await fetch(`${API_BASE}/auth/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(signupForm, data.message || 'Registration failed. Please try again.');
        return;
      }

      // ── Case 1: Email confirmation is OFF in Supabase ─────────────────────
      // Backend returns token + user immediately → redirect to homepage
      if (data.token && data.user) {
        saveSession(data.token, data.user);
        window.location.href = 'homepage.html';
        return;
      }

      // ── Case 2: Email confirmation is ON in Supabase ──────────────────────
      // No token yet — Supabase sends the confirmation email.
      // Show a message telling the user to check their inbox.
      showSuccess(
        signupForm,
        `<strong>Almost there!</strong><br>
         We sent a confirmation email to <strong>${email}</strong>.<br>
         Click the <em>"Confirm your mail"</em> link in that email,
         then come back here to log in.`
      );

      // Lock the form so they don't submit again
      signupForm.querySelectorAll('input, button[type="submit"]')
        .forEach(el => (el.disabled = true));

    } catch (err) {
      showError(signupForm, 'Network error. Please check your connection.');
    } finally {
      setLoading(btn, false, 'SIGN UP');
    }
  });
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

const googleSignupBtn = document.getElementById('google-signup-btn');
if (googleSignupBtn) {
  googleSignupBtn.addEventListener('click', async () => {
    try {
      const res  = await fetch(`${API_BASE}/auth/google`, { method: 'GET' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Google login is not available right now.');
      }
    } catch {
      alert('Network error. Please check your connection.');
    }
  });
}

const googleLoginBtn = document.getElementById('google-login-btn');
if (googleLoginBtn) {
  googleLoginBtn.addEventListener('click', async () => {
    try {
      const res  = await fetch(`${API_BASE}/auth/google`, { method: 'GET' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Google login is not available right now.');
      }
    } catch {
      alert('Network error. Please check your connection.');
    }
  });
}