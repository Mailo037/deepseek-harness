/** Host registration for the browser notification-sound preference. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  NOTIFICATION_SETTINGS_NAMESPACE, NotificationSettingsSchema,
} from './notification-settings.ts'

const NOTIFICATION_NAMESPACE = settingsNamespace(NOTIFICATION_SETTINGS_NAMESPACE)

/**
 * Register the durable notification section when the optional Host settings
 * service is composed. Without it the browser scope runs in memory mode and
 * the opt-in stays process-local.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(NOTIFICATION_NAMESPACE, NotificationSettingsSchema)
  })
}
