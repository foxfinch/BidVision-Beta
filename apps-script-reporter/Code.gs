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
 */

const REPORTER = {
  SHEET_ID: '1nfBx1L0yo4j20qjsfcP4mnaveSe0oQt5uz-78egYqNI',  // BidVision Beta Tracker
  RELEASES_API: 'https://api.github.com/repos/foxfinch/BidVision-Beta/releases',
  TAB: 'Download Counts',
  TZ: 'America/New_York',
  HOUR: 7,  // ~7am ET
};

// Appends one row per (release asset) with its cumulative download_count, stamped
// with today's date. Diff consecutive days to see per-asset deltas (actual grabs).
function snapshotDownloadCounts() {
  const resp = UrlFetchApp.fetch(REPORTER.RELEASES_API, {
    muteHttpExceptions: true,
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'BidVision-Beta-Tracker' },
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('GitHub API ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
    return;
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
  snapshotDownloadCounts();
  Logger.log('Daily trigger installed (~' + REPORTER.HOUR + ':00 ' + REPORTER.TZ + ') + first snapshot written.');
}
