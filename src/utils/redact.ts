const REDACTED = '[REDACTED]'
const SECRET_KEYS = 'access_token|refresh_token|id_token|client_secret'

// JSON: "key": "value" (value may contain escaped characters)
const JSON_PATTERN = new RegExp(
  `("(?:${SECRET_KEYS})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*(")`,
  'gi'
)
// Form / query string: key=value
const FORM_PATTERN = new RegExp(`\\b((?:${SECRET_KEYS})=)[^&\\s"']*`, 'gi')
// Authorization header value
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

/**
 * Removes token and secret values from text that is about to be logged or put
 * into an error (response bodies in particular can echo credentials).
 */
export function redactSecrets(text: string): string {
  return text
    .replace(JSON_PATTERN, `$1${REDACTED}$2`)
    .replace(FORM_PATTERN, `$1${REDACTED}`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
}
