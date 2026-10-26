import { describe, it, expect } from 'vitest';
import { isPrivateIPv4, isPrivateIPv6, validateSafeTarget } from '../src/fetcher/ssrf-guard.js';

describe('SSRF Protection Guard', () => {
  it('identifies private and link-local IPv4 addresses as unsafe', () => {
    expect(isPrivateIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateIPv4('10.0.0.5')).toBe(true);
    expect(isPrivateIPv4('172.16.0.1')).toBe(true);
    expect(isPrivateIPv4('172.31.255.255')).toBe(true);
    expect(isPrivateIPv4('192.168.1.1')).toBe(true);
    expect(isPrivateIPv4('169.254.169.254')).toBe(true); // AWS/cloud metadata
    expect(isPrivateIPv4('0.0.0.0')).toBe(true);
  });

  it('identifies public IPv4 addresses as safe', () => {
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('1.1.1.1')).toBe(false);
    expect(isPrivateIPv4('142.250.190.46')).toBe(false);
  });

  it('identifies private and loopback IPv6 addresses as unsafe', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('fe80::1')).toBe(true);
    expect(isPrivateIPv6('fc00::1')).toBe(true);
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
  });

  it('blocks localhost hostnames directly', async () => {
    const res = await validateSafeTarget('localhost');
    expect(res.safe).toBe(false);
    expect(res.reason).toContain('Localhost or internal domain blocked');
  });

  it('blocks cloud metadata IP target', async () => {
    const res = await validateSafeTarget('169.254.169.254');
    expect(res.safe).toBe(false);
    expect(res.reason).toContain('Private IPv4 address blocked');
  });
});
