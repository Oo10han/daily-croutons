const { _electron: electron } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'little-days-e2e-'))
const env = { ...process.env, LITTLE_DAYS_DATA_DIR: temp }
delete env.ELECTRON_RUN_AS_NODE
const backupPath = path.join(temp, 'backup.json')
let instance
const errors = []
async function launch() {
  instance = await electron.launch(process.argv.includes('--packaged')
    ? { executablePath: path.join(root, 'release', 'win-unpacked', 'Little Days.exe'), args: [], env }
    : { args: [root], env })
  const page = await instance.firstWindow()
  page.on('pageerror', e => errors.push(e.message))
  await expect(page.getByLabel('日记标题')).toBeEnabled()
  return page
}
async function closeWithFlush() {
  const closed = instance.waitForEvent('close')
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  instance = undefined
}
;(async () => {
  try {
    let page = await launch()
    await page.getByLabel('日记标题').fill('把平凡的日子，写成喜欢的样子')
    await page.getByRole('button', { name: '☁平静', exact: true }).click()
    await page.getByLabel('日记正文').fill('午后泡了一杯茶，终于开始做自己的手账。\n\n想记录的不一定是大事。窗边的阳光、好吃的晚饭，\n还有认真生活的自己，都值得留下一小段文字。')
    // Switch immediately, before the debounce fires.
    const today = await page.evaluate(() => {
      const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })
    const other = await page.locator('.days button:not(.selected):not(.outside)').first().getAttribute('aria-label')
    await page.getByRole('button', { name: other, exact: true }).click()
    await expect(page.getByLabel('日记正文')).toHaveValue('')
    await page.getByLabel('日记标题').fill('另一天的记录')
    await page.getByLabel('日记正文').fill('这段文字只属于另一天。')
    await page.getByRole('button', { name: today, exact: true }).click()
    await expect(page.getByLabel('日记标题')).toHaveValue('把平凡的日子，写成喜欢的样子')
    await expect(page.getByLabel('日记正文')).toHaveValue(/午后泡了一杯茶/)
    await page.getByLabel('日记正文').fill('关闭前最后一次修改\n中文、emoji 🌿 和换行都要保留。')
    await closeWithFlush()
    page = await launch()
    await expect(page.getByLabel('日记正文')).toHaveValue('关闭前最后一次修改\n中文、emoji 🌿 和换行都要保留。')
    const isolation = await page.evaluate(() => ({ requireType: typeof window.require, processType: typeof window.process }))
    assert.deepEqual(isolation, { requireType: 'undefined', processType: 'undefined' })
    // Exercise the real backup handlers; only OS picker responses are stubbed.
    await instance.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    }, backupPath)
    await page.getByRole('button', { name: '↥ 导出备份' }).click()
    await expect(page.getByRole('status').filter({ hasText: '备份已导出' })).toBeVisible()
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
    assert.equal(backup.diaries.length, 2)
    await page.getByLabel('日记正文').fill('将被备份覆盖的修改')
    await page.getByRole('button', { name: '恢复备份', exact: true }).click()
    await expect(page.getByLabel('日记正文')).toHaveValue('关闭前最后一次修改\n中文、emoji 🌿 和换行都要保留。')
    assert.ok(fs.readdirSync(temp).some(name => name.startsWith('before-import-')))
    await page.getByRole('button', { name: '删除日记', exact: true }).click()
    await page.getByRole('button', { name: '保留日记', exact: true }).click()
    await expect(page.getByLabel('日记正文')).not.toHaveValue('')
    await page.getByRole('button', { name: other, exact: true }).click()
    await page.getByRole('button', { name: '删除日记', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.getByLabel('日记正文')).toHaveValue('')
    await page.getByRole('button', { name: today, exact: true }).click()
    await page.getByLabel('日记正文').fill('午后泡了一杯茶，终于开始做自己的手账。\n\n想记录的不一定是大事。窗边的阳光、好吃的晚饭，\n还有认真生活的自己，都值得留下一小段文字。\n\n今天的小确幸：\n· 出门时刚好遇到一阵凉风\n· 读完了搁置很久的一章书\n· 给明天留了一点期待')
    await page.getByRole('button', { name: '保存日记', exact: true }).click()
    await expect(page.locator('.save-state')).toHaveText('已保存到本机')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByLabel('日记正文').evaluate(element => { element.scrollTop = 0 })
    await expect(page.getByRole('button', { name: '↥ 导出备份' })).toBeInViewport()
    await expect(page.getByRole('button', { name: '保存日记', exact: true })).toBeInViewport()
    await page.screenshot({ path: path.join(root, 'preview.png'), scale: 'css' })
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650))
    await expect(page.getByRole('button', { name: '保存日记', exact: true })).toBeInViewport()
    assert.deepEqual(errors, [])
    await closeWithFlush()
    console.log('PASS: date isolation, immediate close/reopen persistence, IPC isolation, export/import, recovery backup, delete/cancel, renderer screenshot')
  } finally {
    if (instance) await instance.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
