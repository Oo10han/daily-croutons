// 界面使用公斤，数据库保存整数克；保留两位小数，避免浮点换算误差。
export function parseWeight(value: string): number {
  const text = value.trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) throw new Error('请输入体重，最多两位小数')
  const [whole, fraction = ''] = text.split('.')
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
  if (grams < 10 || grams > 999990) throw new Error('体重须在 0.01～999.99 kg 之间')
  return grams
}
export function kilograms(grams: number): string { return (grams / 1000).toFixed(2) }
