const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ─── Helpers ────────────────────────────────────────────────────────────────

function showError(formEl, message) {
  let box = formEl.querySelector('.error-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'error-box';
    formEl.prepend(box);
  }
  box.textContent = message;
  box.style.display = 'block';
}

function clearError(formEl) {
  const box = formEl.querySelector('.error-box');
  if (box) box.style.display = 'none';
}

function setLoading(btn, isLoading, originalText) {
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'PLEASE WAIT...' : originalText;
}

function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

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

      saveSession(data.token, data.user);
      window.location.href = 'homepage.html';

    } catch (err) {
      showError(signupForm, 'Network error. Please check your connection.');
    } finally {
      setLoading(btn, false, 'SIGN UP');
    }
  });
}