import type { Backup } from '../shared/types'
import { validateDiary, validateTransaction, validateMeal, validateWeight, validateId, timestamp } from './validation'

// 统一把 v1/v2/v3 备份解析为四组记录；完整校验成功后才允许进入恢复事务。
export function parseBackup(input: unknown): Pick<Backup, 'diaries' | 'transactions' | 'meals' | 'weights'> {
  if (!input || typeof input !== 'object') throw new Error('备份格式无效')
  const b = input as Omit<Backup, 'version'> & { version: number }
  if (b.format !== 'little-days' || ![1, 2, 3].includes(b.version) || !Array.isArray(b.diaries) || b.diaries.length > 10000) throw new Error('不支持的备份格式或版本')
  const dates = new Set<string>()
  const diaries = b.diaries.map(item => {
    const d = validateDiary(item)
    if (dates.has(d.date)) throw new Error('备份包含重复日期')
    dates.add(d.date)
    timestamp(item.updatedAt)
    return { ...d, updatedAt: item.updatedAt }
  })
  // 旧版备份只有日记，恢复时不修改现有账目。
  if (b.version === 1) return { diaries, transactions: [], meals: [], weights: [] }
  if (!Array.isArray(b.transactions) || b.transactions.length > 100000) throw new Error('备份账目格式无效或超过 100000 笔')
  const ids = new Set<string>()
  const transactions = b.transactions.map(item => {
    const t = validateTransaction(item)
    validateId(t.id)
    if (ids.has(t.id)) throw new Error('备份包含重复账目编号')
    ids.add(t.id)
    timestamp(item.createdAt); timestamp(item.updatedAt)
    return { ...t, id: t.id, createdAt: item.createdAt, updatedAt: item.updatedAt }
  })
  // 老备份缺少的模块不参与恢复，保留已记录的饮食和体重。
  if (b.version === 2) return { diaries, transactions, meals: [], weights: [] }
  if (!Array.isArray(b.meals) || b.meals.length > 100000 || !Array.isArray(b.weights) || b.weights.length > 10000) throw new Error('饮食或体重备份格式无效')
  const mealIds = new Set<string>(), weightDates = new Set<string>()
  const meals = b.meals.map(item => {
    const m = validateMeal(item); validateId(m.id)
    if (mealIds.has(m.id)) throw new Error('备份包含重复饮食编号')
    mealIds.add(m.id); timestamp(item.createdAt); timestamp(item.updatedAt)
    return { ...m, id: m.id, createdAt: item.createdAt, updatedAt: item.updatedAt }
  })
  const weights = b.weights.map(item => {
    const w = validateWeight(item)
    if (weightDates.has(w.date)) throw new Error('备份包含重复体重日期')
    weightDates.add(w.date); timestamp(item.updatedAt)
    return { ...w, updatedAt: item.updatedAt }
  })
  return { diaries, transactions, meals, weights }
}
