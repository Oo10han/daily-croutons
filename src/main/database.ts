import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Diary, Backup, DiarySummary, Transaction, RestoreResult, Meal, Weight, HealthMonth } from '../shared/types'
import { validateDate, validateMonth, validateId, validateDiary, validateTransaction, validateMeal, validateWeight } from './validation'
import { parseBackup } from './backup-format'
import { migrateDatabase } from './migrations'

// 保留原有导出入口，现有调用方和测试无需跟随内部拆分修改。
export { validateDate, validateMonth, validateDiary, validateTransaction } from './validation'
export { parseBackup } from './backup-format'

// 唯一的业务持久化入口：持有一个连接，保证跨模块恢复使用同一事务。
// SQL 使用绑定参数；所有公开写入方法和查询条件都在执行前做运行时校验。
export class DiaryStore {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    try {
      migrateDatabase(this.db)
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
    // 日期在入口已验证且格式固定，字符串排序等同日期排序；-31 作为包含式上界也适用短月。
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
    // 编辑必须命中现有编号，保留创建时间；防止过期表单重新创建已删除记录。
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
    // 体重按日期覆盖，与按 UUID 区分多条记录的饮食不同。
    const row = { ...validateWeight(input), updatedAt: new Date().toISOString() }
    this.upsertWeight(row); return row
  }
  removeWeight(date: string) { validateDate(date); this.db.prepare('DELETE FROM weights WHERE date=?').run(date) }
  close() { this.db.close() }
}
