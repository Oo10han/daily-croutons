import { contextBridge, ipcRenderer } from 'electron'
import type { JournalAPI } from '../shared/types'
const api: JournalAPI = {
  get: date => ipcRenderer.invoke('diary:get', date),
  list: () => ipcRenderer.invoke('diary:list'),
  save: input => ipcRenderer.invoke('diary:save', input),
  remove: date => ipcRenderer.invoke('diary:remove', date),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  transactions: {
    list: month => ipcRenderer.invoke('transactions:list', month),
    save: input => ipcRenderer.invoke('transactions:save', input),
    remove: id => ipcRenderer.invoke('transactions:remove', id),
    confirmDiscard: () => ipcRenderer.invoke('transactions:confirm-discard')
  },
  onCloseRequest: callback => {
    ipcRenderer.on('app:close-request', callback)
    return () => ipcRenderer.removeListener('app:close-request', callback)
  },
  closeReady: () => ipcRenderer.send('app:close-ready')
}
contextBridge.exposeInMainWorld('journal', api)
