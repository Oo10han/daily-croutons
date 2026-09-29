import { moods, mealSlots, type DiaryInput, type TransactionInput, type MealInput, type WeightInput } from '../shared/types'
import { categories, maxAmountCents } from '../shared/finance'

// IPC 和备份都属于外部输入：先校验，再返回仅包含允许字段的新对象。
// TypeScript 类型不能替代这里的运行时校验；本模块不访问数据库。
export function validateDate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') throw new Error('日期格式无效')
  // Date 会把 2 月 30 日归一化到下个月，必须回转比较，不能仅检查能否解析。
  const parsed = new Date(value + 'T12:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('日期不存在')
}
export function validateDiary(input: unknown): DiaryInput {
  if (!input || typeof input !== 'object') throw new Error('日记格式无效')
  const d = input as DiaryInput
  validateDate(d.date)
  if (typeof d.title !== 'string' || d.title.length > 120) throw new Error('标题最多 120 字')
  if (typeof d.body !== 'string' || d.body.length > 100000) throw new Error('正文最多 100000 字')
  if (!moods.includes(d.mood)) throw new Error('心情无效')
  return { date: d.date, title: d.title, body: d.body, mood: d.mood }
}
export function validateMonth(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw new Error('月份格式无效')
  validateDate(`${value}-01`)
}
export function validateId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('账目编号无效')
}
export function timestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new Error('备份时间无效')
}
export function validateTransaction(input: unknown): TransactionInput {
  if (!input || typeof input !== 'object') throw new Error('账目格式无效')
  const t = input as TransactionInput
  validateDate(t.date)
  if (t.type !== 'income' && t.type !== 'expense') throw new Error('请选择收入或支出')
  if (!Number.isSafeInteger(t.amountCents) || t.amountCents <= 0 || t.amountCents > maxAmountCents) throw new Error('金额须为有效的正整数分')
  if (!categories[t.type].includes(t.category)) throw new Error('分类与收支类型不匹配')
  if (typeof t.note !== 'string' || t.note.length > 500) throw new Error('备注最多 500 字符')
  if (t.id !== undefined) validateId(t.id)
  return { date: t.date, type: t.type, amountCents: t.amountCents, category: t.category, note: t.note, ...(t.id === undefined ? {} : { id: t.id }) }
}
export function validateMeal(input: unknown): MealInput {
  if (!input || typeof input !== 'object') throw new Error('饮食记录格式无效')
  const m = input as MealInput
  validateDate(m.date)
  if (m.id !== undefined) validateId(m.id)
  if (!mealSlots.includes(m.slot)) throw new Error('请选择餐次')
  if (typeof m.food !== 'string' || !m.food.trim() || m.food.length > 2000) throw new Error('请填写饮食内容，最多 2000 字符')
  if (typeof m.note !== 'string' || m.note.length > 500) throw new Error('备注最多 500 字符')
  return { ...(m.id === undefined ? {} : { id: m.id }), date: m.date, slot: m.slot, food: m.food.trim(), note: m.note }
}
export function validateWeight(input: unknown): WeightInput {
  if (!input || typeof input !== 'object') throw new Error('体重记录格式无效')
  const w = input as WeightInput
  validateDate(w.date)
  if (!Number.isSafeInteger(w.grams) || w.grams < 10 || w.grams > 999990 || w.grams % 10 !== 0) throw new Error('体重须为有效数值，最多两位小数')
  if (typeof w.note !== 'string' || w.note.length > 500) throw new Error('备注最多 500 字符')
  return { date: w.date, grams: w.grams, note: w.note }
}
