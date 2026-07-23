function isPassiveGoogleAccountUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.hostname.toLowerCase() !== 'accounts.google.com') return false;
    return /(?:rotatecookies|listaccounts|checkcookie|passivelogin|embedded\/setup)/i.test(parsed.pathname);
  } catch (e) {
    return false;
  }
}

function shouldLaunchGoogleAuthFromRequest(rawUrl, sourceUrl, isGoogleAuthSensitiveUrl) {
  if (!isGoogleAuthSensitiveUrl(rawUrl) || isPassiveGoogleAccountUrl(rawUrl)) return false;
  try {
    let decodedTarget = String(rawUrl || '');
    try { decodedTarget = decodeURIComponent(decodedTarget); } catch (e) { }
    if (/(?:continue|redirect|followup).*google\.[^/]+\/search/i.test(decodedTarget)) {
      return false;
    }

    const target = new URL(String(rawUrl || ''));
    const source = new URL(String(sourceUrl || ''));
    const sourceHost = source.hostname.toLowerCase();
    const sourceIsGoogleSearch = (sourceHost === 'google.com' || sourceHost.endsWith('.google.com'))
      && source.pathname === '/search';
    if (sourceIsGoogleSearch) return false;
    return true;
  } catch (e) {
    return true;
  }
}

module.exports = { isPassiveGoogleAccountUrl, shouldLaunchGoogleAuthFromRequest };
