import type { Transaction, TransactionType } from './types'

export const categories: Record<TransactionType, readonly string[]> = {
  expense: ['餐饮', '交通', '购物', '居家', '娱乐', '健康', '学习', '人情', '其他'],
  income: ['工资', '奖金', '兼职', '红包', '其他']
}
export const maxAmountCents = 999999999
// 将金额字符串拆为元和分，避免浮点乘法产生分位误差。
export function parseAmount(value: string): number {
  const text = value.trim()
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new Error('请输入正数金额，最多两位小数')
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (cents <= 0 || cents > maxAmountCents) throw new Error('金额须在 0.01～9,999,999.99 元之间')
  return cents
}
export function amountText(cents: number): string { return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` }
export function money(cents: number): string { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100) }
export function totals(rows: Transaction[]) {
  // 所有汇总都以整数分计算，仅展示时转换为元。
  const income = rows.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amountCents, 0)
  const expense = rows.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amountCents, 0)
  return { income, expense, balance: income - expense }
}
