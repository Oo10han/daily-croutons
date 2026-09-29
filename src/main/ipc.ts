import { dialog, ipcMain } from 'electron'
import type { DiaryStore } from './database'
import type { WindowController } from './window'
import { createBackupService } from './backup-service'
import { appEvents, type InvokeChannel, type InvokeArgs, type InvokeResult } from '../shared/ipc'

// 启动时注册一次。窗口可在 macOS 上重建，因此每次请求都读取当前窗口。
export function registerIpc(store: DiaryStore, dataDir: string, windows: WindowController): void {
  const backups = createBackupService(store, dataDir, windows.requireWindow)
  function handle<C extends InvokeChannel>(channel: C, fn: (...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      windows.assertTrusted(event)
      // 这里只约束内部接线类型；外部参数仍由 DiaryStore 的校验函数检查。
      return fn(...args as InvokeArgs<C>)
    })
  }

  handle('diary:get', date => store.get(date))
  handle('diary:list', () => store.list())
  handle('diary:save', input => { backups.assertWritable('正在恢复备份，请稍后重试'); return store.save(input) })
  handle('diary:remove', date => { backups.assertWritable(); store.remove(date) })
  handle('transactions:list', month => store.listTransactions(month))
  handle('transactions:save', input => { backups.assertWritable(); return store.saveTransaction(input) })
  handle('transactions:remove', id => { backups.assertWritable(); store.removeTransaction(id) })
  handle('transactions:confirm-discard', async () => {
    const result = await dialog.showMessageBox(windows.requireWindow(), { type: 'question', title: '账目尚未保存', message: '放弃这笔账目的未保存修改？', detail: '已经保存的账目不受影响。', buttons: ['继续编辑', '放弃修改'], defaultId: 0, cancelId: 0 })
    return result.response === 1
  })
  handle('health:list', month => store.listHealth(month))
  handle('health:save-meal', input => { backups.assertWritable(); return store.saveMeal(input) })
  handle('health:remove-meal', id => { backups.assertWritable(); store.removeMeal(id) })
  handle('health:save-weight', input => { backups.assertWritable(); return store.saveWeight(input) })
  handle('health:remove-weight', date => { backups.assertWritable(); store.removeWeight(date) })
  handle('health:confirm-discard', async () => {
    const result = await dialog.showMessageBox(windows.requireWindow(), { type: 'question', title: '记录尚未保存', message: '放弃这次未保存的修改？', buttons: ['继续编辑', '放弃修改'], defaultId: 0, cancelId: 0 })
    return result.response === 1
  })

  handle('backup:export', backups.exportBackup)
  handle('backup:import', backups.importBackup)
  ipcMain.on(appEvents.closeReady, event => {
    windows.assertTrusted(event)
    windows.closeReady()
  })
}
