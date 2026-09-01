/** Credential-document protection and its strict on-disk envelope. */

import { protectForCurrentUser, unprotectForCurrentUser } from './windows-dpapi.ts'

/** Operator-facing protection selection. */
export type CredentialProtection = 'platform' | 'plain'

/** Storage mechanism selected for the running platform. */
export type ResolvedCredentialProtection = 'windows-dpapi-user' | 'plain'

/** Version of the protection envelope, independent of the inner credential-document version. */
export const PROTECTION_ENVELOPE_VERSION = 1

interface ProtectionEnvelope {
  dshCredentialsProtection: typeof PROTECTION_ENVELOPE_VERSION
  method: 'windows-dpapi-user'
  payload: string
}

/** Decoded storage text and whether it was protected on disk. */
export interface DecodedCredentialText {
  text: string
  protected: boolean
}

/**
 * Resolve the configured policy against an operating system.
 * @param configured - explicit policy, defaulting to platform protection.
 * @param platform - runtime platform.
 * @returns Windows DPAPI on Windows, and the existing owner-only plaintext file elsewhere.
 */
export function resolveCredentialProtection(
  configured: CredentialProtection | undefined,
  platform: NodeJS.Platform = process.platform,
): ResolvedCredentialProtection {
  if ((configured ?? 'platform') === 'plain') return 'plain'
  return platform === 'win32' ? 'windows-dpapi-user' : 'plain'
}

/** Whether text claims to be a protection envelope rather than an inner YAML document. */
function claimsEnvelope(text: string): boolean {
  return text.trimStart().startsWith('{') && text.includes('"dshCredentialsProtection"')
}

/** Parse and validate the exact envelope without ever quoting its payload in a diagnostic. */
function parseEnvelope(text: string, filename: string): ProtectionEnvelope | undefined {
  if (!claimsEnvelope(text)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`credentials-local: invalid protected credential envelope at ${filename}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`credentials-local: protected credential envelope at ${filename} must be an object`)
  }
  const fields = parsed as Record<string, unknown>
  const keys = Object.keys(fields)
  if (keys.length !== 3 || keys.some(key => !['dshCredentialsProtection', 'method', 'payload'].includes(key))) {
    throw new Error(`credentials-local: protected credential envelope at ${filename} has unknown fields`)
  }
  if (fields['dshCredentialsProtection'] !== PROTECTION_ENVELOPE_VERSION) {
    throw new Error(
      `credentials-local: protected credential envelope at ${filename} declares version ${String(fields['dshCredentialsProtection'])};`
      + ` this build reads version ${PROTECTION_ENVELOPE_VERSION}`,
    )
  }
  if (fields['method'] !== 'windows-dpapi-user') {
    throw new Error(`credentials-local: protected credential envelope at ${filename} uses an unsupported method`)
  }
  if (
    typeof fields['payload'] !== 'string'
    || fields['payload'].length === 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fields['payload'])
  ) {
    throw new Error(`credentials-local: protected credential envelope at ${filename} has an invalid payload`)
  }
  return fields as unknown as ProtectionEnvelope
}

/**
 * Render plaintext for durable storage under the resolved mechanism.
 * @param text - validated inner credential-document YAML.
 * @param protection - resolved storage mechanism.
 * @returns plaintext or a newline-terminated protected envelope.
 */
export function encodeCredentialText(
  text: string,
  protection: ResolvedCredentialProtection,
): string {
  if (protection === 'plain') return text
  const plaintext = Buffer.from(text, 'utf8')
  try {
    const envelope: ProtectionEnvelope = {
      dshCredentialsProtection: PROTECTION_ENVELOPE_VERSION,
      method: protection,
      payload: protectForCurrentUser(plaintext).toString('base64'),
    }
    return `${JSON.stringify(envelope, null, 2)}\n`
  } finally {
    plaintext.fill(0)
  }
}

/**
 * Read durable storage text under the resolved mechanism.
 * @param stored - raw on-disk text.
 * @param protection - resolved storage mechanism.
 * @param filename - diagnostic path.
 * @returns the inner YAML and whether the file was protected.
 */
export function decodeCredentialText(
  stored: string,
  protection: ResolvedCredentialProtection,
  filename: string,
): DecodedCredentialText {
  const envelope = parseEnvelope(stored, filename)
  if (envelope === undefined) return { text: stored, protected: false }
  if (protection !== envelope.method) {
    throw new Error(
      `credentials-local: ${filename} is protected with ${envelope.method}, but this runtime selected ${protection}`,
    )
  }
  const plaintext = unprotectForCurrentUser(Buffer.from(envelope.payload, 'base64'))
  try {
    return { text: plaintext.toString('utf8'), protected: true }
  } finally {
    plaintext.fill(0)
  }
}
