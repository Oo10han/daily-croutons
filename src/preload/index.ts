import { contextBridge, ipcRenderer } from 'electron'
import type { JournalAPI } from '../shared/types'
import { appEvents, type InvokeChannel, type InvokeArgs, type InvokeResult } from '../shared/ipc'

// 通用调用器仅供 preload 内部使用，renderer 只能看到下面列出的业务方法。
function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args)
}

const api: JournalAPI = {
  get: date => invoke('diary:get', date),
  list: () => invoke('diary:list'),
  save: input => invoke('diary:save', input),
  remove: date => invoke('diary:remove', date),
  exportBackup: () => invoke('backup:export'),
  importBackup: () => invoke('backup:import'),
  transactions: {
    list: month => invoke('transactions:list', month),
    save: input => invoke('transactions:save', input),
    remove: id => invoke('transactions:remove', id),
    confirmDiscard: () => invoke('transactions:confirm-discard')
  },
  health: {
    list: month => invoke('health:list', month),
    saveMeal: input => invoke('health:save-meal', input),
    removeMeal: id => invoke('health:remove-meal', id),
    saveWeight: input => invoke('health:save-weight', input),
    removeWeight: date => invoke('health:remove-weight', date),
    confirmDiscard: () => invoke('health:confirm-discard')
  },
  onCloseRequest: callback => {
    // 不把 Electron 的 event 对象传入 renderer；组件卸载时使用返回的函数解绑。
    const listener = () => callback()
    ipcRenderer.on(appEvents.closeRequest, listener)
    return () => ipcRenderer.removeListener(appEvents.closeRequest, listener)
  },
  closeReady: () => ipcRenderer.send(appEvents.closeReady)
}
contextBridge.exposeInMainWorld('journal', api)
