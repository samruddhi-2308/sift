import { describe, it, expect } from 'vitest';
import {
  isPrivateIPv4,
  isPrivateIPv6,
  validateUrlAgainstSSRF,
  isDomainAllowed,
  isSensitiveField,
  BudgetGuard,
  SecurityGuardError,
} from '../src/security/guardrails.js';

describe('Security & Guardrails', () => {
  describe('SSRF Protection', () => {
    it('detects private and loopback IPv4 addresses', () => {
      expect(isPrivateIPv4('127.0.0.1')).toBe(true);
      expect(isPrivateIPv4('127.0.0.5')).toBe(true);
      expect(isPrivateIPv4('10.0.0.1')).toBe(true);
      expect(isPrivateIPv4('10.254.1.1')).toBe(true);
      expect(isPrivateIPv4('172.16.0.1')).toBe(true);
      expect(isPrivateIPv4('172.31.255.255')).toBe(true);
      expect(isPrivateIPv4('192.168.1.1')).toBe(true);
      expect(isPrivateIPv4('169.254.169.254')).toBe(true); // AWS/GCP metadata
      expect(isPrivateIPv4('0.0.0.0')).toBe(true);

      // Public IPs
      expect(isPrivateIPv4('8.8.8.8')).toBe(false);
      expect(isPrivateIPv4('1.1.1.1')).toBe(false);
      expect(isPrivateIPv4('142.250.190.46')).toBe(false);
    });

    it('detects private and loopback IPv6 addresses', () => {
      expect(isPrivateIPv6('::1')).toBe(true);
      expect(isPrivateIPv6('fe80::1')).toBe(true);
      expect(isPrivateIPv6('fc00::1')).toBe(true);
      expect(isPrivateIPv6('2607:f8b0:4005:805::200e')).toBe(false);
    });

    it('blocks loopback, localhost, and metadata URLs', () => {
      expect(validateUrlAgainstSSRF('http://localhost:3000/admin').valid).toBe(false);
      expect(validateUrlAgainstSSRF('http://service.localhost').valid).toBe(false);
      expect(validateUrlAgainstSSRF('http://127.0.0.1:8080').valid).toBe(false);
      expect(validateUrlAgainstSSRF('http://169.254.169.254/latest/meta-data').valid).toBe(false);
      expect(validateUrlAgainstSSRF('http://192.168.0.1/router').valid).toBe(false);
      expect(validateUrlAgainstSSRF('file:///etc/passwd').valid).toBe(false);
      expect(validateUrlAgainstSSRF('gopher://internal.server').valid).toBe(false);

      // Allows public internet URLs
      expect(validateUrlAgainstSSRF('https://en.wikipedia.org/wiki/Search_engine').valid).toBe(true);
      expect(validateUrlAgainstSSRF('https://example.com/products/123').valid).toBe(true);
    });
  });

  describe('Domain Allowlist', () => {
    it('allows permitted hostnames and subdomains', () => {
      const allowed = ['example.com', 'wikipedia.org'];
      expect(isDomainAllowed('https://example.com/page', allowed)).toBe(true);
      expect(isDomainAllowed('https://shop.example.com/item', allowed)).toBe(true);
      expect(isDomainAllowed('https://en.wikipedia.org/wiki/Main_Page', allowed)).toBe(true);

      // Disallowed external domains
      expect(isDomainAllowed('https://malicious-site.com', allowed)).toBe(false);
      expect(isDomainAllowed('https://notexample.com', allowed)).toBe(false);
    });

    it('allows all domains if allowlist is empty', () => {
      expect(isDomainAllowed('https://any-domain.org', [])).toBe(true);
    });
  });

  describe('Credential & Sensitive Field Blocker', () => {
    it('flags password and credit card inputs', () => {
      expect(isSensitiveField({ tag: 'input', type: 'password' })).toBe(true);
      expect(isSensitiveField({ tag: 'input', name: 'user_password' })).toBe(true);
      expect(isSensitiveField({ tag: 'input', id: 'credit_card_number' })).toBe(true);
      expect(isSensitiveField({ tag: 'input', placeholder: 'Enter CVV code' })).toBe(true);
      expect(isSensitiveField({ tag: 'input', selector: '#billing-cvc' })).toBe(true);
      expect(isSensitiveField({ tag: 'input', name: 'user_pin' })).toBe(true);

      // Safe fields
      expect(isSensitiveField({ tag: 'input', type: 'text', name: 'search_query' })).toBe(false);
      expect(isSensitiveField({ tag: 'input', type: 'email', name: 'newsletter_email' })).toBe(false);
      expect(isSensitiveField({ tag: 'textarea', name: 'comments' })).toBe(false);
    });
  });

  describe('Budget Guard', () => {
    it('throws when max steps are exceeded', () => {
      const guard = new BudgetGuard({ maxSteps: 3, tokenBudget: 10000, timeoutMs: 5000 });
      guard.recordStep(); // Step 1
      guard.recordStep(); // Step 2
      guard.recordStep(); // Step 3
      expect(() => guard.recordStep()).toThrow(SecurityGuardError);
    });

    it('throws when token budget is exceeded', () => {
      const guard = new BudgetGuard({ maxSteps: 10, tokenBudget: 500, timeoutMs: 5000 });
      guard.recordTokens(300);
      expect(() => guard.recordTokens(300)).toThrow(SecurityGuardError);
    });

    it('reports current usage stats', () => {
      const guard = new BudgetGuard({ maxSteps: 10, tokenBudget: 5000, timeoutMs: 10000 });
      guard.recordStep();
      guard.recordTokens(250);
      const stats = guard.stats;
      expect(stats.currentStep).toBe(1);
      expect(stats.totalTokens).toBe(250);
      expect(stats.maxSteps).toBe(10);
    });
  });
});
