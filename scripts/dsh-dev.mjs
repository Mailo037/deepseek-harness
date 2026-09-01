#!/usr/bin/env node
/**
 * dsh-dev — one-shot build & run helper for the Harness Remote flow.
 *
 *   node scripts/dsh-dev.mjs web [--trusted-host <ip>] [--full] [-- <dsh flags>]
 *       Build the web frontend, then serve the host GUI on the LAN so the
 *       Android thin client can reach it, passing --trusted-host through.
 *       The LAN IP is auto-detected when --trusted-host is omitted.
 *   node scripts/dsh-dev.mjs build [--apk]
 *       Typecheck and build the Android app's web assets; --apk also builds
 *       the debug APK (Capacitor sync + Gradle).
 *
 * Wired to pnpm scripts: `pnpm dsh:web`, `pnpm dsh:build`.
 */

import { execa } from 'execa'
import { networkInterfaces } from 'node:os'

const args = process.argv.slice(2)
const command = args[0] ?? ''

const flag = name => args.includes(name)
function valueOf(name) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : undefined
}
function passthrough() {
  const index = args.indexOf('--')
  return index >= 0 ? args.slice(index + 1) : []
}

/** First non-internal IPv4, i.e. the LAN address a phone could reach. */
function detectedLanIp() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const info of ifaces ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return undefined
}

/** Run one `pnpm <args>` and stream its output (never capture piped stdio). */
async function run(pnpmArgs, cwd) {
  console.log(`\n[dsh-dev] pnpm ${pnpmArgs.join(' ')}`)
  await execa('pnpm', pnpmArgs, { stdio: 'inherit', cwd })
}

async function help() {
  console.log(`dsh-dev — build & run helper for Harness Remote

  web [--trusted-host <ip>] [--full] [-- <dsh flags>]
      Build the web frontend, then serve the host GUI on the LAN.
      The LAN IP is auto-detected unless --trusted-host is given; extra
      flags after "--" go to the dsh invocation.

  build [--apk]
      Typecheck and build the Android app web assets; --apk also syncs
      Capacitor and builds the debug APK (Gradle).

Examples:
  pnpm dsh:web --trusted-host 192.168.1.5
  pnpm dsh:web                                # uses the detected LAN IP
  pnpm dsh:web --full                          # also rebuild the harness
  pnpm dsh:build --apk`)
}

async function main() {
  if (command === 'web') {
    const trustedHost = valueOf('--trusted-host') ?? detectedLanIp()
    if (flag('--full')) {
      await run(['build'])
    } else {
      await run(['build:web'])
    }
    await run(['dsh', '--profile', 'web', '--trusted-host', trustedHost, ...passthrough()])
  } else if (command === 'build') {
    await run(['mobile:typecheck'])
    await run(['--filter', '@deepseek-ai/dsh-android', 'build'])
    if (flag('--apk')) {
      await run(['--filter', '@deepseek-ai/dsh-android', 'exec', 'cap', 'sync', 'android'])
      // Gradle lives in the generated project; use the correct wrapper on
      // each platform (the android:build script is Unix-only './gradlew').
      const gradle = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew'
      await run([gradle, 'assembleDebug', '--console=plain'], './apps/android/android')
      console.log('\n[dsh-dev] APK: apps/android/android/app/build/outputs/apk/debug/app-debug.apk')
    }
  } else {
    await help()
  }
}

await main()
