/**
 * BidVision Beta — Registration Handler
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Handles three actions:
 *   1. register — new tester signup, auto-emails first 10
 *   2. redeem — code redeemed after registration
 *   3. code_entry — returning user or shared code via "Have a code?" flow
 */

const CONFIG = {
  SHEET_ID: '1nfBx1L0yo4j20qjsfcP4mnaveSe0oQt5uz-78egYqNI',  // Beta Tracker (jameson@foxfinch.co)
  // Beta codes auto-roll by month: BID-MMYY for the current "bid month".
  // EMIT_OFFSET = 1 → next calendar month (e.g. emits BID-0726 during June).
  // Set EMIT_OFFSET = 0 to emit the current calendar month instead. See currentBetaCode().
  EMIT_OFFSET: 1,
  GRANDFATHERED_CODES: ['BID-0426', 'BID-0726'],  // older codes that stay valid forever
  AUTO_APPROVE_LIMIT: 10,
  OWNER_EMAIL: 'hello@bidvision.app',
  LANDING_PAGE_URL: 'https://bidvision.app/beta',
  FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSdBkgz7FIurBAd6s-l1DTJyvy3z2lsgqbXn7fsNNdzw9eWoYQ/viewform',
};

// BID-MMYY for `offsetMonths` from `date` (0 = this calendar month, 1 = next).
function bidCodeFor(date, offsetMonths) {
  const d = new Date(date.getFullYear(), date.getMonth() + offsetMonths, 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return 'BID-' + mm + yy;
}

// The code emailed to new signups, computed fresh each send (no monthly redeploy).
function currentBetaCode() {
  return bidCodeFor(new Date(), CONFIG.EMIT_OFFSET);
}

function doPost(e) {
  try {
    // Supports both raw body (fetch text/plain) and form parameter
    const raw = e.postData ? e.postData.contents : null;
    const data = JSON.parse(raw || e.parameter.data);

    switch (data.action) {
      case 'register':
        return handleRegistration(data);
      case 'redeem':
        return handleRedemption(data);
      case 'code_entry':
        return handleCodeEntry(data);
      case 'download':
        return handleDownload(data);
      default:
        return respond({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

function handleRegistration(data) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Testers');

  // Check for duplicate email
  const emails = sheet.getRange('H2:H').getValues().flat().filter(String);
  const isDuplicate = emails.some(e => e.toLowerCase() === data.email.toLowerCase());

  if (!isDuplicate) {
    const currentCount = sheet.getLastRow() - 1; // minus header
    const autoApproved = currentCount < CONFIG.AUTO_APPROVE_LIMIT;
    const status = autoApproved ? 'Auto-approved' : 'Pending review';

    // Write to sheet: Name | Base | Platform | Status | Registered | BP1 | BP2 | Email | Phone | SMS | Code Used | Notes
    sheet.appendRow([
      data.name,
      data.base,
      data.platform,
      status,
      new Date().toISOString(),
      '',  // BP1 Engaged
      '',  // BP2 Engaged
      data.email,
      data.phone || '',
      data.smsOptIn ? 'Yes' : 'No',
      '',  // Code Used (filled on redemption)
      '',  // Notes
    ]);

    // Auto-send welcome email for first N registrations
    if (autoApproved) {
      sendWelcomeEmail(data.name, data.email);
    }

    // Notify owner
    notifyOwner(data.name, data.base, data.platform, data.email, autoApproved);
  }

  return respond({ success: true });
}

function handleRedemption(data) {
  // Update the "Code Used" column for this email
  if (data.email && data.code) {
    updateCodeUsed(data.email, data.code);
  }
  return respond({ success: true });
}

// Logs a download-button click: who (email) downloaded what (platform + version) when.
// Deliberately minimal — no IP, no user-agent, no fingerprint. Auto-creates the tab.
function handleDownload(data) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = ss.getSheetByName('Downloads');
  if (!sheet) {
    sheet = ss.insertSheet('Downloads');
    sheet.appendRow(['Timestamp', 'Email', 'Platform', 'Version']);
  }
  sheet.appendRow([
    new Date().toISOString(),
    data.email || '(unknown)',
    data.platform || '',
    data.version || '',
  ]);
  return respond({ success: true });
}

function handleCodeEntry(data) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Testers');
  const emails = sheet.getRange('H2:H').getValues().flat().filter(String);
  const isDuplicate = emails.some(e => e.toLowerCase() === data.email.toLowerCase());

  if (!isDuplicate) {
    // New person via shared code — create a row
    sheet.appendRow([
      '',          // Name (unknown)
      '',          // Base
      '',          // Platform
      'Shared code',
      new Date().toISOString(),
      '', '',      // BP1, BP2
      data.email,
      '', '',      // Phone, SMS
      data.code,
      'Registered via shared code',
    ]);

    // Notify owner
    notifyOwner('(shared code)', '?', '?', data.email, false);
  } else {
    // Returning user — just update their code if not set
    updateCodeUsed(data.email, data.code);
  }

  return respond({ success: true });
}

function updateCodeUsed(email, code) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Testers');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][7] && data[i][7].toLowerCase() === email.toLowerCase()) {
      const codeCol = 11; // Column K (0-indexed: 10, but setRange is 1-indexed: 11)
      const currentCode = sheet.getRange(i + 1, codeCol).getValue();
      if (!currentCode) {
        sheet.getRange(i + 1, codeCol).setValue(code);
      }
      break;
    }
  }
}

function sendWelcomeEmail(name, email) {
  const code = currentBetaCode();
  const subject = 'Your BidVision Beta Access';
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #2A2A28;">
      <div style="text-align: center; padding: 32px 0 24px;">
        <h1 style="font-size: 24px; margin: 0;">
          <span style="font-weight: 700; color: #8B5E3C;">BID</span><span style="font-weight: 300; color: #8B5E3C; letter-spacing: 0.06em;">VISION</span>
        </h1>
      </div>

      <p>Hey ${name},</p>

      <p>Welcome to the BidVision beta! Here's your access code:</p>

      <div style="text-align: center; margin: 24px 0;">
        <div style="display: inline-block; background: #F4F2EF; border: 2px solid #8B5E3C; border-radius: 8px; padding: 16px 32px; font-size: 24px; font-weight: 700; letter-spacing: 0.08em; color: #8B5E3C;">
          ${code}
        </div>
      </div>

      <p><strong>To get started:</strong></p>
      <ol style="line-height: 1.8;">
        <li>Go to <a href="${CONFIG.LANDING_PAGE_URL}" style="color: #8B5E3C;">${CONFIG.LANDING_PAGE_URL}</a></li>
        <li>Enter your access code</li>
        <li>Download the build for your device</li>
        <li>Follow the install instructions on the page</li>
      </ol>

      <p><strong>What to try:</strong></p>
      <ul style="line-height: 1.8;">
        <li>Load your bid sheet PDF (or the sample, if you don't have one yet)</li>
        <li>Set your availability, then rank a filter with Prefer, Allow, or Exclude</li>
        <li>Switch between Discover and Strict and watch the trip list change</li>
        <li>Break things. That's what beta is for.</li>
      </ul>
      <p style="line-height: 1.8;">Full five-minute checklist: <a href="https://bidvision.app/testing/" style="color: #8B5E3C;">bidvision.app/testing</a></p>

      <p><strong>Need your bid sheet?</strong></p>
      <p style="line-height: 1.8;">Log into the <a href="https://faportal.aa.com" style="color: #8B5E3C;">FA Portal</a>, then go to <strong>Bidding Resources &rarr; Crew Planning &rarr; Current Bid Sheets</strong>. Pick your base and save the PDF.</p>

      <p><strong>Found a bug or have feedback?</strong></p>
      <ul style="line-height: 1.8;">
        <li><a href="${CONFIG.FORM_URL}" style="color: #8B5E3C;">Submit a report</a> (takes 30 seconds)</li>
        <li>Or use the Feedback button in the app</li>
      </ul>

      <p><strong>Questions, or just want to talk it through?</strong></p>
      <p style="line-height: 1.8;">Text me directly at <strong>(215) 688-5012</strong>. Happy to help, and I want to hear how it's going.</p>

      <p style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #EDE8DE; font-size: 13px; color: #7A766F;">
        BidVision runs on Mac, Windows, Linux, iPhone, iPad, and Android — it's best on a desktop or tablet, but use whatever you've got.<br>
        No airline data is sent to or stored by BidVision servers. Everything stays on your device.
      </p>
    </div>
  `;

  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: htmlBody,
    replyTo: CONFIG.OWNER_EMAIL,
    name: 'BidVision Beta',
  });
}

function notifyOwner(name, base, platform, email, autoApproved) {
  MailApp.sendEmail({
    to: CONFIG.OWNER_EMAIL,
    subject: `BidVision Beta: New signup — ${name} (${base})`,
    body: [
      `New beta registration:`,
      `  Name: ${name}`,
      `  Email: ${email}`,
      `  Base: ${base}`,
      `  Platform: ${platform}`,
      `  Auto-approved: ${autoApproved ? 'Yes (email sent)' : 'No (pending review)'}`,
      ``,
      `View tracker: https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`,
    ].join('\n'),
  });
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
