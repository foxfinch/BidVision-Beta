/**
 * BidVision notify list: Registration Handler
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Handles two actions:
 *   1. register: records a signup (name, email, base) in the Testers sheet, alerts the owner,
 *      and sends the signup one confirmation email
 *   2. download: logs a download click to the Downloads tab (nothing is downloadable now)
 *
 * Any other action returns { success: false, error: 'Unknown action' }.
 */

const CONFIG = {
  SHEET_ID: '1nfBx1L0yo4j20qjsfcP4mnaveSe0oQt5uz-78egYqNI',  // Beta Tracker (jameson@foxfinch.co)
  OWNER_EMAIL: 'hello@bidvision.app',  // signup-facing: confirmation-email reply-to (a Google Group; do NOT reuse for self-notifications)
  // Signup-facing FROM address. Verified send-as alias on jameson@foxfinch.co (verification=accepted),
  // so GmailApp.sendEmail({from: SENDER_EMAIL}) sends as hello@bidvision.app (MailApp couldn't do this; it forced From = jameson@foxfinch.co).
  SENDER_EMAIL: 'hello@bidvision.app',
  // Admin signup alerts go HERE, not to OWNER_EMAIL. hello@/support@ are Google Groups
  // jameson@foxfinch.co belongs to, so Gmail self-send dedup suppresses group-addressed
  // mail to Sent only (never an inbox). The primary mailbox + a filterable +tag delivers
  // to the inbox normally (verified 2026-06-24). Email only (SMS declined).
  NOTIFY_EMAIL: 'jameson+bidvision@foxfinch.co',
};

function doPost(e) {
  try {
    // Supports both raw body (fetch text/plain) and form parameter
    const raw = e.postData ? e.postData.contents : null;
    const data = JSON.parse(raw || e.parameter.data);

    switch (data.action) {
      case 'register':
        return handleRegistration(data);
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
    // Write to sheet: Name | Base | Platform | Status | Registered | BP1 | BP2 | Email | Phone | SMS | Code Used | Notes
    // Platform, Phone, SMS and Code Used are columns from the original beta sheet; the form no longer fills them.
    sheet.appendRow([
      data.name,
      data.base,
      data.platform || '',
      'Waitlist',
      new Date().toISOString(),
      '',  // BP1 Engaged
      '',  // BP2 Engaged
      data.email,
      data.phone || '',
      data.smsOptIn ? 'Yes' : 'No',
      '',  // Code Used
      '',  // Notes
    ]);

    sendWaitlistEmail(data.name, data.email);
    notifyOwner(data.name, data.base, data.email);
  }

  return respond({ success: true });
}

// Logs a download-button click: who (email) downloaded what (platform + version) when.
// Deliberately minimal: no IP, no user-agent, no fingerprint. Auto-creates the tab.
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

// The one email a new signup receives. A plain thank-you: no access code, no download link, no
// promise of a build. Replies route to the support group (OWNER_EMAIL), not a personal line.
function sendWaitlistEmail(name, email) {
  const subject = "You're on the BidVision list";
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #2A2A28;">
      <div style="text-align: center; padding: 32px 0 24px;">
        <h1 style="font-size: 24px; margin: 0;">
          <span style="font-weight: 700; color: #8B5E3C;">BID</span><span style="font-weight: 300; color: #8B5E3C; letter-spacing: 0.06em;">VISION</span>
        </h1>
      </div>

      <p>Hey ${name},</p>

      <p>Thanks for signing up. The BidVision beta has wrapped up, and I've added you to the notify list.</p>

      <p>You don't need to do anything. If there's ever something new worth trying, I'll write.</p>

      <p style="line-height: 1.8;">Glad you're interested. If you have a question in the meantime, just reply to this note.</p>

      <p style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #EDE8DE; font-size: 13px; color: #7A766F;">
        Bid sheets, availability and preferences are read on your device and never uploaded. The only things stored elsewhere are the name, email and base you typed into the signup form.
      </p>
    </div>
  `;

  const plainBody = [
    `Hey ${name},`,
    ``,
    `Thanks for signing up. The BidVision beta has wrapped up, and I've added you to the notify list.`,
    ``,
    `You don't need to do anything. If there's ever something new worth trying, I'll write.`,
    ``,
    `Glad you're interested. If you have a question in the meantime, just reply to this note.`,
    ``,
    `Bid sheets, availability and preferences are read on your device and never uploaded. The only things stored elsewhere are the name, email and base you typed into the signup form.`,
  ].join('\n');

  // GmailApp (not MailApp) so we can set from: a verified alias and leave an auditable Sent copy.
  GmailApp.sendEmail(email, subject, plainBody, {
    htmlBody: htmlBody,
    from: CONFIG.SENDER_EMAIL,
    replyTo: CONFIG.OWNER_EMAIL,
    name: 'BidVision',
  });
}

function notifyOwner(name, base, email) {
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: `BidVision notify list: new signup (${name}, ${base})`,
    body: [
      `New notify-list signup:`,
      `  Name: ${name}`,
      `  Email: ${email}`,
      `  Base: ${base}`,
      `  Confirmation email: sent (thank-you note only; no access code or download)`,
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
