import { createHash } from 'node:crypto';

export interface RedactionResult {
  readonly content: string;
  readonly redactionCount: number;
}

export interface PromptInjectionAssessment {
  readonly blocked: boolean;
  readonly signals: readonly string[];
}

const REDACTION_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}\b/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s,;]{6,}/gi,
    replacement: '$1=[REDACTED_SECRET]',
  },
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    pattern: /(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}(?!\d)/g,
    replacement: '[REDACTED_PHONE]',
  },
];

const INJECTION_SIGNALS: readonly {
  readonly id: string;
  readonly pattern: RegExp;
  readonly strong: boolean;
}[] = [
  {
    id: 'IGNORE_GOVERNANCE',
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?/i,
    strong: true,
  },
  {
    id: 'BYPASS_POLICY',
    pattern:
      /(?:bypass|disable|circumvent)\s+(?:the\s+)?(?:policy|approval|authorization|privacy|safety|governance)/i,
    strong: true,
  },
  {
    id: 'EXFILTRATE_SECRET',
    pattern:
      /(?:reveal|print|dump|exfiltrate|show)\s+(?:the\s+)?(?:system prompt|developer message|secret|token|credentials?)/i,
    strong: true,
  },
  {
    id: 'ROLE_OVERRIDE',
    pattern: /(?:you are now|act as)\s+(?:an?\s+)?(?:unrestricted|unfiltered|no[- ]?rules|root)/i,
    strong: false,
  },
  {
    id: 'DIRECT_PROVIDER_BYPASS',
    pattern: /(?:call|use|invoke)\s+(?:the\s+)?provider\s+directly\s+(?:and\s+)?(?:skip|without)/i,
    strong: true,
  },
];

export function redactSensitiveData(value: string): RedactionResult {
  let content = value;
  let redactionCount = 0;
  for (const entry of REDACTION_PATTERNS) {
    content = content.replace(entry.pattern, (match, ...args: unknown[]) => {
      redactionCount += 1;
      if (entry.replacement.includes('$1')) {
        const firstCapture = typeof args[0] === 'string' ? args[0] : 'secret';
        return entry.replacement.replace('$1', firstCapture);
      }
      return entry.replacement;
    });
  }
  return { content, redactionCount };
}

export function assessPromptInjection(value: string): PromptInjectionAssessment {
  const matches = INJECTION_SIGNALS.filter((signal) => signal.pattern.test(value));
  return {
    blocked: matches.some((signal) => signal.strong) || matches.length >= 2,
    signals: matches.map((signal) => signal.id),
  };
}

export function sourceContentSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deterministicId(prefix: string, ...parts: readonly string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u001f'), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function summarizeRedactedMessages(
  messages: readonly { readonly role: string; readonly content: string }[],
  maxTokens: number,
): string {
  const maxChars = Math.max(64, maxTokens * 4);
  const lines = messages.map((message) => `${message.role}: ${message.content}`);
  const selected: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const clipped = line.length <= remaining ? line : line.slice(line.length - remaining);
    selected.unshift(clipped);
    used += clipped.length + 1;
  }
  return selected.join('\n');
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  errorCode = 'AG01_TOOL_TIMEOUT',
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('AG01_TIMEOUT_INVALID');
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function requireEvidence(values: readonly string[], code: string): readonly string[] {
  const evidence = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (evidence.length === 0) throw new Error(code);
  return evidence;
}
