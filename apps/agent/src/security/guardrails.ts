import { URL } from 'node:url';
import net from 'node:net';

export class SecurityGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityGuardError';
  }
}

/**
 * Checks if an IPv4 address is in a private, loopback, or link-local range.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;
  // 10.0.0.0/8 (Private)
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (Private: 172.16.x.x - 172.31.x.x)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata: 169.254.169.254)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8 (Broadcast/Current)
  if (parts[0] === 0) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private, loopback, or link-local range.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe90:') || normalized.startsWith('fea0:') || normalized.startsWith('feb0:')) return true; // Link-local
  if (normalized.startsWith('fc00:') || normalized.startsWith('fd00:')) return true; // Unique local
  return false;
}

/**
 * Validates a target URL against SSRF rules:
 * - Must be http or https
 * - Cannot resolve to localhost or private/link-local/cloud-metadata IP
 */
export function validateUrlAgainstSSRF(rawUrl: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check known loopback/internal hostnames
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan')
    ) {
      return { valid: false, reason: `Blocked private or local hostname: ${hostname}` };
    }

    // If hostname is directly an IP
    if (net.isIPv4(hostname)) {
      if (isPrivateIPv4(hostname)) {
        return { valid: false, reason: `Blocked private IPv4 address: ${hostname}` };
      }
    } else if (net.isIPv6(hostname)) {
      if (isPrivateIPv6(hostname)) {
        return { valid: false, reason: `Blocked private IPv6 address: ${hostname}` };
      }
    }

    return { valid: true };
  } catch (err: unknown) {
    return { valid: false, reason: `Invalid URL format: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Checks whether the target URL is permitted by the domain allowlist.
 */
export function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return allowedDomains.some((d) => {
      const allowed = d.toLowerCase();
      return host === allowed || host.endsWith(`.${allowed}`);
    });
  } catch {
    return false;
  }
}

/**
 * Checks whether an element appears to be a sensitive credential field
 * (password, credit card, security code, token, pin).
 */
export function isSensitiveField(element: {
  tag: string;
  type?: string;
  selector?: string;
  placeholder?: string;
  name?: string;
  id?: string;
}): boolean {
  const sensitivePatterns = /password|passwd|secret|creditcard|credit[-_]?card|cc[-_]?num|cvv|cvc|security[-_]?code|ssn|pin\b/i;

  if (element.type && element.type.toLowerCase() === 'password') {
    return true;
  }

  const combined = [
    element.type || '',
    element.selector || '',
    element.placeholder || '',
    element.name || '',
    element.id || '',
  ].join(' ');

  return sensitivePatterns.test(combined);
}

/**
 * Budget guardrail tracking step, token, and time budgets.
 */
export class BudgetGuard {
  readonly maxSteps: number;
  readonly tokenBudget: number;
  readonly timeoutMs: number;
  readonly startTime: number;
  private totalTokensUsed = 0;
  private currentStep = 0;

  constructor(options: { maxSteps?: number; tokenBudget?: number; timeoutMs?: number } = {}) {
    this.maxSteps = options.maxSteps ?? 15;
    this.tokenBudget = options.tokenBudget ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 120_000; // 2 minutes
    this.startTime = Date.now();
  }

  recordStep(): void {
    this.currentStep += 1;
    if (this.currentStep > this.maxSteps) {
      throw new SecurityGuardError(`Step budget exceeded: reached step ${this.currentStep} (max: ${this.maxSteps})`);
    }
    this.checkTimeout();
  }

  recordTokens(tokens: number): void {
    this.totalTokensUsed += tokens;
    if (this.totalTokensUsed > this.tokenBudget) {
      throw new SecurityGuardError(`Token budget exceeded: used ${this.totalTokensUsed} tokens (max: ${this.tokenBudget})`);
    }
  }

  checkTimeout(): void {
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.timeoutMs) {
      throw new SecurityGuardError(`Execution timeout exceeded: ${elapsed}ms elapsed (max: ${this.timeoutMs}ms)`);
    }
  }

  get stats() {
    return {
      currentStep: this.currentStep,
      maxSteps: this.maxSteps,
      totalTokens: this.totalTokensUsed,
      tokenBudget: this.tokenBudget,
      elapsedMs: Date.now() - this.startTime,
      timeoutMs: this.timeoutMs,
    };
  }
}
