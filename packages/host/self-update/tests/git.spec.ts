import { describe, expect, it } from 'vitest'
import {
  countBehind, fetchRemotes, GitError, pullFastForward, readIdentity,
  readLatestCommit, readUpstream,
  type GitCommandRunner,
} from '../src/git.ts'

type ScriptedReply = string | readonly string[] | Error

function scripted(replies: Map<string, ScriptedReply>): GitCommandRunner {
  const queues = new Map<string, string[]>()
  for (const [key, value] of replies) {
    if (Array.isArray(value)) queues.set(key, [...value])
  }
  const run: GitCommandRunner = async (args) => {
    const key = args.join(' ')
    const reply = replies.get(key)
    if (reply === undefined) throw new Error(`scripted git: unexpected argv "${key}"`)
    if (reply instanceof Error) throw reply
    if (typeof reply === 'string') return reply
    const next = queues.get(key)?.shift()
    if (next === undefined) throw new Error(`scripted git: exhausted sequence for "${key}"`)
    return next
  }
  return run
}

/** A typed git failure, the shape production's execGit throws. */
function gitFailure(code: GitError['code'], message: string): GitError {
  return new GitError(code, message)
}

describe('self-update git layer', () => {
  it('reads identity with origin, falling back to a sole other remote', async () => {
    const withOrigin = scripted(new Map<string, ScriptedReply>([
      ['-C /repo rev-parse --abbrev-ref HEAD', 'master\n'],
      ['-C /repo rev-parse HEAD', 'a'.repeat(40)],
      ['-C /repo remote get-url origin', 'git@github.com:deepseek-ai/deepseek-harness.git\n'],
    ]))
    await expect(readIdentity('/repo', withOrigin, 1000)).resolves.toEqual({
      branch: 'master',
      commit: 'a'.repeat(40),
      remoteUrl: 'git@github.com:deepseek-ai/deepseek-harness.git',
    })

    const soleRemote = scripted(new Map<string, ScriptedReply>([
      ['-C /repo rev-parse --abbrev-ref HEAD', 'main\n'],
      ['-C /repo rev-parse HEAD', 'b'.repeat(40)],
      ['-C /repo remote get-url origin', gitFailure('git-failed', "remote 'origin' does not exist")],
      ['-C /repo remote', 'upstream\n'],
      ['-C /repo remote get-url upstream', 'https://example.com/repo.git\n'],
    ]))
    await expect(readIdentity('/repo', soleRemote, 1000)).resolves.toMatchObject({
      branch: 'main',
      remoteUrl: 'https://example.com/repo.git',
    })

    const noRemote = scripted(new Map<string, ScriptedReply>([
      ['-C /repo rev-parse --abbrev-ref HEAD', 'main\n'],
      ['-C /repo rev-parse HEAD', 'c'.repeat(40)],
      ['-C /repo remote get-url origin', gitFailure('git-failed', "'origin' does not exist")],
      ['-C /repo remote', '\n'],
    ]))
    await expect(readIdentity('/repo', noRemote, 1000)).resolves.toMatchObject({ remoteUrl: null })
  })

  it('classifies a missing git executable as git-unavailable', async () => {
    const missing: GitCommandRunner = async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    }
    await expect(readUpstream('/repo', missing, 1000)).rejects.toMatchObject({ code: 'git-unavailable' })
  })

  it('refuses an upstream-less branch and counts behind after fetch', async () => {
    const none = scripted(new Map<string, ScriptedReply>([
      ['-C /repo rev-parse --abbrev-ref --symbolic-full-name @{upstream}', '@{upstream}\n'],
    ]))
    await expect(readUpstream('/repo', none, 1000)).rejects.toMatchObject({ code: 'no-upstream' })

    const tracking = scripted(new Map<string, ScriptedReply>([
      ['-C /repo rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'origin/master\n'],
      ['-C /repo fetch', ''],
      ['-C /repo rev-list --count HEAD..origin/master', '3\n'],
    ]))
    await expect(fetchRemotes('/repo', tracking, 1000)).resolves.toBeUndefined()
    await expect(countBehind('/repo', 'origin/master', tracking, 1000)).resolves.toBe(3)
  })

  it('parses the newest upstream commit into hash and subject', async () => {
    const log = scripted(new Map<string, ScriptedReply>([
      ['-C /repo log -1 --format=%H%x00%s origin/master', `d34db33f${'0'.repeat(32)}\u0000feat: newer build\n`],
    ]))
    await expect(readLatestCommit('/repo', 'origin/master', log, 1000)).resolves.toEqual({
      commit: `d34db33f${'0'.repeat(32)}`,
      subject: 'feat: newer build',
    })
  })

  it('fast-forwards only, reporting whether HEAD advanced', async () => {
    const advanced = scripted(new Map<string, ScriptedReply>([
      ['-C /repo rev-parse HEAD', ['old', 'new']],
      ['-C /repo rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'origin/master\n'],
      ['-C /repo fetch', ''],
      ['-C /repo merge --ff-only origin/master', ''],
    ]))
    await expect(pullFastForward('/repo', advanced, 5_000, 1_000)).resolves.toEqual({
      advanced: true, previousCommit: 'old', commit: 'new',
    })

    const diverged = scripted(new Map<string, ScriptedReply>([
      ['-C /repo rev-parse HEAD', 'old'],
      ['-C /repo rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'origin/master\n'],
      ['-C /repo fetch', ''],
      ['-C /repo merge --ff-only origin/master', gitFailure('not-fast-forward', 'Not possible to fast-forward, aborting.')],
    ]))
    await expect(pullFastForward('/repo', diverged, 5_000, 1_000))
      .rejects.toMatchObject({ code: 'not-fast-forward' })
  })
})
