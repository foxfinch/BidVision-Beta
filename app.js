/**
 * BidVision Beta Landing Page
 * State machine: register → registered → code → downloads → expired
 */

// === Configuration ===
// SHA-256 hashes of valid beta codes (add new months here)
const VALID_CODE_HASHES = {
  '64a8f99b4b1114f67be79ed768041dc017dff6f3ee56e3e3d8c09e6e49eb8ce4': 'BID-0426',
  // Add future months:
  // 'hash_here': 'BID-0526',
  // 'hash_here': 'BID-0626',
};

// Apps Script web app URL (set after deployment)
const GAS_URL = '__APPS_SCRIPT_URL__';

// Download URLs (update per release)
const DOWNLOADS = {
  'mac-arm':  '__MAC_ARM_URL__',
  'mac-intel': '__MAC_INTEL_URL__',
  'windows':  '__WINDOWS_URL__',
};

// === State management ===
const STATES = ['register', 'registered', 'code', 'downloads', 'expired'];

function showState(name) {
  STATES.forEach(s => {
    const el = document.getElementById(`state-${s}`);
    if (el) el.classList.toggle('active', s === name);
  });
}

function getState() {
  if (localStorage.getItem('bidvision_beta') === 'true') return 'downloads';
  if (localStorage.getItem('bidvision_registered') === 'true') return 'registered';
  return 'register';
}

// === SHA-256 hashing ===
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateCode(input) {
  const normalized = input.trim().toUpperCase();
  const hash = await sha256(normalized);
  if (VALID_CODE_HASHES[hash]) {
    return { valid: true, code: VALID_CODE_HASHES[hash] };
  }
  return { valid: false, code: null };
}

// === Apps Script submission (fire-and-forget via hidden iframe) ===
function submitToGAS(data) {
  if (GAS_URL === '__APPS_SCRIPT_URL__') {
    console.warn('Apps Script URL not configured — skipping submission');
    return;
  }

  try {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = GAS_URL;
    form.target = 'gas-frame';

    // Send as a single JSON field (Apps Script will parse e.parameter.data)
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'data';
    input.value = JSON.stringify(data);
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  } catch (err) {
    console.error('GAS submission error:', err);
  }
}

// === Platform detection ===
function detectPlatform() {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua)) return 'mac-arm'; // Default to ARM for modern Macs
  return null;
}

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function highlightPlatform() {
  const platform = detectPlatform();
  if (!platform) return;

  document.querySelectorAll('.download-btn').forEach(btn => {
    btn.classList.remove('recommended');
    const badge = btn.querySelector('.badge');
    if (badge) badge.remove();
  });

  const btn = document.getElementById(`dl-${platform}`);
  if (btn) {
    btn.classList.add('recommended');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Recommended';
    btn.appendChild(badge);
  }
}

function setDownloadLinks() {
  Object.entries(DOWNLOADS).forEach(([platform, url]) => {
    const btn = document.getElementById(`dl-${platform}`);
    if (btn && url && !url.startsWith('__')) {
      btn.href = url;
    }
  });
}

// === Collapsible sections ===
function initCollapsible() {
  // Install instructions
  const toggle = document.getElementById('install-toggle');
  const content = document.getElementById('install-content');
  if (toggle && content) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      content.classList.toggle('open');
    });
  }

  // Mac help
  const macToggle = document.getElementById('mac-help-toggle');
  const macContent = document.getElementById('mac-help-content');
  if (macToggle && macContent) {
    macToggle.addEventListener('click', () => {
      macContent.classList.toggle('open');
    });
  }
}

// === Form handlers ===
function initRegistrationForm() {
  const form = document.getElementById('register-form');
  const errorEl = document.getElementById('register-error');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.classList.remove('visible');

    const data = {
      action: 'register',
      name: document.getElementById('reg-name').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      base: document.getElementById('reg-base').value,
      platform: document.querySelector('input[name="platform"]:checked')?.value || '',
      phone: document.getElementById('reg-phone').value.trim(),
      smsOptIn: document.getElementById('reg-sms').checked,
    };

    if (!data.name || !data.email || !data.base || !data.platform) {
      errorEl.textContent = 'Please fill in all required fields.';
      errorEl.classList.add('visible');
      return;
    }

    // Submit to Apps Script
    submitToGAS(data);

    // Save state and show confirmation
    localStorage.setItem('bidvision_registered', 'true');
    localStorage.setItem('bidvision_name', data.name);
    showState('registered');
  });
}

function initCodeForms() {
  // Code form on registered state
  const codeFormRegistered = document.getElementById('code-form-registered');
  if (codeFormRegistered) {
    const input = codeFormRegistered.querySelector('.code-input');
    const error = codeFormRegistered.querySelector('.code-error');

    codeFormRegistered.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.classList.remove('visible');
      const result = await validateCode(input.value);
      if (result.valid) {
        localStorage.setItem('bidvision_beta', 'true');
        localStorage.setItem('bidvision_code', result.code);

        // Notify Apps Script of code redemption
        submitToGAS({
          action: 'redeem',
          email: localStorage.getItem('bidvision_email') || '',
          code: result.code,
        });

        showState('downloads');
        highlightPlatform();
        showMobileNotice();
      } else {
        error.textContent = 'Invalid code — double-check your welcome email.';
        error.classList.add('visible');
      }
    });
  }

  // Direct code entry form (returning user / shared code)
  const codeFormDirect = document.getElementById('code-form-direct');
  if (codeFormDirect) {
    codeFormDirect.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('code-direct-error');
      errorEl.classList.remove('visible');

      const email = document.getElementById('code-email').value.trim();
      const codeInput = document.getElementById('code-direct');
      const result = await validateCode(codeInput.value);

      if (!email) {
        errorEl.textContent = 'Please enter your email.';
        errorEl.classList.add('visible');
        return;
      }

      if (result.valid) {
        localStorage.setItem('bidvision_beta', 'true');
        localStorage.setItem('bidvision_code', result.code);
        localStorage.setItem('bidvision_email', email);

        // Notify Apps Script (handles both returning users and shared codes)
        submitToGAS({
          action: 'code_entry',
          email: email,
          code: result.code,
        });

        showState('downloads');
        highlightPlatform();
        showMobileNotice();
      } else {
        errorEl.textContent = 'Invalid code — double-check your welcome email.';
        errorEl.classList.add('visible');
      }
    });
  }
}

function showMobileNotice() {
  if (isMobile()) {
    const notice = document.getElementById('mobile-notice');
    if (notice) notice.classList.add('show');
  }
}

// === Toggle between register and code entry ===
function initToggles() {
  const showCode = document.getElementById('show-code-entry');
  const showReg = document.getElementById('show-register');

  if (showCode) {
    showCode.addEventListener('click', () => showState('code'));
  }
  if (showReg) {
    showReg.addEventListener('click', () => showState('register'));
  }
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  const state = getState();
  showState(state);

  initRegistrationForm();
  initCodeForms();
  initToggles();
  initCollapsible();
  setDownloadLinks();

  if (state === 'downloads') {
    highlightPlatform();
    showMobileNotice();
  }

  // Personalize registered state
  const name = localStorage.getItem('bidvision_name');
  if (name) {
    const title = document.getElementById('registered-title');
    if (title) title.textContent = `You're on the list, ${name}!`;
  }
});
