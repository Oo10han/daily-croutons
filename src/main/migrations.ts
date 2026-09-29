import type { DatabaseSync } from 'node:sqlite'

// 只负责连接配置和 schema 升级；连接的创建、失败清理和关闭仍由 DiaryStore 管理。
// 每一级升级独立提交，因此中途失败后重开可从已完成的版本继续。
export function migrateDatabase(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
  if (version > 3) throw new Error('数据库来自更新版本，请使用相应版本的应用打开')
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
  if (version < 2) {
    // 原地添加账目表；迁移与版本号更新在同一事务内完成。
    db.exec(`BEGIN IMMEDIATE;
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
    db.exec(`BEGIN IMMEDIATE;
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
}
