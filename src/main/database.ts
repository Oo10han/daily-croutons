import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { moods, type Diary, type DiaryInput, type Backup, type DiarySummary, type Transaction, type TransactionInput, type RestoreResult } from '../shared/types'
import { categories, maxAmountCents } from '../shared/finance'
import { mealSlots, type Meal, type MealInput, type Weight, type WeightInput, type HealthMonth } from '../shared/types'

export function validateDate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') throw new Error('日期格式无效')
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
function validateId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('账目编号无效')
}
function timestamp(value: unknown): asserts value is string {
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
function validateMeal(input: unknown): MealInput {
  if (!input || typeof input !== 'object') throw new Error('饮食记录格式无效')
  const m = input as MealInput
  validateDate(m.date)
  if (m.id !== undefined) validateId(m.id)
  if (!mealSlots.includes(m.slot)) throw new Error('请选择餐次')
  if (typeof m.food !== 'string' || !m.food.trim() || m.food.length > 2000) throw new Error('请填写饮食内容，最多 2000 字符')
  if (typeof m.note !== 'string' || m.note.length > 500) throw new Error('备注最多 500 字符')
  return { ...(m.id === undefined ? {} : { id: m.id }), date: m.date, slot: m.slot, food: m.food.trim(), note: m.note }
}
function validateWeight(input: unknown): WeightInput {
  if (!input || typeof input !== 'object') throw new Error('体重记录格式无效')
  const w = input as WeightInput
  validateDate(w.date)
  if (!Number.isSafeInteger(w.grams) || w.grams < 10 || w.grams > 999990 || w.grams % 10 !== 0) throw new Error('体重须为有效数值，最多两位小数')
  if (typeof w.note !== 'string' || w.note.length > 500) throw new Error('备注最多 500 字符')
  return { date: w.date, grams: w.grams, note: w.note }
}
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
export class DiaryStore {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
      if (version > 3) throw new Error('数据库来自更新版本，请使用相应版本的应用打开')
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      if (version < 2) {
        // 原地添加账目表；迁移与版本号更新在同一事务内完成。
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS diaries (
        date TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        mood TEXT NOT NULL, updatedAt TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY, date TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income','expense')),
            amountCents INTEGER NOT NULL CHECK(typeof(amountCents)='integer' AND amountCents > 0 AND amountCents <= 999999999),
            category TEXT NOT NULL, note TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
          PRAGMA user_version=2; COMMIT;`)
      }
      if (version < 3) {
        // 每日体重以日期为主键；饮食用独立编号，允许同一天同一餐多次记录。
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE meals (
            id TEXT PRIMARY KEY, date TEXT NOT NULL, slot TEXT NOT NULL,
            food TEXT NOT NULL, note TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
          );
          CREATE INDEX meals_date ON meals(date);
          CREATE TABLE weights (
            date TEXT PRIMARY KEY, grams INTEGER NOT NULL CHECK(typeof(grams)='integer' AND grams BETWEEN 10 AND 999990 AND grams % 10=0),
            note TEXT NOT NULL, updatedAt TEXT NOT NULL
          );
          PRAGMA user_version=3; COMMIT;`)
      }
    } catch (error) { this.db.close(); throw error }
  }
  get(date: string): Diary | null {
    validateDate(date)
    return this.db.prepare('SELECT * FROM diaries WHERE date=?').get(date) as unknown as Diary ?? null
  }
  list(): DiarySummary[] {
    return this.db.prepare('SELECT date,title,mood FROM diaries ORDER BY date DESC').all() as unknown as DiarySummary[]
  }
  private upsert(d: Diary) {
    this.db.prepare(`INSERT INTO diaries(date,title,body,mood,updatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET title=excluded.title,body=excluded.body,mood=excluded.mood,updatedAt=excluded.updatedAt`)
      .run(d.date, d.title, d.body, d.mood, d.updatedAt)
  }
  save(input: unknown): Diary {
    const d = { ...validateDiary(input), updatedAt: new Date().toISOString() }
    this.upsert(d)
    return d
  }
  remove(date: string) {
    validateDate(date)
    this.db.prepare('DELETE FROM diaries WHERE date=?').run(date)
  }
  backup(): Backup {
    return {
      format: 'little-days', version: 3, exportedAt: new Date().toISOString(),
      diaries: this.db.prepare('SELECT * FROM diaries ORDER BY date').all() as unknown as Diary[],
      transactions: this.db.prepare('SELECT * FROM transactions ORDER BY date,id').all() as unknown as Transaction[],
      meals: this.db.prepare('SELECT * FROM meals ORDER BY date,id').all() as unknown as Meal[],
      weights: this.db.prepare('SELECT * FROM weights ORDER BY date').all() as unknown as Weight[]
    }
  }
  listTransactions(month: string): Transaction[] {
    validateMonth(month)
    return this.db.prepare('SELECT * FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC,createdAt DESC,id DESC').all(`${month}-01`, `${month}-31`) as unknown as Transaction[]
  }
  private upsertTransaction(t: Transaction) {
    this.db.prepare(`INSERT INTO transactions(id,date,type,amountCents,category,note,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET date=excluded.date,type=excluded.type,amountCents=excluded.amountCents,
      category=excluded.category,note=excluded.note,createdAt=excluded.createdAt,updatedAt=excluded.updatedAt`)
      .run(t.id, t.date, t.type, t.amountCents, t.category, t.note, t.createdAt, t.updatedAt)
  }
  saveTransaction(input: unknown): Transaction {
    // 新建由主进程分配编号；编辑沿用编号，供备份合并时识别同一笔账目。
    const t = validateTransaction(input)
    const existing = t.id ? this.db.prepare('SELECT * FROM transactions WHERE id=?').get(t.id) as unknown as Transaction | undefined : undefined
    if (t.id && !existing) throw new Error('该账目已不存在，请刷新后重试')
    const now = new Date().toISOString()
    const row = { ...t, id: t.id ?? randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now }
    this.upsertTransaction(row)
    return row
  }
  removeTransaction(id: string) {
    validateId(id)
    this.db.prepare('DELETE FROM transactions WHERE id=?').run(id)
  }
  restore(input: unknown): RestoreResult {
    // 全量校验后统一写入；各模块按主键合并，重复恢复不会增加重复记录。
    const entries = parseBackup(input)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const d of entries.diaries) this.upsert(d)
      for (const t of entries.transactions) this.upsertTransaction(t)
      for (const m of entries.meals) this.upsertMeal(m)
      for (const w of entries.weights) this.upsertWeight(w)
      this.db.exec('COMMIT')
      return { diaries: entries.diaries.length, transactions: entries.transactions.length, meals: entries.meals.length, weights: entries.weights.length }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  listHealth(month: string): HealthMonth {
    validateMonth(month)
    return {
      meals: this.db.prepare('SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date DESC,createdAt,id').all(`${month}-01`, `${month}-31`) as unknown as Meal[],
      weights: this.db.prepare('SELECT * FROM weights WHERE date >= ? AND date <= ? ORDER BY date').all(`${month}-01`, `${month}-31`) as unknown as Weight[]
    }
  }
  private upsertMeal(m: Meal) {
    this.db.prepare(`INSERT INTO meals(id,date,slot,food,note,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET date=excluded.date,slot=excluded.slot,food=excluded.food,note=excluded.note,createdAt=excluded.createdAt,updatedAt=excluded.updatedAt`)
      .run(m.id, m.date, m.slot, m.food, m.note, m.createdAt, m.updatedAt)
  }
  saveMeal(input: unknown): Meal {
    const m = validateMeal(input)
    const previous = m.id ? this.db.prepare('SELECT createdAt FROM meals WHERE id=?').get(m.id) : undefined
    if (m.id && !previous) throw new Error('这条饮食记录已不存在')
    const now = new Date().toISOString()
    const row = { ...m, id: m.id ?? randomUUID(), createdAt: previous?.createdAt as string ?? now, updatedAt: now }
    this.upsertMeal(row); return row
  }
  removeMeal(id: string) { validateId(id); this.db.prepare('DELETE FROM meals WHERE id=?').run(id) }
  private upsertWeight(w: Weight) {
    this.db.prepare(`INSERT INTO weights(date,grams,note,updatedAt) VALUES(?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET grams=excluded.grams,note=excluded.note,updatedAt=excluded.updatedAt`)
      .run(w.date, w.grams, w.note, w.updatedAt)
  }
  saveWeight(input: unknown): Weight {
    const row = { ...validateWeight(input), updatedAt: new Date().toISOString() }
    this.upsertWeight(row); return row
  }
  removeWeight(date: string) { validateDate(date); this.db.prepare('DELETE FROM weights WHERE date=?').run(date) }
  close() { this.db.close() }
}
