import type { AgentContextFeedRedaction } from "@agentgitops/core";

export interface ContextFeedPrivacyFilterResult {
  text: string;
  redactions: AgentContextFeedRedaction[];
}

interface RedactionRule {
  kind: string;
  pattern: RegExp;
  replacement: string;
}

const REDACTION_RULES: RedactionRule[] = [
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED:private_key]",
  },
  {
    kind: "github_token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED:github_token]",
  },
  {
    kind: "github_token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED:github_token]",
  },
  {
    kind: "aws_access_key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED:aws_access_key]",
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED:jwt]",
  },
  {
    kind: "password",
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*([^\s"'`;,]+)/gi,
    replacement: "$1=[REDACTED:password]",
  },
  {
    kind: "token",
    pattern: /\b(api[_-]?key|access[_-]?token|secret|token)\s*[:=]\s*([^\s"'`;,]+)/gi,
    replacement: "$1=[REDACTED:token]",
  },
];

export class ContextFeedPrivacyFilter {
  redact(text: string): ContextFeedPrivacyFilterResult {
    const counts = new Map<string, number>();
    let redacted = text;

    for (const rule of REDACTION_RULES) {
      redacted = redacted.replace(rule.pattern, (...args: unknown[]) => {
        const match = args[0] as string;
        counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
        if (rule.replacement.includes("$1")) {
          return match.replace(rule.pattern, rule.replacement);
        }
        return rule.replacement;
      });
    }

    return {
      text: redacted,
      redactions: Array.from(counts.entries()).map(([kind, count]) => ({ kind, count })),
    };
  }
}

export function redactContextFeedText(text: string): ContextFeedPrivacyFilterResult {
  return new ContextFeedPrivacyFilter().redact(text);
}
