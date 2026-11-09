/**
 * BidVision mailing list: Registration Handler
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Handles two actions:
 *   1. register: records a signup (name, email, base, detected platform) in the Testers sheet,
 *      alerts the owner, and sends the signup one welcome email with the download link.
 *      Signing up is an opt-in to occasional BidVision emails (updates and marketing).
 *   2. download: logs a download click to the Downloads tab (disclosed on /beta and /privacy)
 *
 * Any other action returns { success: false, error: 'Unknown action' }.
 *
 * US commercial email rules (CAN-SPAM): every email to the list carries an unsubscribe route
 * (reply "unsubscribe" or write to hello@) and the sender's postal address. Opt-outs must be
 * honored within 10 business days: set the row's Status to "Unsubscribed" and stop mailing.
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
  // Postal address required in every list email. deploy.sh refuses to deploy while this
  // still contains the placeholder.
  MAILING_ADDRESS: 'FoxFinch Adaptations LLC, 502 W 7th St, Ste 100, Erie, PA 16502',
  DOWNLOAD_URL: 'https://bidvision.app/beta',
  BIDSHEET_URL: 'https://jetnet.aa.com/sites/inflight/SitePageModern/335174/current-archive-bid-sheets',
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
    // Platform is detected by the page, not asked. Phone, SMS and Code Used are columns from the
    // original beta sheet; the form no longer fills them. Notes records the consent basis.
    sheet.appendRow([
      data.name,
      data.base,
      data.platform || '',
      'Subscribed',
      new Date().toISOString(),
      '',  // BP1 Engaged
      '',  // BP2 Engaged
      data.email,
      data.phone || '',
      data.smsOptIn ? 'Yes' : 'No',
      '',  // Code Used
      'Opted in via /beta signup (updates + marketing), ' + new Date().toISOString().slice(0, 10),  // Notes
    ]);

    sendWelcomeEmail(data.name, data.email);
    notifyOwner(data.name, data.base, data.email, data.platform);
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

// The welcome email: the download link, where to get a bid sheet, and the feedback ask. It is
// the first email on the list, so it carries the unsubscribe route and postal address like
// every list email. Replies route to the support group (OWNER_EMAIL), not a personal line.
function sendWelcomeEmail(name, email) {
  const subject = 'Your BidVision download';
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #2A2A28;">
      <div style="text-align: center; padding: 32px 0 24px;">
        <h1 style="font-size: 24px; margin: 0;">
          <span style="font-weight: 700; color: #8B5E3C;">BID</span><span style="font-weight: 300; color: #8B5E3C; letter-spacing: 0.06em;">VISION</span>
        </h1>
      </div>

      <p>Hey ${name},</p>

      <p>Thanks for signing up. BidVision is a search tool for your bid sheet: it finds the trips that fit your schedule and preferences.</p>

      <p>The downloads for Mac, Windows, Android, iPhone and iPad are here: <a href="${CONFIG.DOWNLOAD_URL}" style="color: #8B5E3C;">bidvision.app/beta</a>. On another device, sign up again with the same email and the downloads open there too. On Mac, Windows and Android this version works until November 20, 2027; on iPhone and iPad it comes through Apple's TestFlight app.</p>

      <p>To get your bid sheet, open <a href="${CONFIG.BIDSHEET_URL}" style="color: #8B5E3C;">PBS Bid Packets on Jetnet</a> (sign in if asked), open your base's Sequences for the month, then Download original file.</p>

      <p style="line-height: 1.8;">Once you've tried it, a quick reply helps a lot: did it install, did your bid sheet load, did it find trips that fit, was it useful? Even a one-word answer helps.</p>

      <p style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #EDE8DE; font-size: 13px; color: #7A766F;">
        Your bid sheets stay on your device. You're getting this because you signed up at bidvision.app, which means occasional emails about BidVision. To unsubscribe, reply with "unsubscribe" or write to hello@bidvision.app.<br><br>
        ${CONFIG.MAILING_ADDRESS}
      </p>
    </div>
  `;

  const plainBody = [
    `Hey ${name},`,
    ``,
    `Thanks for signing up. BidVision is a search tool for your bid sheet: it finds the trips that fit your schedule and preferences.`,
    ``,
    `The downloads for Mac, Windows, Android, iPhone and iPad are here: ${CONFIG.DOWNLOAD_URL}`,
    `On another device, sign up again with the same email and the downloads open there too. On Mac, Windows and Android this version works until November 20, 2027; on iPhone and iPad it comes through Apple's TestFlight app.`,
    ``,
    `To get your bid sheet, open PBS Bid Packets on Jetnet (sign in if asked), open your base's Sequences for the month, then Download original file:`,
    CONFIG.BIDSHEET_URL,
    ``,
    `Once you've tried it, a quick reply helps a lot: did it install, did your bid sheet load, did it find trips that fit, was it useful? Even a one-word answer helps.`,
    ``,
    `--`,
    `Your bid sheets stay on your device. You're getting this because you signed up at bidvision.app, which means occasional emails about BidVision. To unsubscribe, reply with "unsubscribe" or write to hello@bidvision.app.`,
    CONFIG.MAILING_ADDRESS,
  ].join('\n');

  // GmailApp (not MailApp) so we can set from: a verified alias and leave an auditable Sent copy.
  GmailApp.sendEmail(email, subject, plainBody, {
    htmlBody: htmlBody,
    from: CONFIG.SENDER_EMAIL,
    replyTo: CONFIG.OWNER_EMAIL,
    name: 'BidVision',
  });
}

function notifyOwner(name, base, email, platform) {
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: `BidVision list: new signup (${name}, ${base})`,
    body: [
      `New signup (opted in to BidVision emails):`,
      `  Name: ${name}`,
      `  Email: ${email}`,
      `  Base: ${base}`,
      `  Platform (detected): ${platform || 'Unknown'}`,
      `  Welcome email: sent (download link, bid sheet route, feedback ask)`,
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
