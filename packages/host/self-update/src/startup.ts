/**
 * Detached source-checkout updater. It is a separate build entry so the
 * running helper remains in memory while `git pull` replaces its source.
 */

import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPDATE_STATUS_PATH = '/__dsh_update/status'
const PARENT_POLL_MS = 100
const PORT_RETRY_MS = 100
const PORT_RELEASE_TIMEOUT_MS = 15_000
const STATUS_LOG_LIMIT = 80
const STATUS_LOG_LINE_MAX_CHARS = 1_000

type UpdatePhase = 'waiting' | 'pulling' | 'building' | 'starting' | 'failed'

interface UpdatePlan {
  version: 1
  updateId: string
  parentPid: number
  root: string
  host: '127.0.0.1' | '0.0.0.0'
  port: number
  node: string
  pnpmCli: string
  restartArgs: string[]
  logPath: string
  issueUrl: string
}

interface UpdateLogLine {
  seq: number
  stream: 'system' | 'stdout' | 'stderr'
  text: string
}

interface UpdateProgress {
  updateId: string
  phase: UpdatePhase
  status: string
  logs: UpdateLogLine[]
  logLimit: number
  issueUrl: string
  error?: string
}

/** Validate the encoded durable process input before executing any command. */
function readPlan(encoded: string | undefined): UpdatePlan {
  if (encoded === undefined) throw new Error('missing update plan')
  const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid update plan')
  const plan = value as Partial<UpdatePlan>
  if (plan.version !== 1 || typeof plan.updateId !== 'string' || plan.updateId === '') throw new Error('invalid update identity')
  if (!Number.isSafeInteger(plan.parentPid) || (plan.parentPid ?? 0) <= 0) throw new Error('invalid parent pid')
  if (typeof plan.root !== 'string' || !isAbsolute(plan.root)) throw new Error('invalid repository root')
  if (plan.host !== '127.0.0.1' && plan.host !== '0.0.0.0') throw new Error('invalid update host')
  if (!Number.isInteger(plan.port) || (plan.port ?? 0) <= 0 || (plan.port ?? 0) > 65_535) throw new Error('invalid update port')
  if (typeof plan.node !== 'string' || !isAbsolute(plan.node)) throw new Error('invalid Node executable')
  if (typeof plan.pnpmCli !== 'string' || !isAbsolute(plan.pnpmCli)) throw new Error('invalid pnpm executable')
  if (!Array.isArray(plan.restartArgs) || !plan.restartArgs.every(arg => typeof arg === 'string')) throw new Error('invalid restart argv')
  if (typeof plan.logPath !== 'string' || !isAbsolute(plan.logPath)) throw new Error('invalid update log path')
  if (typeof plan.issueUrl !== 'string' || !isGitHubIssueUrl(plan.issueUrl)) throw new Error('invalid issue URL')
  return plan as UpdatePlan
}

function isGitHubIssueUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && /^\/[^/]+\/[^/]+\/issues\/new$/u.test(url.pathname)
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

interface PnpmLaunch {
  executable: string
  prefix: string[]
}

/**
 * Resolve how to run the pnpm CLI captured by `npm_execpath`. A standalone pnpm
 * install can be a native executable (`pnpm.exe`, `.cmd`, `.bat`) that Node
 * cannot load as a module, so such a CLI must be spawned directly rather than
 * via `node <cli>`. A `.cjs`/`.js` pnpm shim is a Node script and keeps running
 * under `node <cli>`.
 */
function pnpmLaunch(plan: UpdatePlan): PnpmLaunch {
  const ext = extname(plan.pnpmCli).toLowerCase()
  return ext === '.exe' || ext === '.cmd' || ext === '.bat'
    ? { executable: plan.pnpmCli, prefix: [] }
    : { executable: plan.node, prefix: [plan.pnpmCli] }
}

function parentAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForParent(pid: number): Promise<void> {
  while (parentAlive(pid)) await delay(PARENT_POLL_MS)
}

async function listen(server: Server, plan: UpdatePlan): Promise<void> {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS
  while (true) {
    try {
      await new Promise<void>((resolveListen, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          server.off('error', onError)
          resolveListen()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(plan.port, plan.host)
      })
      return
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || Date.now() >= deadline) throw error
      await delay(PORT_RETRY_MS)
    }
  }
}

async function command(
  executable: string,
  args: readonly string[],
  cwd: string,
  onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const child = spawn(executable, [...args], {
    cwd,
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const readLines = async (stream: NodeJS.ReadableStream, kind: 'stdout' | 'stderr'): Promise<void> => {
    let pending = ''
    stream.setEncoding('utf8')
    for await (const chunk of stream) {
      pending += String(chunk)
      const lines = pending.split(/\r?\n/u)
      pending = lines.pop() ?? ''
      for (const line of lines) onLine(kind, line)
    }
    if (pending !== '') onLine(kind, pending)
  }
  const exited = new Promise<void>((resolveCommand, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand()
      else reject(new Error(`command exited with ${code === null ? `signal ${String(signal)}` : `code ${String(code)}`}`))
    })
  })
  await Promise.all([exited, readLines(child.stdout, 'stdout'), readLines(child.stderr, 'stderr')])
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) resolveClose()
      else reject(error)
    })
  })
}

/**
 * Run the update plan and retain a failed status server for browser diagnosis.
 * @param encoded - Base64url-encoded durable handoff plan.
 */
export async function runUpdate(encoded: string | undefined): Promise<void> {
  const plan = readPlan(encoded)
  let nextLogSeq = 1
  const logs: UpdateLogLine[] = []
  const appendLog = (stream: UpdateLogLine['stream'], text: string): void => {
    const normalized = text.replace(/\p{C}+/gu, ' ').trimEnd()
    if (normalized === '') return
    logs.push({ seq: nextLogSeq++, stream, text: normalized.slice(0, STATUS_LOG_LINE_MAX_CHARS) })
    if (logs.length > STATUS_LOG_LIMIT) logs.splice(0, logs.length - STATUS_LOG_LIMIT)
  }
  let progress: UpdateProgress = {
    updateId: plan.updateId,
    phase: 'waiting',
    status: 'Waiting for the running app to close…',
    logs,
    logLimit: STATUS_LOG_LIMIT,
    issueUrl: plan.issueUrl,
  }
  const writeLog = async (line: string): Promise<void> => {
    await appendFile(plan.logPath, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => undefined)
  }
  appendLog('system', 'Update runner started; waiting for the current app to release its port.')
  await writeLog('update runner started')
  await waitForParent(plan.parentPid)
  const server = createServer((request, response) => {
    if (request.url?.split('?', 1)[0] !== UPDATE_STATUS_PATH) {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'access-control-allow-origin': '*',
    })
    response.end(JSON.stringify(progress))
  })
  await listen(server, plan)
  try {
    progress = { ...progress, phase: 'pulling', status: 'Pulling the latest changes…' }
    appendLog('system', '$ git pull --ff-only')
    await writeLog('git pull --ff-only')
    await command('git', ['-C', plan.root, 'pull', '--ff-only'], plan.root, appendLog, {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    })
    progress = { ...progress, phase: 'building', status: 'Building the updated app…' }
    appendLog('system', '$ pnpm run build')
    await writeLog('pnpm run build')
    const build = pnpmLaunch(plan)
    await command(build.executable, [...build.prefix, 'run', 'build'], plan.root, appendLog)
    progress = { ...progress, phase: 'starting', status: 'Starting the updated app…' }
    appendLog('system', '$ pnpm dsh web --no-open')
    await writeLog('starting updated web host')
    await delay(250)
    await close(server)
    const relaunch = pnpmLaunch(plan)
    const child = spawn(relaunch.executable, [...relaunch.prefix, ...plan.restartArgs.slice(1)], {
      cwd: plan.root,
      env: process.env,
      detached: true,
      stdio: 'ignore',
    })
    await new Promise<void>((resolveSpawn, reject) => {
      child.once('spawn', resolveSpawn)
      child.once('error', reject)
    })
    child.unref()
    await writeLog('updated web host spawned')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    appendLog('stderr', message)
    progress = { ...progress, phase: 'failed', status: 'Update failed', error: message }
    await writeLog(`update failed: ${message}`)
    if (!server.listening) await listen(server, plan).catch(() => undefined)
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  void runUpdate(process.argv[2]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
