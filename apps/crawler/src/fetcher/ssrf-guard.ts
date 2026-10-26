import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Checks if an IPv4 address is in a private, loopback, or link-local range
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 is treated as unsafe
  }

  const [p0, p1] = parts;
  if (p0 === undefined || p1 === undefined) return true;

  // 0.0.0.0/8
  if (p0 === 0) return true;
  // 127.0.0.0/8 (Loopback)
  if (p0 === 127) return true;
  // 10.0.0.0/8 (Private)
  if (p0 === 10) return true;
  // 172.16.0.0/12 (Private: 172.16.x.x - 172.31.x.x)
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (p0 === 192 && p1 === 168) return true;
  // 169.254.0.0/16 (Link-local & Cloud Metadata 169.254.169.254)
  if (p0 === 169 && p1 === 254) return true;
  // 224.0.0.0/4 (Multicast)
  if (p0 >= 224 && p0 <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (p0 >= 240) return true;

  return false;
}

/**
 * Checks if an IPv6 address is loopback, unique local, link-local, or IPv4-mapped private
 */
export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:a00:1)
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) {
      return isPrivateIPv4(v4);
    }
  }

  // fe80::/10 (Link-local)
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true;
  }

  // fc00::/7 (Unique local)
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }

  return false;
}

/**
 * Validates whether a hostname or IP is safe to crawl (not internal or SSRF target).
 * Resolves DNS to check underlying IP addresses and prevent DNS rebinding.
 */
export async function validateSafeTarget(
  hostname: string
): Promise<{ safe: boolean; reason?: string; resolvedIp?: string }> {
  // Direct IP check
  const ipFamily = net.isIP(hostname);
  if (ipFamily === 4) {
    if (isPrivateIPv4(hostname)) {
      return { safe: false, reason: `Private IPv4 address blocked: ${hostname}` };
    }
    return { safe: true, resolvedIp: hostname };
  }
  if (ipFamily === 6) {
    if (isPrivateIPv6(hostname)) {
      return { safe: false, reason: `Private IPv6 address blocked: ${hostname}` };
    }
    return { safe: true, resolvedIp: hostname };
  }

  // Common localhost keywords
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal')
  ) {
    return { safe: false, reason: `Localhost or internal domain blocked: ${hostname}` };
  }

  try {
    const lookup = await dns.lookup(hostname, { all: true });
    for (const entry of lookup) {
      if (entry.family === 4 && isPrivateIPv4(entry.address)) {
        return {
          safe: false,
          reason: `Hostname ${hostname} resolves to private IPv4: ${entry.address}`,
        };
      }
      if (entry.family === 6 && isPrivateIPv6(entry.address)) {
        return {
          safe: false,
          reason: `Hostname ${hostname} resolves to private IPv6: ${entry.address}`,
        };
      }
    }
    return { safe: true, resolvedIp: lookup[0]?.address };
  } catch (err) {
    return {
      safe: false,
      reason: `DNS lookup failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
