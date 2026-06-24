const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

// 品牌升级后构建环境变量改用 QWICKS_* 前缀;旧的 DEEPSEEK_GUI_* 仍然
// 兼容读取,避免 CI / 本地发布脚本一刀切失效。
function envWithLegacyFallback(qwicksName, legacyName) {
  const value = process.env[qwicksName]
  if (value !== undefined && value !== '') return value
  return process.env[legacyName]
}

function loadLocalReleaseEnv() {
  const candidates = [
    envWithLegacyFallback('QWICKS_RELEASE_ENV', 'DEEPSEEK_GUI_RELEASE_ENV'),
    join(__dirname, 'scripts', 'release.local.env'),
    join(__dirname, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
    break
  }
}

loadLocalReleaseEnv()

const hasExplicitMacSigningIdentity = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
)

const hasNotaryToolCredentials = Boolean(
  process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER &&
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_BASE64)
)

const updateChannel = normalizeUpdateChannel(
  envWithLegacyFallback('QWICKS_UPDATE_CHANNEL', 'DEEPSEEK_GUI_UPDATE_CHANNEL') || 'stable'
)
const defaultUpdateBaseUrl = 'http://8.138.40.16/qwicks'
const updateBaseUrl = (
  process.env.QWICKS_UPDATE_BASE_URL ||
    process.env.PUBLIC_DOWNLOAD_BASE_URL ||
    defaultUpdateBaseUrl
).trim().replace(/\/+$/, '')
const genericUpdateUrl = `${updateBaseUrl}/channels/${updateChannel}/latest/`
const releaseAppVersion = (
  envWithLegacyFallback('QWICKS_APP_VERSION', 'DEEPSEEK_GUI_APP_VERSION') || ''
).trim()
const artifactVersion = releaseAppVersion || '${version}'

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`QWICKS_UPDATE_CHANNEL (or legacy DEEPSEEK_GUI_UPDATE_CHANNEL) must be "stable" or "frontier", got: ${raw}`)
}

if (releaseAppVersion && !/^\d+\.\d+\.\d+$/.test(releaseAppVersion)) {
  throw new Error(
    `QWICKS_APP_VERSION (or legacy DEEPSEEK_GUI_APP_VERSION) must be a valid x.y.z semver for electron-updater, got: ${releaseAppVersion}`
  )
}

module.exports = {
  appId: 'com.given33.qwicks',
  productName: 'QWicks',
  // Native modules (better-sqlite3, node-pty, etc.) must live outside the
  // ASAR archive. Hot-code updates ship JS only and resolve these modules
  // through NODE_PATH → the bundled app.asar.unpacked/qwicks/node_modules.
  asar: true,
  asarUnpack: [
    '**/qwicks/dist/**/*',
    '**/qwicks/package*.json',
    '**/qwicks/node_modules/**/*',
    '**/node_modules/better-sqlite3/**/*',
    '**/node_modules/node-pty/**/*',
    '**/node_modules/bindings/**/*',
    '**/node_modules/file-uri-to-path/**/*',
    // Computer-use native automation (@computer-use/nut-js + its libnut
    // binding + node-mac-permissions) ships prebuilt .node files that must
    // live outside the asar archive to load.
    '**/node_modules/@computer-use/**/*'
  ],
  npmRebuild: false,
  nodeGypRebuild: false,
  directories: {
    output: envWithLegacyFallback('QWICKS_DIST_DIR', 'DEEPSEEK_GUI_DIST_DIR') || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    'qwicks/dist/**/*',
    'qwicks/package.json',
    'qwicks/package-lock.json',
    'qwicks/node_modules/**/*',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*'
    // node_modules/openclaw (the vendor/openclaw-shim file: dep) must ship:
    // the WeChat bridge imports @tencent-weixin/openclaw-weixin/dist at
    // runtime to send media, and that chain resolves openclaw/plugin-sdk/*.
  ],
  extraFiles: [
    {
      from: 'build/icon.ico',
      to: 'QWicks.ico'
    }
  ],
  artifactName: `QWicks-${artifactVersion}-\${os}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: genericUpdateUrl
    }
  ],
  afterPack: './scripts/after-pack.cjs',
  afterSign: './scripts/mac-notarize.cjs',
  mac: {
    category: 'public.app-category.developer-tools',
    identity: hasExplicitMacSigningIdentity ? undefined : null,
    // We notarize in scripts/mac-notarize.cjs so APPLE_API_KEY_BASE64 can be supported.
    notarize: false,
    hardenedRuntime: hasExplicitMacSigningIdentity,
    forceCodeSigning: hasExplicitMacSigningIdentity,
    timestamp: hasExplicitMacSigningIdentity ? 'http://timestamp.apple.com/ts01' : null,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      // 语音输入：渲染进程通过 getUserMedia 录音做语音转文字。
      NSMicrophoneUsageDescription: 'QWicks uses the microphone for voice-to-text input.'
    },
    // macOS 不会自动套圆角遮罩,图标文件本身需要是「圆角方块 + 透明边距」
    icon: './src/asset/img/qwicks_mac.png',
    // arm64 (Apple Silicon) + x64 (Intel). On M 系列 Mac 本地打包会各出一组 dmg/zip。
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: {
    sign: hasExplicitMacSigningIdentity
  },
  win: {
    signAndEditExecutable: false,
    // Windows does not mask app icons for us; use the rounded asset so
    // desktop/start-menu/taskbar shortcuts do not show a hard square edge.
    // Ship a multi-size .ico (16/24/32/48/64/72/96/128/256) so Explorer and
    // the desktop render crisp icons at small sizes (#222). Regenerate with:
    // npx --yes png2icons src/asset/img/qwicks_mac.png build/icon -icowe -bc
    icon: './build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    selectPerMachineByDefault: false,
    installerIcon: './build/icon.ico',
    uninstallerIcon: './build/icon.ico',
    installerHeaderIcon: './build/icon.ico',
    // 明确创建快捷方式；always 在覆盖安装时也会重建（即使用户曾删掉桌面图标）
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'QWicks',
    uninstallDisplayName: 'QWicks',
    deleteAppDataOnUninstall: false
  },
  linux: {
    category: 'Development',
    icon: './src/asset/img/qwicks.png',
    target: [{ target: 'AppImage', arch: ['x64'] }]
  },
  extraMetadata: {
    ...(releaseAppVersion ? { version: releaseAppVersion } : {}),
    updateChannel,
    buildHints: {
      macSigningEnabled: hasExplicitMacSigningIdentity,
      notarizationEnabled: hasNotaryToolCredentials
    }
  }
}
