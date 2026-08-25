/**
 * `voice` namespace dictionaries.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'voice.start': '开始语音输入',
  'voice.stop': '停止语音输入',
  'voice.error.noSpeech': '未检测到语音，请靠近麦克风重试',
  'voice.error.audioCapture': '无法访问麦克风，请检查设备连接',
  'voice.error.notAllowed': '麦克风权限被拒绝，请在浏览器设置中允许',
  'voice.error.network': '语音识别网络错误，请稍后重试',
  'voice.error.serviceNotAllowed': '语音识别服务不可用，请稍后重试',
  'voice.error.languageNotSupported': '当前语言不受语音识别支持',
  'voice.error.phrasesNotSupported': '当前语言不支持短语提示',
  'voice.error.unknown': '语音识别失败，请重试',
} satisfies Record<string, string>

/** The voice namespace key union. */
export type VoiceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'voice.start': 'Start voice input',
  'voice.stop': 'Stop voice input',
  'voice.error.noSpeech': 'No speech detected — speak closer to the microphone and retry',
  'voice.error.audioCapture': 'Microphone unavailable — check the device connection',
  'voice.error.notAllowed': 'Microphone permission denied — allow it in the browser settings',
  'voice.error.network': 'Speech recognition network error — retry later',
  'voice.error.serviceNotAllowed': 'Speech recognition service unavailable — retry later',
  'voice.error.languageNotSupported': 'The current language is not supported by speech recognition',
  'voice.error.phrasesNotSupported': 'Phrase hints are not supported for the current language',
  'voice.error.unknown': 'Speech recognition failed — retry',
} satisfies Record<string, string>
