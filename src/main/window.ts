import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appEvents } from '../shared/ipc'

// 窗口及其信任边界由同一个控制器持有，避免 IPC 使用已经关闭的窗口引用。
export function createWindowController() {
  let window: BrowserWindow | null = null
  let allowClose = false
  const rendererFile = join(__dirname, '../renderer/index.html')
  const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined

  function requireWindow(): BrowserWindow {
    if (!window) throw new Error('窗口未就绪')
    return window
  }

  function assertTrusted(event: IpcMainInvokeEvent | IpcMainEvent): void {
    // 同时校验窗口、主 frame 和精确 URL；仅比较 URL 无法排除其他窗口或子 frame。
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('不允许的请求')
    const url = event.senderFrame?.url
    if (url !== (devURL ? new URL(devURL).href : pathToFileURL(rendererFile).href)) throw new Error('不允许的来源')
  }

  function create(): void {
    allowClose = false
    window = new BrowserWindow({
      width: 1220, height: 820, minWidth: 900, minHeight: 650, backgroundColor: '#f7f6f0',
      title: '小日子 · 生活手账', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.on('close', event => {
      // 关闭握手没有超时强退：保存失败时应留在界面，允许用户重试。
      if (!allowClose && !window?.webContents.isDestroyed()) {
        event.preventDefault()
        window?.webContents.send(appEvents.closeRequest)
      }
    })
    window.on('closed', () => { window = null })
    if (devURL) void window.loadURL(devURL)
    else void window.loadFile(rendererFile)
  }

  function closeReady(): void {
    allowClose = true
    window?.close()
  }

  function focus(): void {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  }

  return { create, current: () => window, requireWindow, assertTrusted, closeReady, focus }
}

export type WindowController = ReturnType<typeof createWindowController>
