import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const androidDir = path.join(rootDir, 'android')
const defaultApkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const connectedApkPath = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'unified-msedcl-connected-debug.apk',
)

function run(command, args, options = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            [command, ...args]
              .map((part) => {
                const value = String(part)
                return /[\s"]/u.test(value)
                  ? `"${value.replace(/"/g, '\\"')}"`
                  : value
              })
              .join(' '),
          ],
          {
            stdio: 'inherit',
            shell: false,
            ...options,
          },
        )
      : spawnSync(command, args, {
          stdio: 'inherit',
          shell: false,
          ...options,
        })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function getCommand(base) {
  return process.platform === 'win32' ? `${base}.cmd` : base
}

function copyConnectedApk() {
  if (!fs.existsSync(defaultApkPath)) {
    throw new Error(`APK output not found: ${defaultApkPath}`)
  }

  fs.copyFileSync(defaultApkPath, connectedApkPath)
}

run(getCommand('npm'), ['run', 'build:connected'], { cwd: rootDir })
run(getCommand('npm'), ['run', 'android:sync'], { cwd: rootDir })
run(
  process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
  [
    'assembleDebug',
    '-PconnectedBuild=true',
    '-PappIdOverride=com.qt33.connected',
  ],
  { cwd: androidDir },
)
copyConnectedApk()
console.log(`Connected APK ready: ${connectedApkPath}`)
