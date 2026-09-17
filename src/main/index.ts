import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { DiaryStore, parseBackup } from './database'

// Keep development and packaged data paths consistent across app renames.
app.setPath('userData', process.env.LITTLE_DAYS_DATA_DIR || join(app.getPath('appData'), 'Little Days'))
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
let window: BrowserWindow | null = null
let store: DiaryStore
let allowClose = false
let importing = false
const rendererFile = join(__dirname, '../renderer/index.html')
const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined

function trusted(event: IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('不允许的请求')
  const url = event.senderFrame?.url
  if (url !== (devURL ? new URL(devURL).href : pathToFileURL(rendererFile).href)) throw new Error('不允许的来源')
}
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => { trusted(event); return fn(...args) })
}
function createWindow() {
  allowClose = false
  window = new BrowserWindow({
    width: 1220, height: 820, minWidth: 900, minHeight: 650, backgroundColor: '#f7f6f0',
    title: '小日子 · 生活手账', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('close', event => {
    if (!allowClose && !window?.webContents.isDestroyed()) {
      event.preventDefault()
      window?.webContents.send('app:close-request')
    }
  })
  window.on('closed', () => { window = null })
  if (devURL) void window.loadURL(devURL)
  else void window.loadFile(rendererFile)
}

if (gotLock) app.whenReady().then(() => {
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  store = new DiaryStore(join(dataDir, 'journal.sqlite'))
  handle('diary:get', date => store.get(date))
  handle('diary:list', () => store.list())
  handle('diary:save', input => { if (importing) throw new Error('正在恢复备份，请稍后重试'); return store.save(input) })
  handle('diary:remove', date => { if (importing) throw new Error('正在恢复备份'); store.remove(date) })
  handle('backup:export', async () => {
    const result = await dialog.showSaveDialog(window!, { title: '导出日记备份', defaultPath: `little-days-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: '手账备份', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, JSON.stringify(store.backup(), null, 2), 'utf8')
    return true
  })
  handle('backup:import', async () => {
    if (importing) throw new Error('正在恢复备份')
    importing = true
    try {
      const result = await dialog.showOpenDialog(window!, { title: '选择日记备份', properties: ['openFile'], filters: [{ name: '手账备份', extensions: ['json'] }] })
      if (result.canceled || !result.filePaths[0]) return null
      if (statSync(result.filePaths[0]).size > 20 * 1024 * 1024) throw new Error('备份超过 20 MB')
      const backup: unknown = JSON.parse(readFileSync(result.filePaths[0], 'utf8'))
      const entries = parseBackup(backup)
      const answer = await dialog.showMessageBox(window!, { type: 'question', title: '恢复备份', message: `将导入 ${entries.length} 篇日记`, detail: '相同日期的日记将被备份中的内容覆盖，其余日期保留。恢复前会自动保存一份安全备份到应用数据目录。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return null
      writeFileSync(join(dataDir, `before-import-${Date.now()}.json`), JSON.stringify(store.backup()), { encoding: 'utf8', flag: 'wx' })
      return store.restore(backup)
    } finally { importing = false }
  })
  ipcMain.on('app:close-ready', event => { trusted(event); allowClose = true; window?.close() })
  createWindow()
  app.on('activate', () => { if (!window) createWindow() })
}).catch(error => { dialog.showErrorBox('无法启动小日子', String(error)); app.exit(1) })
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => store?.close())
