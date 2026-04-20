/* global process */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')

let shuttingDown = false
const children = []

function log(prefix, chunk) {
  const text = chunk.toString()
  process.stdout.write(`[${prefix}] ${text}`)
}

function logError(prefix, chunk) {
  const text = chunk.toString()
  process.stderr.write(`[${prefix}] ${text}`)
}

function startProcess(prefix, command, args) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  })

  child.stdout.on('data', (chunk) => log(prefix, chunk))
  child.stderr.on('data', (chunk) => logError(prefix, chunk))

  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.stderr.write(`[${prefix}] exited with code ${code}\n`)
      shutdown(code || 0)
    }
  })

  children.push(child)
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill()
    }
  }

  setTimeout(() => {
    process.exit(code)
  }, 150)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

startProcess('api', process.execPath, ['--env-file=.env', 'server/index.js'])
startProcess('web', process.execPath, [viteBin])
