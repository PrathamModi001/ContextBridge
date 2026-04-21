import { createWatcher } from '../src/watcher'
import chokidar from 'chokidar'
import fs from 'fs'
import os from 'os'
import path from 'path'

jest.setTimeout(15_000)

const FAST_OPTS = { awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 } }

function waitForNthCall(fn: jest.Mock, n: number, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: expected ${n} call(s), got ${fn.mock.calls.length}`)),
      timeout,
    )
    const check = setInterval(() => {
      if (fn.mock.calls.length >= n) {
        clearInterval(check)
        clearTimeout(timer)
        resolve()
      }
    }, 30)
  })
}

function waitForReady(watcher: chokidar.FSWatcher): Promise<void> {
  return new Promise((resolve) => watcher.on('ready', resolve))
}

describe('createWatcher', () => {
  let tmpDir: string
  let watcher: chokidar.FSWatcher | undefined

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-watcher-'))
  })

  afterEach(async () => {
    if (watcher) {
      await watcher.close()
      watcher = undefined
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── Add events ───────────────────────────────────────────────────────────────

  it('calls onChange when .ts file is added to empty dir', async () => {
    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)

    fs.writeFileSync(path.join(tmpDir, 'new.ts'), 'export function foo() {}')

    await waitForNthCall(onChange, 1)
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('new.ts'))
  })

  it('calls onChange with absolute path', async () => {
    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)

    fs.writeFileSync(path.join(tmpDir, 'abs.ts'), 'export const x = 1')

    await waitForNthCall(onChange, 1)
    expect(path.isAbsolute(onChange.mock.calls[0][0])).toBe(true)
  })

  it('calls onChange for nested .ts files in subdirectory', async () => {
    const nested = path.join(tmpDir, 'src', 'utils')
    fs.mkdirSync(nested, { recursive: true })

    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)

    fs.writeFileSync(path.join(nested, 'helper.ts'), 'export function help() {}')

    await waitForNthCall(onChange, 1)
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('helper.ts'))
  })

  it('calls onChange for multiple .ts files added', async () => {
    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)

    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export function a() {}')
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'export function b() {}')

    await waitForNthCall(onChange, 2)
    const paths = onChange.mock.calls.map((c) => c[0])
    expect(paths.some((p: string) => p.includes('a.ts'))).toBe(true)
    expect(paths.some((p: string) => p.includes('b.ts'))).toBe(true)
  })

  // ── Change events ────────────────────────────────────────────────────────────

  it('calls onChange when existing .ts file is modified', async () => {
    const tsFile = path.join(tmpDir, 'watch.ts')
    fs.writeFileSync(tsFile, 'export function v1() {}')

    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)

    // wait for initial add event to settle
    await waitForNthCall(onChange, 1)
    onChange.mockClear()

    fs.writeFileSync(tsFile, 'export function v2(x: number): void {}')

    await waitForNthCall(onChange, 1)
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('watch.ts'))
  })

  it('calls onChange multiple times on repeated modifications', async () => {
    const tsFile = path.join(tmpDir, 'repeat.ts')
    fs.writeFileSync(tsFile, 'export function v1() {}')

    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)

    await waitForNthCall(onChange, 1)
    onChange.mockClear()

    fs.writeFileSync(tsFile, 'export function v2() {}')
    await waitForNthCall(onChange, 1)
    onChange.mockClear()

    fs.writeFileSync(tsFile, 'export function v3() {}')
    await waitForNthCall(onChange, 1)

    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('repeat.ts'))
  })

  // ── Ignored patterns ─────────────────────────────────────────────────────────

  it('does NOT call onChange for .js files', async () => {
    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)
    await waitForReady(watcher)
    onChange.mockClear()

    fs.writeFileSync(path.join(tmpDir, 'script.js'), 'function foo() {}')

    await new Promise((r) => setTimeout(r, 300))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does NOT call onChange for .d.ts files', async () => {
    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)
    await waitForReady(watcher)
    onChange.mockClear()

    fs.writeFileSync(path.join(tmpDir, 'types.d.ts'), 'declare function foo(): void')

    await new Promise((r) => setTimeout(r, 300))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does NOT call onChange for files inside node_modules', async () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg')
    fs.mkdirSync(nmDir, { recursive: true })

    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)
    await waitForReady(watcher)
    onChange.mockClear()

    fs.writeFileSync(path.join(nmDir, 'index.ts'), 'export {}')

    await new Promise((r) => setTimeout(r, 300))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does NOT call onChange for .json files', async () => {
    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)
    await waitForReady(watcher)
    onChange.mockClear()

    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}')

    await new Promise((r) => setTimeout(r, 300))
    expect(onChange).not.toHaveBeenCalled()
  })

  // ── ignoreInitial option ─────────────────────────────────────────────────────

  it('fires add for pre-existing .ts files when ignoreInitial is false (default)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'pre.ts'), 'export function pre() {}')

    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, FAST_OPTS)

    await waitForNthCall(onChange, 1)
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('pre.ts'))
  })

  it('does NOT fire for pre-existing files when ignoreInitial is true', async () => {
    fs.writeFileSync(path.join(tmpDir, 'existing.ts'), 'export function existing() {}')

    const onChange = jest.fn()
    watcher = createWatcher(tmpDir, onChange, { ...FAST_OPTS, ignoreInitial: true })
    await waitForReady(watcher)

    expect(onChange).not.toHaveBeenCalled()
  })

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  it('watcher.close() resolves without error', async () => {
    watcher = createWatcher(tmpDir, jest.fn(), FAST_OPTS)
    await expect(watcher.close()).resolves.not.toThrow()
    watcher = undefined
  })
})
