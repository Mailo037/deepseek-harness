/**
 * The web-search card: which search provider the web seam runs, the DeepSeek
 * provider's endpoint and per-request search budget, and the key — which is
 * written through the credentials domain, never into a settings section, so
 * the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import {
  SEARCH_PROVIDER_OPTIONS,
  type WebSearchCardFace,
} from './web-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the web-search card. */
export type WebSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebSearchCardFace>

/**
 * Render the web-search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebSearchCard(props: WebSearchCardProps) {
  const { t } = props
  const state = props.useWebSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  const providerOptions = SEARCH_PROVIDER_OPTIONS.map(option => ({
    value: option.id,
    label: t(`webSearchProvider${providerLabelKey(option.id)}` as never),
  }))
  return (
    <PluginCard
      t={t}
      titleKey="webSearchTitle"
      descriptionKey="webSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-web-search-provider"
        label={t('webSearchProvider')}
        hint={t('webSearchProviderHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidChoice')}
        disabled={disabled}
        options={providerOptions}
        {...state.provider}
        onEdit={(text) => { props.edit('searchProvider', text) }}
        onReset={() => { props.resetField('searchProvider') }}
      />
      <SecretField
        id="plugin-config-web-search-key"
        label={t('webSearchApiKey')}
        hint={t('webSearchApiKeyRefHint', { ref: state.apiKeyRef })}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('webSearchApiKeySet') : t('webSearchApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-web-search-endpoint"
        label={t('webSearchBaseUrl')}
        hint={t('webSearchBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-web-search-max-uses"
        label={t('webSearchMaxUses')}
        hint={t('webSearchMaxUsesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxUses}
        onEdit={(text) => { props.edit('maxUses', text) }}
        onReset={() => { props.resetField('maxUses') }}
      />
    </PluginCard>
  )
}

/**
 * Turn a provider id into the suffix of its locale key. A provider's display
 * name is product copy, so the id (a stable registry string) never renders.
 * @param id - the provider id.
 * @returns the locale-key suffix, e.g. `deepseek-official` → `DeepseekOfficial`.
 */
function providerLabelKey(id: string): string {
  return id.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}
