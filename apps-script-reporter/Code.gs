/**
 * BidVision Download Counts — daily GitHub Releases snapshot
 *
 * Standalone Apps Script (owned by jameson@foxfinch.co). Kept SEPARATE from the
 * beta signup web app on purpose: this needs the external-request scope (to call
 * GitHub), and adding that to the live signup script would force a re-auth on the
 * path testers actually hit. This one just reads public release download counts
 * and appends them to the Beta Tracker — no web app, nothing user-facing.
 *
 * One-time setup: open this project, Run → createDailyTrigger (authorize when asked).
 * That installs a daily trigger AND writes the first snapshot immediately.
 *
 * GitHub auth: Apps Script runs from a SHARED Google egress IP, so GitHub's
 * unauthenticated limit (60/hr, pooled across all Apps Script projects on that IP)
 * is unreliable. Add a read-only GitHub token to make calls authenticated (5000/hr,
 * own quota): Project Settings → Script Properties → add  GH_TOKEN = <token>.
 * A fine-grained PAT scoped to foxfinch/BidVision-Beta with Contents:Read is plenty;
 * even a no-scope token lifts you to the authenticated limit. Optional but recommended.
 */

const REPORTER = {
  SHEET_ID: '1nfBx1L0yo4j20qjsfcP4mnaveSe0oQt5uz-78egYqNI',  // BidVision Beta Tracker
  RELEASES_API: 'https://api.github.com/repos/foxfinch/BidVision-Beta/releases',
  TAB: 'Download Counts',
  TZ: 'America/New_York',
  HOUR: 7,  // ~7am ET
};

// Builds request headers, adding GitHub auth if a GH_TOKEN script property is set.
function ghHeaders_() {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'BidVision-Beta-Tracker' };
  const token = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (token) headers['Authorization'] = 'Bearer ' + token.trim();
  return headers;
}

// Appends one row per (release asset) with its cumulative download_count, stamped
// with today's date. Diff consecutive days to see per-asset deltas (actual grabs).
// Returns the number of rows written (-1 on API error) so callers can log honestly.
function snapshotDownloadCounts() {
  const resp = UrlFetchApp.fetch(REPORTER.RELEASES_API, {
    muteHttpExceptions: true,
    headers: ghHeaders_(),
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('GitHub API ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
    return -1;
  }
  const releases = JSON.parse(resp.getContentText());

  const ss = SpreadsheetApp.openById(REPORTER.SHEET_ID);
  let sheet = ss.getSheetByName(REPORTER.TAB);
  if (!sheet) {
    sheet = ss.insertSheet(REPORTER.TAB);
    sheet.appendRow(['Date', 'Release', 'Asset', 'Cumulative Downloads']);
    sheet.setFrozenRows(1);
  }

  const today = Utilities.formatDate(new Date(), REPORTER.TZ, 'yyyy-MM-dd');
  const rows = [];
  releases.forEach(r => {
    (r.assets || []).forEach(a => {
      rows.push([today, r.tag_name, a.name, a.download_count]);
    });
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
  Logger.log('Snapshot: wrote ' + rows.length + ' rows for ' + today);
  return rows.length;
}

// Idempotent: clears any existing trigger for this function, installs a fresh daily
// one, then runs a snapshot now so the tab isn't empty. Run this once after setup.
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'snapshotDownloadCounts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('snapshotDownloadCounts')
    .timeBased()
    .everyDays(1)
    .atHour(REPORTER.HOUR)
    .create();
  const n = snapshotDownloadCounts();
  Logger.log('Daily trigger installed (~' + REPORTER.HOUR + ':00 ' + REPORTER.TZ + '). First snapshot: '
    + (n < 0 ? 'FAILED (GitHub API error — see log above; add GH_TOKEN script property)' : n + ' rows written') + '.');
}
