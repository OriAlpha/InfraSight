/**
 * Validation for operator-supplied URLs (upstream provider base, alert webhooks).
 *
 * The dashboard can rewrite the upstream base URL at runtime, and dashboard auth
 * is opt-in — so an unauthenticated deployment would otherwise let anyone turn
 * the proxy into a request forwarder aimed at anything reachable from the
 * server. These checks reject the shapes that have no legitimate use.
 *
 * This is a hostname-level check performed at configuration time; it does not
 * defend against DNS rebinding. Deployments exposed beyond localhost should also
 * enable DASHBOARD_AUTH_ENABLED.
 *
 * @module utils/url-guard
 */
'use strict';

/** Cloud instance-metadata endpoints. Never a valid LLM provider or webhook. */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  '[fd00:ec2::254]',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

/**
 * True if the hostname is a loopback, link-local, or RFC1918 address.
 * @param {string} hostname - Lower-cased hostname from a parsed URL
 * @returns {boolean}
 */
function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  // IPv6 loopback (::1), unique-local (fc00::/7), link-local (fe80::/10)
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;

  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Validates a URL supplied by an operator.
 *
 * @param {string} raw - The candidate URL
 * @param {Object} [opts]
 * @param {string} [opts.label='URL'] - Name used in error messages
 * @param {boolean} [opts.httpsOnly=false] - Reject plain http
 * @param {boolean} [opts.allowPrivate=true] - Allow loopback/RFC1918 targets
 * @returns {URL} The parsed URL
 * @throws {Error} If the URL is unusable or points somewhere it should not
 */
function assertSafeUrl(raw, opts = {}) {
  const { label = 'URL', httpsOnly = false, allowPrivate = true } = opts;

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }

  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`${label} is not a valid absolute URL (expected e.g. https://api.openai.com/v1).`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https (got "${parsed.protocol.replace(':', '')}").`);
  }

  if (httpsOnly && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (METADATA_HOSTS.has(hostname)) {
    throw new Error(`${label} may not target a cloud instance-metadata endpoint.`);
  }

  if (!allowPrivate && isPrivateHost(hostname)) {
    throw new Error(`${label} may not target a private or loopback address.`);
  }

  return parsed;
}

/**
 * Validates an upstream LLM provider base URL.
 *
 * Private and loopback addresses stay allowed by default because local
 * providers (Ollama, vLLM, LM Studio, Docker service names) are a supported
 * setup. Set BLOCK_PRIVATE_UPSTREAM=true on shared or internet-facing
 * deployments to turn that off.
 *
 * @param {string} raw
 * @returns {URL}
 */
function assertSafeUpstreamUrl(raw) {
  return assertSafeUrl(raw, {
    label: 'Upstream API base URL',
    allowPrivate: process.env.BLOCK_PRIVATE_UPSTREAM !== 'true',
  });
}

/**
 * Validates an alert webhook URL. Webhooks always go to third-party services,
 * so internal targets are rejected outright.
 *
 * @param {string} raw
 * @param {string} [label='Webhook URL']
 * @returns {URL}
 */
function assertSafeWebhookUrl(raw, label = 'Webhook URL') {
  return assertSafeUrl(raw, { label, httpsOnly: true, allowPrivate: false });
}

module.exports = {
  assertSafeUrl,
  assertSafeUpstreamUrl,
  assertSafeWebhookUrl,
  isPrivateHost,
};
