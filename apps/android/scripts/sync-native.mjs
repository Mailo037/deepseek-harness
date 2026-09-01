import { cp, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nativeDir = resolve(appDir, 'native')
const androidDir = resolve(appDir, 'android')

async function copy(relative, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await cp(resolve(nativeDir, relative), destination, { recursive: true, force: true })
}

await copy('AndroidManifest.xml', resolve(androidDir, 'app/src/main/AndroidManifest.xml'))
await copy('app.build.gradle', resolve(androidDir, 'app/build.gradle'))
await copy('build.gradle', resolve(androidDir, 'build.gradle'))
await copy('capacitor.plugins.json', resolve(androidDir, 'app/src/main/assets/capacitor.plugins.json'))
await copy('ai', resolve(androidDir, 'app/src/main/java/ai'))
await copy('res', resolve(androidDir, 'app/src/main/res'))
await copy('test', resolve(androidDir, 'app/src/test/java'))
