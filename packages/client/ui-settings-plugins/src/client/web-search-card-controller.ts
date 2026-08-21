/**
 * The web-search card's staged form over two settings namespaces: the
 * `web-search` selection scope (which search provider the web seam runs) and
 * the `web-search-deepseek` provider section (endpoint and request budget).
 *
 * The key is the one control that does not live in a section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * selected provider resolves. It is still staged with the rest of the form, so
 * one save covers everything the card shows.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the DeepSeek search provider section. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_SEARCH_NS = 'web-search-deepseek'

/**
 * Namespace of the web seam's provider selection. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_SEARCH_SELECT_NS = 'web-search'

/** Field of the selection scope this card's select control edits. */
export const PROVIDER_FIELD = 'searchProvider'

/** Provider the composition selects when nothing overrides the section. */
export const DEFAULT_PROVIDER_ID = 'deepseek-official'

/** Credential reference the DeepSeek provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/**
 * One selectable search provider: the id it registers under with `ctx.web` and
 * the credential reference its key is stored at. The ids are stable public
 * strings of the provider packages; the client must know them to address the
 * right credential, and it spells them rather than importing Host packages.
 */
export interface SearchProviderOption {
  /** Provider id as registered with the web seam. */
  id: string
  /** Credential reference its API key is stored at. */
  defaultApiKeyRef: string
}

/** The providers the card can select. Order is the select's order. */
export const SEARCH_PROVIDER_OPTIONS: readonly SearchProviderOption[] = [
  { id: 'deepseek-official', defaultApiKeyRef: 'DEEPSEEK_API_KEY' },
  { id: 'exa', defaultApiKeyRef: 'EXA_API_KEY' },
  { id: 'perplexity', defaultApiKeyRef: 'PERPLEXITY_API_KEY' },
  { id: 'firecrawl', defaultApiKeyRef: 'FIRECRAWL_API_KEY' },
]

/** The search-provider fields this card edits. */
export interface WebSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Maximum searches served within one request. */
  maxUses?: number
}

/** The selection-scope fields this card edits. */
export interface WebSearchSelection {
  /** Provider id the web seam runs; blank inherits the composition default. */
  searchProvider?: string
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/** What the web-search card renders. */
export interface WebSearchCardState extends CardShell {
  /** The selected search provider id (staged draft text). */
  provider: CardFieldState
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Searches allowed per request. */
  maxUses: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
  /** The credential reference the selected provider resolves. */
  apiKeyRef: string
}

/** The registration-side face the web-search card's slot entry injects. */
export interface WebSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
}

/**
 * Bridges the selection scope, the `web-search-deepseek` scope, and the
 * credentials domain onto the card. Two forms share one staged save: the
 * provider select writes the selection section, everything else writes the
 * provider section, and the key writes the credentials domain.
 */
export class WebSearchCardController {
  private readonly form: CardForm<WebSearchSettings>
  private readonly selectForm: CardForm<WebSearchSelection>
  private readonly store: SnapshotStore<WebSearchCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search-deepseek` namespace.
   * @param selectScope - the bound settings scope for the `web-search` selection namespace.
   * @param api - wire face used for the credential the selected provider references.
   */
  constructor(
    private readonly scope: SettingsScope<WebSearchSettings>,
    selectScope: SettingsScope<WebSearchSelection>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [textField('baseURL'), numberField('maxUses')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    // A select accepts exactly the option ids; text conversion is the same
    // clear-or-set shape as a free-text field.
    this.selectForm = new CardForm(selectScope, [textField(PROVIDER_FIELD)])
    this.store = this.form.bind(() => this.projection())
    // The selection form's own store is never read; its staged edits and scope
    // changes must still republish the combined projection the card reads.
    // Staging is covered by the routed actions below; document writes by the
    // scope subscriptions.
    scope.subscribe(() => { void this.readCredential() })
    selectScope.subscribe(() => { this.store.set(this.projection()); void this.readCredential() })
    void this.readCredential()
  }

  private projection(): WebSearchCardState {
    return {
      ...this.shell(),
      provider: this.selectForm.field(PROVIDER_FIELD),
      baseURL: this.form.field('baseURL'),
      maxUses: this.form.field('maxUses'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      apiKeyRef: refOf(this.scope.getSnapshot(), this.selectedProvider()),
    }
  }

  /** The card-level state a save of either form would leave. */
  private shell(): CardShell {
    const section = this.form.shell()
    const selection = this.selectForm.shell()
    return {
      available: section.available && selection.available,
      writable: section.writable && selection.writable,
      dirty: section.dirty || selection.dirty,
      invalid: section.invalid || selection.invalid,
      saving: section.saving || selection.saving,
      failed: section.failed || selection.failed,
    }
  }

  /** The provider id the card currently shows (staged draft or effective value). */
  private selectedProvider(): string {
    const text = this.selectForm.field(PROVIDER_FIELD).text
    return text.length > 0 ? text : DEFAULT_PROVIDER_ID
  }

  /**
   * Ask the credentials domain about the reference the selected provider names.
   *
   * The answer is stored with the reference it describes: the selection (or
   * `apiKeyEnv`) can change between the request and its response, and two reads
   * can settle out of order, so a response is published only while it still
   * answers for the reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot(), this.selectedProvider())
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      // The card stays usable without this: the key control simply reports the
      // last state it knew, and a write still reaches the Host.
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot(), this.selectedProvider())) return
    const view = response.result.value.credentials[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the card guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects. The actions route by
   * field name: the provider select edits the selection scope, everything else
   * the provider section, and saving writes both forms plus the key.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WebSearchCardFace {
    const section = this.form.actions()
    const selection = this.selectForm.actions()
    return {
      hooks: { webSearchCard: this.store },
      edit: (field, text) => {
        if (field === PROVIDER_FIELD) {
          selection.edit(field, text)
          this.store.set(this.projection())
        } else {
          section.edit(field, text)
        }
      },
      resetField: (field) => {
        if (field === PROVIDER_FIELD) {
          selection.resetField(field)
          this.store.set(this.projection())
        } else {
          section.resetField(field)
        }
      },
      save: () => {
        section.save()
        selection.save()
      },
      discard: () => {
        section.discard()
        selection.discard()
        this.store.set(this.projection())
      },
    }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({
        ref: refOf(this.scope.getSnapshot(), this.selectedProvider()),
        value,
      })
    } catch (_credentialWriteFailure) {
      // Refusals surface through the re-read below: the Host is the only
      // authority on whether the key now exists.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the selected provider resolves: the deepseek
 * section's `apiKeyEnv` names a reference only for the DeepSeek provider (its
 * schema default would otherwise misaddress every other provider's key); every
 * other provider resolves its own stable reference.
 * @param snapshot - the current provider-section scope snapshot.
 * @param providerId - the currently selected provider id.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<WebSearchSettings>, providerId: string): string {
  if (providerId === DEFAULT_PROVIDER_ID) {
    const declared = snapshot.value?.apiKeyEnv
    if (declared !== undefined && declared.length > 0) return declared
  }
  return SEARCH_PROVIDER_OPTIONS.find(option => option.id === providerId)?.defaultApiKeyRef
    ?? DEFAULT_API_KEY_REF
}
