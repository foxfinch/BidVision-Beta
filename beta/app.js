/**
 * BidVision download page
 * State machine: register -> downloads
 *
 * Signing up (name, email, base) unlocks the downloads straight away. There is no access
 * code. The platform is detected from the browser, not asked.
 */

// === Configuration ===

// Apps Script web app URL (pinned production deployment; apps-script/deploy.sh checks this)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyjy2oY1J3wHCe1TUKbeEmWIgA7GXzkwb4R3J0TPVNG5Hmt3W8ElmlQcmN2kaW_xImoOg/exec';

// Download URLs: current cut = v0.2.0-b10 on foxfinch/BidVision-Beta (published 2026-11-09).
// Asset names read off the published release. b10 ships macOS (Apple Silicon + Intel),
// Windows and Android here; iPhone and iPad come through the public TestFlight link
// hardcoded in beta/index.html. No Linux.
//
// TO BUMP A RELEASE: change RELEASE below and nothing else. Every asset name derives from it.
//
// Leaving this stale is not cosmetic. Builds carry a baked expiry (b10: 2027-11-20); the
// in-app wall sends people to /continue, which sends them here. If this still points at the
// previous build, they download the very binary they came here to escape.
const RELEASE = '0.2.0-b10';
const BASE = `https://github.com/foxfinch/BidVision-Beta/releases/download/v${RELEASE}`;
const DOWNLOADS = {
  'mac-arm':   `${BASE}/BidVision-macOS-Apple-Silicon-${RELEASE}.zip`,
  'mac-intel': `${BASE}/BidVision-macOS-Intel-${RELEASE}.zip`,
  'windows':   `${BASE}/BidVision-Windows-${RELEASE}.exe`,
  'android':   `${BASE}/BidVision-Android-${RELEASE}.apk`,
};

// === State management ===
const STATES = ['register', 'downloads'];

function showState(name) {
  STATES.forEach(s => {
    const el = document.getElementById(`state-${s}`);
    if (el) el.classList.toggle('active', s === name);
  });
}

function getState() {
  // Anyone who has signed up on this browser before (beta testers: bidvision_beta /
  // bidvision_registered; wind-down notify list: bidvision_notify) already has their
  // details on file, so they go straight to the downloads.
  const signedUp = ['bidvision_signedup', 'bidvision_beta', 'bidvision_registered', 'bidvision_notify']
    .some(k => localStorage.getItem(k) === 'true');
  return signedUp && localStorage.getItem('bidvision_email') ? 'downloads' : 'register';
}

// === Apps Script submission (fire-and-forget via fetch no-cors) ===
function submitToGAS(data) {
  // Local preview (python3 -m http.server): never touch the live sheet or send a real email.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    console.info('Local preview, not sent to the signup backend:', data);
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
// Returns one of: mac-arm, mac-intel, mac (chip unknown), windows, android, ios, linux, or null.
function detectPlatform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'ios';
  if (/iPad/.test(ua)) return 'ios';
  // iPadOS Safari reports itself as a Mac; a touch screen gives it away.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua)) return detectMacType() || 'mac';
  if (/CrOS|Linux/.test(ua)) return 'linux';
  return null;
}

function detectMacType() {
  // WebGL renderer works in all browsers including Safari
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
  return null;  // can't tell which chip: don't recommend either
}

// Human-readable label stored with the signup (the sheet's Platform column).
const PLATFORM_LABELS = {
  'mac-arm': 'macOS (Apple Silicon)',
  'mac-intel': 'macOS (Intel)',
  'mac': 'macOS',
  'windows': 'Windows',
  'android': 'Android',
  'ios': 'iPhone / iPad',
  'linux': 'Linux / ChromeOS',
};

function highlightPlatform(platform) {
  document.querySelectorAll('.download-btn').forEach(btn => {
    btn.classList.remove('recommended');
    const badge = btn.querySelector('.badge');
    if (badge) badge.remove();
  });

  const btn = platform && document.getElementById(`dl-${platform}`);
  if (btn) {
    btn.classList.add('recommended');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Your device';
    btn.appendChild(badge);
  }

  // Device-specific notes: SmartScreen for Windows, "no build" for iPhone/iPad and Linux.
  const show = (sel, on) => {
    const el = document.querySelector(sel);
    if (el) el.style.display = on ? '' : 'none';
  };
  show('.smartscreen-warning', platform === 'windows');
  show('#no-build-linux', platform === 'linux');
}

function setDownloadLinks() {
  Object.entries(DOWNLOADS).forEach(([platform, url]) => {
    const btn = document.getElementById(`dl-${platform}`);
    if (btn && url) btn.href = url;
  });
}

// === Collapsible sections ===
function initCollapsible() {
  const toggle = document.getElementById('install-toggle');
  const content = document.getElementById('install-content');
  if (toggle && content) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      content.classList.toggle('open');
    });
  }

  const macToggle = document.getElementById('mac-help-toggle');
  const macContent = document.getElementById('mac-help-content');
  if (macToggle && macContent) {
    macToggle.addEventListener('click', () => {
      macContent.classList.toggle('open');
    });
  }
}

// === Registration ===
function initRegistrationForm() {
  const form = document.getElementById('register-form');
  const errorEl = document.getElementById('register-error');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.classList.remove('visible');

    const platform = detectPlatform();
    const data = {
      action: 'register',
      name: document.getElementById('reg-name').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      base: document.getElementById('reg-base').value,
      platform: PLATFORM_LABELS[platform] || 'Unknown',
    };

    if (!data.name || !data.email || !data.base) {
      errorEl.textContent = 'Please fill in your name, email and base.';
      errorEl.classList.add('visible');
      return;
    }

    submitToGAS(data);

    localStorage.setItem('bidvision_signedup', 'true');
    localStorage.setItem('bidvision_name', data.name);
    localStorage.setItem('bidvision_email', data.email);
    showDownloads();
  });
}

function showDownloads() {
  showState('downloads');
  highlightPlatform(detectPlatform());
  const name = localStorage.getItem('bidvision_name');
  const title = document.getElementById('downloads-title');
  if (name && title) title.textContent = `Thanks, ${name}. Here's BidVision.`;
}

// === Download attribution (fire-and-forget; email already in localStorage) ===
// Logs who downloaded what and when to the Beta Tracker's Downloads tab. Disclosed on the
// page and in the privacy policy. Reads the version from the button's href.
function initDownloadTracking() {
  document.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = btn.dataset.platform || (btn.id || '').replace(/^dl-/, '');
      const verMatch = (btn.href || '').match(/(\d+\.\d+\.\d+-b\d+)/);
      submitToGAS({
        action: 'download',
        email: localStorage.getItem('bidvision_email') || '',
        platform: platform,
        version: verMatch ? verMatch[1] : (platform === 'ios' ? 'TestFlight' : ''),
      });
    });
  });
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  initRegistrationForm();
  initCollapsible();
  setDownloadLinks();
  initDownloadTracking();

  if (getState() === 'downloads') {
    showDownloads();
  } else {
    showState('register');
  }
});
