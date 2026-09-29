import { dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import type { DiaryStore } from './database'
import { parseBackup } from './backup-format'

// 负责文件和对话框流程；格式兼容由 backup-format 负责，原子合并由 DiaryStore 负责。
export function createBackupService(store: DiaryStore, dataDir: string, getWindow: () => BrowserWindow) {
  let importing = false

  function assertWritable(message = '正在恢复备份') {
    if (importing) throw new Error(message)
  }

  async function exportBackup() {
    const result = await dialog.showSaveDialog(getWindow(), { title: '导出全部手账记录', defaultPath: `little-days-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: '手账备份', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, JSON.stringify(store.backup(), null, 2), 'utf8')
    return true
  }
  async function importBackup() {
    if (importing) throw new Error('正在恢复备份')
    // 从打开文件选择框起加锁；原生对话框等待期间，其他 IPC 仍可能到达。
    importing = true
    try {
      const result = await dialog.showOpenDialog(getWindow(), { title: '选择手账备份', properties: ['openFile'], filters: [{ name: '手账备份', extensions: ['json'] }] })
      if (result.canceled || !result.filePaths[0]) return null
      if (statSync(result.filePaths[0]).size > 20 * 1024 * 1024) throw new Error('备份超过 20 MB')
      const backup: unknown = JSON.parse(readFileSync(result.filePaths[0], 'utf8'))
      const entries = parseBackup(backup)
      const answer = await dialog.showMessageBox(getWindow(), { type: 'question', title: '恢复备份', message: `导入 ${entries.diaries.length} 篇日记、${entries.transactions.length} 笔账目、${entries.meals.length} 条饮食、${entries.weights.length} 条体重`, detail: '日记和体重按日期合并，账目和饮食按编号合并；其他记录保留。旧版备份不改变缺少的模块。恢复前会自动保存一份安全备份。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return null
      // 安全备份必须写入成功后才合并；wx 防止意外覆盖同名文件。
      writeFileSync(join(dataDir, `before-import-${Date.now()}.json`), JSON.stringify(store.backup()), { encoding: 'utf8', flag: 'wx' })
      return store.restore(backup)
    } finally { importing = false }
  }

  return { exportBackup, importBackup, assertWritable }
}
