/** Saved Harness pairings. Native token renewal uses the same per-Harness token key. */
import { Preferences } from '@capacitor/preferences'
import { loadConfig, clearConfig, type DeviceConfig } from './DeviceStorage.ts'

/** One independently authenticated Harness, identified locally rather than by its network address. */
export interface SavedHarness {
  id: string
  name: string
  config: DeviceConfig
}

const INDEX = 'harnesses'
const ACTIVE = 'activeHarness'
const keyOf = (id: string): string => `harness.${id}`
let loading: Promise<SavedHarness[]> | undefined

/** Read a pairing and its independently renewed GUI token. */
export async function readHarness(id: string): Promise<SavedHarness> {
  const { value } = await Preferences.get({ key: keyOf(id) })
  const record: unknown = JSON.parse(value ?? 'null')
  if (typeof record !== 'object' || record === null) throw new Error('Saved Harness is missing.')
  const h = record as Record<string, unknown>
  const c = h.config as Partial<DeviceConfig> | null | undefined
  if (h.id !== id || typeof h.name !== 'string' || typeof c !== 'object' || c === null
    || typeof c.serverUrl !== 'string' || typeof c.deviceId !== 'string'
    || typeof c.deviceSecret !== 'string' || typeof c.deviceName !== 'string'
    || !Array.isArray(c.endpoints) || !c.endpoints.every(endpoint => typeof endpoint === 'string')) {
    throw new Error('Saved Harness data is invalid.')
  }
  const token = await Preferences.get({ key: `${keyOf(id)}.token` })
  if (token.value === null) throw new Error('Saved Harness token is missing.')
  const customName = await Preferences.get({ key: `${keyOf(id)}.name` })
  return { id, name: customName.value ?? h.name, config: { ...c as DeviceConfig, accessToken: token.value } }
}

/** Load all pairings, migrating the single-Harness installation on first use. */
export function loadHarnesses(): Promise<SavedHarness[]> {
  loading ??= readHarnesses().finally(() => { loading = undefined })
  return loading
}

async function readHarnesses(): Promise<SavedHarness[]> {
  const { value } = await Preferences.get({ key: INDEX })
  if (value === null) {
    const config = await loadConfig()
    const items = config === null ? [] : [await writeNewHarness(config)]
    await Preferences.set({ key: INDEX, value: JSON.stringify(items.map(h => h.id)) })
    if (items[0]) await selectHarness(items[0].id)
    await clearConfig()
    return items
  }
  const ids: unknown = JSON.parse(value)
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('Saved Harness list is invalid.')
  return Promise.all(ids.map(id => readHarness(id)))
}

async function writeNewHarness(config: DeviceConfig): Promise<SavedHarness> {
  const harness = { id: crypto.randomUUID(), name: config.hostName?.trim() || new URL(config.serverUrl).hostname, config }
  await Preferences.set({ key: keyOf(harness.id), value: JSON.stringify(harness) })
  await persistHarnessToken(harness.id, config.accessToken)
  return harness
}

/** Add a pairing without replacing any existing Harness. */
export async function addHarness(config: DeviceConfig): Promise<SavedHarness> {
  const items = await loadHarnesses()
  const harness = await writeNewHarness(config)
  await Preferences.set({ key: INDEX, value: JSON.stringify([...items.map(h => h.id), harness.id]) })
  await selectHarness(harness.id)
  return harness
}

/** Persist which Harness the UI should open next. */
export async function selectHarness(id: string): Promise<void> {
  await Preferences.set({ key: ACTIVE, value: id })
}

/** Read the last selected Harness id. */
export async function activeHarnessId(): Promise<string | null> {
  return (await Preferences.get({ key: ACTIVE })).value
}

/** Forget one local pairing, preserving all others. The caller stops its native channel first. */
export async function removeHarness(id: string): Promise<void> {
  const items = await loadHarnesses()
  await Preferences.set({ key: INDEX, value: JSON.stringify(items.filter(h => h.id !== id).map(h => h.id)) })
  await Preferences.remove({ key: keyOf(id) })
  await Preferences.remove({ key: `${keyOf(id)}.token` })
  await Preferences.remove({ key: `${keyOf(id)}.name` })
  if (await activeHarnessId() === id) await Preferences.remove({ key: ACTIVE })
}

/** Update only this Harness's GUI token. */
export async function persistHarnessToken(id: string, token: string): Promise<void> {
  await Preferences.set({ key: `${keyOf(id)}.token`, value: token })
}

/** Remember a working endpoint without overwriting the independently renewed token. */
export async function persistHarnessOrigin(id: string, origin: string): Promise<void> {
  const harness = await readHarness(id)
  harness.config.serverUrl = origin
  if (!harness.config.endpoints.includes(origin)) harness.config.endpoints.push(origin)
  await Preferences.set({ key: keyOf(id), value: JSON.stringify(harness) })
}

/** Save a local display name independently of endpoint and credential updates. */
export async function renameHarness(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80) throw new Error('Enter a name between 1 and 80 characters.')
  await readHarness(id)
  await Preferences.set({ key: `${keyOf(id)}.name`, value: trimmed })
}
