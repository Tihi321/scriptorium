'use strict'
// electron-builder configuration (a .cjs file, like the ACP proxy's). Output goes to release/ (gitignored).
module.exports = {
  appId: 'com.tihi321.scriptorium',
  productName: 'Scriptorium',
  copyright: 'Tihomir Selak',
  directories: { output: 'release', buildResources: 'build' },
  npmRebuild: false,
  files: ['out/**/*', '!out/**/*.map', 'package.json'],
  // No asar archive. sqlite-vec's loadable vec0.dll and the keyring .node file cannot be used from inside an archive,
  // and the engine (a separate process) resolves sqlite-vec with require.resolve, which returns an `app.asar` path
  // that SQLite cannot open. Without the archive every path is a real file path (no asarUnpack needed).
  asar: false,
  extraResources: [
    // The first-run data folder is copied from here (main passes --seed to the engine).
    { from: 'seed', to: 'seed' },
    { from: 'build/icon.png', to: 'icon.png' }
  ],
  win: {
    icon: 'build/icon.ico',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ]
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    artifactName: 'Scriptorium-Setup-${version}-${arch}.${ext}'
  },
  portable: { artifactName: 'Scriptorium-Portable-${version}-${arch}.${ext}' }
}
