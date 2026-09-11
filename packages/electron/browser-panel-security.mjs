const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export const shouldAllowBrowserPanelCertificateError = ({ url, error }) => {
  if (error !== 'net::ERR_CERT_AUTHORITY_INVALID') return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
};

/**
 * Local filesystem URLs the browser panel may load (address bar / popup in place).
 *
 * Empty host and `localhost` only — same rule as UI `isLocalFileUrl`. Keeps
 * remote `file://other-host/...` out. Does not require disabling webSecurity:
 * top-level `loadURL` of a local file keeps Chromium's origin isolation.
 */
export const isLocalBrowserFileUrl = (value) => {
  try {
    const parsed = new URL(String(value ?? '').trim());
    return parsed.protocol === 'file:' && (!parsed.hostname || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
};

/** http(s) or local file — schemes the panel webview may navigate to. */
export const isBrowsablePanelUrl = (value) => {
  try {
    const parsed = new URL(String(value ?? '').trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
    return isLocalBrowserFileUrl(parsed.toString());
  } catch {
    return false;
  }
};
