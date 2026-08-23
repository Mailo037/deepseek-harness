#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  assertAppOutputPath,
  assertFileUnchanged,
  distributionPaths,
  fingerprintFile,
} from './package-paths.mjs'

const ALLOWED_ARGUMENTS = new Set(['--dir', '--win', '--x64'])
const requested = process.argv.slice(2)
const publish = process.env.DSH_ELECTRON_PUBLISH === 'always' ? 'always' : 'never'

if (requested.length === 0 || requested.some(argument => !ALLOWED_ARGUMENTS.has(argument))) {
  throw new Error('Usage: package.mjs --dir --win --x64 | package.mjs --win --x64')
}

const paths = distributionPaths()
assertAppOutputPath(paths.appRoot, paths.output)
const sourcePackageHash = fingerprintFile(paths.rootPackageJson)
const require = createRequire(import.meta.url)
const builder = require.resolve('electron-builder/cli.js')
const child = spawn(process.execPath, [
  builder,
  '--projectDir', paths.appRoot,
  '--config', paths.builderConfig,
  '--config.directories.output', paths.output,
  '--publish', publish,
  ...requested,
], { cwd: paths.appRoot, stdio: 'inherit' })

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', code => resolve(code ?? 1))
})
assertFileUnchanged(paths.rootPackageJson, sourcePackageHash)
process.exitCode = exitCode
