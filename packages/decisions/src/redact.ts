/** V1: the most a stored decision request may take (characters of JSON). */
export const MAX_STORED_REQUEST_CHARS = 32 * 1024;

/** Fields whose values are secrets whatever they hold. */
const SECRET_KEY_RE = /pass(word|wd|phrase)?|secret|token|api[-_]?key|authorization|cookie|otp/i;

/** Credential shapes inside free text: bearer tokens, provider keys, JWTs, long hex keys. */
const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/\b(sk|rk|pk)-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, "[redacted key]"],
  [/\bts_(?:live|test)_[A-Za-z0-9]{8,}/g, "[redacted key]"],
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g, "[redacted key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted token]"],
  [/\b[0-9a-f]{40,}\b/gi, "[redacted hex]"],
];

function redactText(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_TEXT_PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** A deep copy with secrets replaced: secret-named fields, then credential shapes in any text. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[too deep]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] =
        SECRET_KEY_RE.test(key) && (typeof v === "string" || typeof v === "number")
          ? "[redacted]"
          : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * What a decision keeps of its request: redacted, and within {@link MAX_STORED_REQUEST_CHARS}.
 * A state too big to keep whole is cut (the questions always stay, they say what was asked).
 */
export function storableRequest(
  state: unknown,
  questions: Record<string, unknown>,
): { state: unknown; questions: Record<string, unknown> } {
  const safeQuestions = redactSecrets(questions) as Record<string, unknown>;
  const safeState = redactSecrets(state);
  const whole = JSON.stringify({ state: safeState, questions: safeQuestions });
  if (whole.length <= MAX_STORED_REQUEST_CHARS)
    return { state: safeState, questions: safeQuestions };
  const room = Math.max(0, MAX_STORED_REQUEST_CHARS - JSON.stringify(safeQuestions).length - 200);
  const text = typeof safeState === "string" ? safeState : JSON.stringify(safeState);
  return {
    state: { truncated: true, text: text.slice(0, room) },
    questions: safeQuestions,
  };
}
