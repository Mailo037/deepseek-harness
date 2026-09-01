/**
 * Windows DPAPI adapter for user-scoped credential documents. The encrypted
 * blob is portable across processes for the same Windows user on the same
 * machine, but not across users or machines.
 * @module @deepseek-ai/dsh-credentials-local/windows-dpapi
 */

import { Dpapi, isPlatformSupported } from '@primno/dpapi'

/** Reject a package/platform mismatch before it can be mistaken for corrupt credential data. */
function assertSupported(): void {
  if (process.platform !== 'win32' || !isPlatformSupported) {
    throw new Error('credentials-local: Windows DPAPI is unavailable on this platform or architecture')
  }
}

/**
 * Encrypt bytes for the current Windows user and machine.
 * @param plaintext - bytes to protect.
 * @returns the opaque DPAPI blob.
 * @throws when Windows rejects the operation.
 */
export function protectForCurrentUser(plaintext: Buffer): Buffer {
  assertSupported()
  try {
    return Buffer.from(Dpapi.protectData(plaintext, null, 'CurrentUser'))
  } catch (error) {
    throw new Error('credentials-local: CryptProtectData failed', { cause: error })
  }
}

/**
 * Decrypt bytes protected for the current Windows user and machine.
 * @param ciphertext - opaque DPAPI blob.
 * @returns the authenticated plaintext.
 * @throws when the blob is corrupt or belongs to another user or machine.
 */
export function unprotectForCurrentUser(ciphertext: Buffer): Buffer {
  assertSupported()
  try {
    return Buffer.from(Dpapi.unprotectData(ciphertext, null, 'CurrentUser'))
  } catch (error) {
    throw new Error('credentials-local: CryptUnprotectData failed', { cause: error })
  }
}
