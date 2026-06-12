/**
 * BidVision Beta Landing Page
 * State machine: register → registered → code → downloads → expired
 */

// === Configuration ===
// Beta codes auto-roll by month: BID-MMYY. validateCode() accepts the current
// "bid month" plus a small window (see bidCodeFor / CODE_ACCEPT_OFFSETS), so there's
// no monthly redeploy. These older codes also stay valid forever, kept as SHA-256
// hashes so they don't appear in source:
const VALID_CODE_HASHES = new Set([
  '64a8f99b4b1114f67be79ed768041dc017dff6f3ee56e3e3d8c09e6e49eb8ce4', // BID-0426 (April 2026)
  '50ff672a154bb5466306149b200530576c2ffabef4a7c93884c447e94e9ed112', // BID-0726 (July 2026 bids)
]);

// Auto-rolling monthly window. bidCodeFor(now, 1) = next calendar month (the bid
// month). Accept previous month through +2 months so codes a month stale or early
// still unlock. Mirrors currentBetaCode() in apps-script/Code.gs.
const CODE_ACCEPT_OFFSETS = [-1, 0, 1, 2];
function bidCodeFor(date, offsetMonths) {
  const d = new Date(date.getFullYear(), date.getMonth() + offsetMonths, 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return 'BID-' + mm + yy;
}

// Apps Script web app URL (set after deployment)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyjy2oY1J3wHCe1TUKbeEmWIgA7GXzkwb4R3J0TPVNG5Hmt3W8ElmlQcmN2kaW_xImoOg/exec';

// Download URLs — LAUNCH = v0.2.0-b8 on foxfinch/BidVision-Beta (published 2026-06-11).
// Names read off the published release (no guessing). Linux ships amd64 + arm64.
// All platforms now on b8 (Windows installer uploaded 2026-06-12; was a b6 fallback at launch).
// iOS has NO URL — invite-only via TestFlight (email path in the UI).
const B8 = 'https://github.com/foxfinch/BidVision-Beta/releases/download/v0.2.0-b8';
const DOWNLOADS = {
  'mac-arm':      `${B8}/BidVision-macOS-Apple-Silicon-0.2.0-b8.zip`,
  'mac-intel':    `${B8}/BidVision-macOS-Intel-0.2.0-b8.zip`,
  'windows':      `${B8}/BidVision-Windows-0.2.0-b8.exe`,
  'linux':        `${B8}/BidVision-Linux-amd64-0.2.0-b8.deb`,
  'linux-arm64':  `${B8}/BidVision-Linux-arm64-0.2.0-b8.deb`,
  'android':      `${B8}/BidVision-Android-0.2.0-b8.apk`,
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
  // 1) Grandfathered codes (hashed)
  const hash = await sha256(normalized);
  if (VALID_CODE_HASHES.has(hash)) {
    return { valid: true, code: normalized };
  }
  // 2) Auto-rolling monthly window
  const now = new Date();
  if (CODE_ACCEPT_OFFSETS.some(k => bidCodeFor(now, k) === normalized)) {
    return { valid: true, code: normalized };
  }
  return { valid: false, code: null };
}

// === Apps Script submission (fire-and-forget via fetch no-cors) ===
function submitToGAS(data) {
  if (GAS_URL === '__APPS_SCRIPT_URL__') {
    console.warn('Apps Script URL not configured — skipping submission');
    return;
  }

  try {
    fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,  // survive a navigation/unload (e.g. download click)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data),
    }).catch(err => console.error('GAS submission error:', err));
  } catch (err) {
    console.error('GAS submission error:', err);
  }
}

// === Platform detection ===
function detectPlatform() {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua)) return detectMacType();
  if (/CrOS/.test(ua)) return 'linux';                          // ChromeOS
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';  // desktop Linux (Android handled as mobile)
  return null;
}

function detectMacType() {
  // Try WebGL renderer (works in all browsers including Safari)
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (/Apple M\d/i.test(renderer)) return 'mac-arm';
        if (/Intel/i.test(renderer)) return 'mac-intel';
      }
    }
  } catch (e) { /* fall through */ }

  // Can't determine — don't recommend either
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

  // Show SmartScreen warning only for Windows users
  const ssWarning = document.querySelector('.smartscreen-warning');
  if (ssWarning) {
    ssWarning.style.display = (platform === 'windows') ? '' : 'none';
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

  // Linux help (amd64 vs arm64)
  const linuxToggle = document.getElementById('linux-help-toggle');
  const linuxContent = document.getElementById('linux-help-content');
  if (linuxToggle && linuxContent) {
    linuxToggle.addEventListener('click', () => {
      linuxContent.classList.toggle('open');
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
    localStorage.setItem('bidvision_email', data.email);
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
  // Mobile users are no longer trapped — BidVision now has iOS (TestFlight) and
  // Android (.apk) paths. On a phone/tablet, surface the hint that points at the
  // "On your phone or tablet" section; leave the desktop builds visible too
  // (many testers are on a computer and a tablet/phone is their second device).
  if (isMobile()) {
    const hint = document.getElementById('mobile-hint');
    if (hint) hint.style.display = '';
  }
}

// === Download attribution (fire-and-forget; email already in localStorage) ===
// Logs who downloaded what/when to the Beta Tracker. Reads the asset version from
// the button's href so per-platform differences (e.g. Windows on a fallback build)
// are captured accurately. iOS has no .download-btn (it's an email invite), so it's
// naturally excluded.
function initDownloadTracking() {
  document.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = btn.dataset.platform || (btn.id || '').replace(/^dl-/, '');
      const verMatch = (btn.href || '').match(/(\d+\.\d+\.\d+-b\d+)/);
      submitToGAS({
        action: 'download',
        email: localStorage.getItem('bidvision_email') || '',
        platform: platform,
        version: verMatch ? verMatch[1] : '',
      });
    });
  });
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
  initDownloadTracking();

  // Show SmartScreen warning for Windows users on downloads page
  const platform = detectPlatform();
  const ssWarningInit = document.querySelector('.smartscreen-warning');
  if (ssWarningInit && platform === 'windows') {
    ssWarningInit.style.display = '';
  }

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
