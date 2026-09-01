import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tasks = process.argv.slice(2)

if (tasks.length === 0) {
  throw new Error('run-gradle requires at least one Gradle task')
}

const command = process.platform === 'win32'
  ? [process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', 'gradlew.bat', ...tasks]]
  : ['./gradlew', tasks]
const result = spawnSync(command[0], command[1], {
  cwd: resolve(appDir, 'android'),
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
