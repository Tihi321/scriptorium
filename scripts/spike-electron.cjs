// Electron main for the sqlite spike: runs scripts/spike-sqlite.mjs inside a utilityProcess.
const { app, utilityProcess } = require('electron')
const path = require('node:path')

app.whenReady().then(() => {
  console.log('[spike] electron', process.versions.electron, 'node', process.versions.node)
  const child = utilityProcess.fork(path.join(__dirname, 'spike-sqlite.mjs'), [], { stdio: 'pipe' })
  child.stdout.on('data', (d) => process.stdout.write('[child] ' + d))
  child.stderr.on('data', (d) => process.stdout.write('[child:err] ' + d))
  child.on('exit', (code) => {
    console.log('[spike] child exit code', code)
    app.exit(code ?? 1)
  })
  setTimeout(() => app.exit(2), 30000)
})
