const { existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const REQUIRED_PATHS = [
  'qwicks/package-lock.json',
  'qwicks/node_modules/diff/package.json',
  'qwicks/node_modules/zod/package.json',
  'qwicks/node_modules/@modelcontextprotocol/sdk/package.json'
]

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    }
  })
}

function ensureQWicksInstall() {
  if (!REQUIRED_PATHS.every((path) => existsSync(path))) {
    const installQWicks = run('npm', ['--prefix', 'qwicks', 'ci'])
    if (installQWicks.status !== 0) {
      process.exit(installQWicks.status || 1)
    }
  }

}

ensureQWicksInstall()
