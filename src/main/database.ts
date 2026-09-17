import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { moods, type Diary, type DiaryInput, type Backup, type DiarySummary, type Transaction, type TransactionInput, type RestoreResult } from '../shared/types'
import { categories, maxAmountCents } from '../shared/finance'

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
export function parseBackup(input: unknown): Pick<Backup, 'diaries' | 'transactions'> {
  if (!input || typeof input !== 'object') throw new Error('备份格式无效')
  const b = input as Omit<Backup, 'version'> & { version: number }
  if (b.format !== 'little-days' || ![1, 2].includes(b.version) || !Array.isArray(b.diaries) || b.diaries.length > 10000) throw new Error('不支持的备份格式或版本')
  const dates = new Set<string>()
  const diaries = b.diaries.map(item => {
    const d = validateDiary(item)
    if (dates.has(d.date)) throw new Error('备份包含重复日期')
    dates.add(d.date)
    timestamp(item.updatedAt)
    return { ...d, updatedAt: item.updatedAt }
  })
  // 旧版备份只有日记，恢复时不修改现有账目。
  if (b.version === 1) return { diaries, transactions: [] }
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
  return { diaries, transactions }
}
export class DiaryStore {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
      if (version > 2) throw new Error('数据库来自更新版本，请使用相应版本的应用打开')
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
    return { format: 'little-days', version: 2, exportedAt: new Date().toISOString(), diaries: this.db.prepare('SELECT * FROM diaries ORDER BY date').all() as unknown as Diary[], transactions: this.db.prepare('SELECT * FROM transactions ORDER BY date,id').all() as unknown as Transaction[] }
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
    // 全量校验后统一写入两张表；账目按编号合并，重复恢复不会重复记账。
    const entries = parseBackup(input)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const d of entries.diaries) this.upsert(d)
      for (const t of entries.transactions) this.upsertTransaction(t)
      this.db.exec('COMMIT')
      return { diaries: entries.diaries.length, transactions: entries.transactions.length }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  close() { this.db.close() }
}
