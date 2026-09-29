import { app, dialog } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { DiaryStore } from './database'
import { registerIpc } from './ipc'
import { createWindowController } from './window'

// 开发版与安装版共用稳定的数据目录；测试通过环境变量隔离真实用户数据。
app.setPath('userData', process.env.LITTLE_DAYS_DATA_DIR || join(app.getPath('appData'), 'Little Days'))
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
const windows = createWindowController()
let store: DiaryStore | undefined

// 入口只编排生命周期；必须持有单实例锁再打开数据库，避免第二个实例参与写入。
if (gotLock) app.whenReady().then(() => {
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  store = new DiaryStore(join(dataDir, 'journal.sqlite'))
  registerIpc(store, dataDir, windows)
  windows.create()
  app.on('activate', () => { if (!windows.current()) windows.create() })
}).catch(error => {
  dialog.showErrorBox('无法启动小日子', String(error))
  app.exit(1)
})
app.on('second-instance', windows.focus)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => store?.close())
