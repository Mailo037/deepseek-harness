import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { RemoteDeviceId, RemoteDeviceView, RemoteDevicesSnapshot } from './types.ts'

/** Schema for a stored device record (secret hash only, never plaintext). */
const storedDeviceSchema = z.object({
  name: z.string().min(1),
  platform: z.string().min(1),
  /** SHA-256 hex digest of the device secret. */
  secretHash: z.string().length(64).regex(/^[0-9a-f]{64}$/),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
})

/** Persisted remote-device record; only the secret hash is retained. */
export type StoredDevice = z.infer<typeof storedDeviceSchema>

/** Schema for the domain's global singleton: the GUI access token (empty until first generated). */
const accessTokenSchema = z.object({
  accessToken: z.string(),
})

/** Domain spec for the remote-devices persistent store. */
export const REMOTE_DEVICES_DOMAIN = defineDomain({
  name: 'remote_devices',
  version: 1,
  global: { schema: accessTokenSchema, initial: { accessToken: '' } },
  tables: {
    devices: domainTable<RemoteDeviceId, StoredDevice>(storedDeviceSchema),
  },
})

/**
 * Typed handle over the remote-devices storage domain. Owns the domain's
 * lifecycle (the caller controls when the domain opens and closes).
 */
export class DeviceRegistry {
  constructor(private readonly domain: Domain<typeof REMOTE_DEVICES_DOMAIN>) {}

  private get devices(): KvTable<RemoteDeviceId, StoredDevice> {
    return this.domain.table('devices')
  }

  /**
   * List every stored device, without live-connection status.
   * @returns Stored device records.
   */
  list(): StoredDevice[] {
    return [...this.devices.entries()].map(([, value]) => value)
  }

  /**
   * List every stored device as a remote-facing snapshot (connection status passed in from outside).
   * @param isConnected - Live connection lookup.
   * @returns Remote-facing device snapshot.
   */
  snapshot(isConnected: (id: RemoteDeviceId) => boolean): RemoteDevicesSnapshot {
    const devices: RemoteDeviceView[] = []
    for (const [id, value] of this.devices.entries()) {
      devices.push({
        deviceId: id,
        name: value.name,
        platform: value.platform,
        connected: isConnected(id),
        lastSeenAt: value.lastSeenAt,
        createdAt: value.createdAt,
      })
    }
    return { devices }
  }

  /**
   * Retrieve one stored device record.
   * @param deviceId - Device identifier.
   * @returns Stored record when present.
   */
  get(deviceId: RemoteDeviceId): StoredDevice | undefined {
    return this.devices.get(deviceId)
  }

  /**
   * Persist a new device record.
   * @param deviceId - Device identifier.
   * @param record - Record to persist.
   */
  async create(deviceId: RemoteDeviceId, record: StoredDevice): Promise<void> {
    await this.devices.put(deviceId, record)
  }

  /**
   * Update the lastSeenAt timestamp for an existing device.
   * @param deviceId - Device identifier.
   * @param at - ISO timestamp.
   */
  async touch(deviceId: RemoteDeviceId, at: string): Promise<void> {
    await this.devices.update(deviceId, current => ({ ...current, lastSeenAt: at }))
  }

  /**
   * Remove a device record entirely.
   * @param deviceId - Device identifier.
   * @returns Whether the record existed.
   */
  async remove(deviceId: RemoteDeviceId): Promise<boolean> {
    return this.devices.delete(deviceId)
  }

  /**
   * Find a device record by secret hash.
   * @param hash - SHA-256 secret hash.
   * @returns Device id and record, or undefined.
   */
  findBySecretHash(hash: string): [RemoteDeviceId, StoredDevice] | undefined {
    for (const [id, value] of this.devices.entries()) {
      if (value.secretHash === hash) return [id, value]
    }
    return undefined
  }

  /**
   * Read the persisted GUI access token.
   * @returns Empty string when never generated, otherwise the token.
   */
  getAccessToken(): string {
    return this.domain.global.get().accessToken
  }

  /**
   * Persist the GUI access token.
   * @param token - Token to persist.
   */
  async setAccessToken(token: string): Promise<void> {
    await this.domain.global.set({ accessToken: token })
  }
}
