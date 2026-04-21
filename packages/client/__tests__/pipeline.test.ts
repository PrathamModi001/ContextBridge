import { createPipeline, ParserLike } from '../src/pipeline'
import { Entity, EntityDiff, EntityKind } from '../src/types'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEntity(name: string, sig: string, kind: EntityKind = 'function'): Entity {
  return { name, kind, signature: sig, body: `function ${name}() {}`, file: 'test.ts', line: 1 }
}

function mockParser(parseResult: Entity[]): ParserLike {
  return {
    parse: jest.fn().mockReturnValue(parseResult),
    clearCache: jest.fn(),
  }
}

// ── setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string
let onDiff: jest.Mock

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pipeline-'))
  onDiff = jest.fn()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeFile(name: string, content = 'placeholder'): string {
  const p = path.join(tmpDir, name)
  fs.writeFileSync(p, content, 'utf-8')
  return p
}

// ── processFile ───────────────────────────────────────────────────────────────

describe('pipeline processFile', () => {
  it('calls onDiff with new entity (oldSig null) on first parse', () => {
    const fp = writeFile('fn.ts')
    const parser = mockParser([makeEntity('foo', 'foo(x: string): void')])
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)

    expect(onDiff).toHaveBeenCalledTimes(1)
    const diffs: EntityDiff[] = onDiff.mock.calls[0][1]
    expect(diffs[0].name).toBe('foo')
    expect(diffs[0].oldSig).toBeNull()
    expect(diffs[0].newSig).toBe('foo(x: string): void')
  })

  it('passes filePath as first argument to onDiff', () => {
    const fp = writeFile('auth.ts')
    const parser = mockParser([makeEntity('login', 'login(): void')])
    createPipeline(parser, onDiff).processFile(fp)

    expect(onDiff.mock.calls[0][0]).toBe(fp)
  })

  it('does NOT call onDiff when signature is unchanged on second parse', () => {
    const fp = writeFile('fn.ts')
    const entities = [makeEntity('foo', 'foo(x: string): void')]
    const parser = mockParser(entities)
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)
    onDiff.mockClear()

    // parser returns same entities again
    pipeline.processFile(fp)
    expect(onDiff).not.toHaveBeenCalled()
  })

  it('calls onDiff when signature changes', () => {
    const fp = writeFile('fn.ts')
    const parser: ParserLike = {
      parse: jest.fn()
        .mockReturnValueOnce([makeEntity('foo', 'foo(x: string): void')])
        .mockReturnValue([makeEntity('foo', 'foo(x: string, y: number): void')]),
      clearCache: jest.fn(),
    }
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)
    onDiff.mockClear()

    pipeline.processFile(fp)

    expect(onDiff).toHaveBeenCalledTimes(1)
    const diffs: EntityDiff[] = onDiff.mock.calls[0][1]
    expect(diffs[0].oldSig).toBe('foo(x: string): void')
    expect(diffs[0].newSig).toBe('foo(x: string, y: number): void')
  })

  it('does NOT call onDiff for body-only change (same signature)', () => {
    const fp = writeFile('fn.ts')
    const v1 = { ...makeEntity('foo', 'foo(): void'), body: 'function foo() { return 1 }' }
    const v2 = { ...makeEntity('foo', 'foo(): void'), body: 'function foo() { return 2 }' }
    const parser: ParserLike = {
      parse: jest.fn().mockReturnValueOnce([v1]).mockReturnValue([v2]),
      clearCache: jest.fn(),
    }
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)
    onDiff.mockClear()

    pipeline.processFile(fp)
    expect(onDiff).not.toHaveBeenCalled()
  })

  it('does NOT call onDiff when parser returns empty array', () => {
    const fp = writeFile('empty.ts')
    createPipeline(mockParser([]), onDiff).processFile(fp)
    expect(onDiff).not.toHaveBeenCalled()
  })

  it('tracks multiple files independently', () => {
    const fa = writeFile('a.ts')
    const fb = writeFile('b.ts')
    const entities = [makeEntity('foo', 'foo(): void')]
    const parser = mockParser(entities)
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fa)
    pipeline.processFile(fb)
    onDiff.mockClear()

    // same parse result — no changes
    pipeline.processFile(fa)
    pipeline.processFile(fb)
    expect(onDiff).not.toHaveBeenCalled()
  })

  it('change in one file does not affect another tracked file', () => {
    const fa = writeFile('a.ts')
    const fb = writeFile('b.ts')
    const parser: ParserLike = {
      parse: jest.fn()
        .mockReturnValueOnce([makeEntity('foo', 'foo(): void')]) // a.ts v1
        .mockReturnValueOnce([makeEntity('bar', 'bar(): void')]) // b.ts v1
        .mockReturnValueOnce([makeEntity('foo', 'foo(x: number): void')]) // a.ts v2
        .mockReturnValue([makeEntity('bar', 'bar(): void')]), // b.ts unchanged
      clearCache: jest.fn(),
    }
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fa)
    pipeline.processFile(fb)
    onDiff.mockClear()

    pipeline.processFile(fa)
    expect(onDiff).toHaveBeenCalledTimes(1)
    expect(onDiff.mock.calls[0][0]).toBe(fa)
  })

  it('all entities on first parse have oldSig null', () => {
    const fp = writeFile('multi.ts')
    const entities = [
      makeEntity('foo', 'foo(): void'),
      makeEntity('bar', 'bar(): string'),
      makeEntity('Status', "type Status = 'active'", 'type'),
    ]
    createPipeline(mockParser(entities), onDiff).processFile(fp)

    const diffs: EntityDiff[] = onDiff.mock.calls[0][1]
    expect(diffs).toHaveLength(3)
    expect(diffs.every((d) => d.oldSig === null)).toBe(true)
  })

  it('only the new entity appears in diff when existing entity is unchanged', () => {
    const fp = writeFile('fn.ts')
    const parser: ParserLike = {
      parse: jest.fn()
        .mockReturnValueOnce([makeEntity('foo', 'foo(): void')])
        .mockReturnValue([makeEntity('foo', 'foo(): void'), makeEntity('bar', 'bar(): string')]),
      clearCache: jest.fn(),
    }
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)
    onDiff.mockClear()

    pipeline.processFile(fp)

    const diffs: EntityDiff[] = onDiff.mock.calls[0][1]
    expect(diffs).toHaveLength(1)
    expect(diffs[0].name).toBe('bar')
    expect(diffs[0].oldSig).toBeNull()
  })

  it('return type change triggers diff with correct old and new sig', () => {
    const fp = writeFile('fn.ts')
    const parser: ParserLike = {
      parse: jest.fn()
        .mockReturnValueOnce([makeEntity('getUser', 'getUser(id: string): User')])
        .mockReturnValue([makeEntity('getUser', 'getUser(id: string): UserV2')]),
      clearCache: jest.fn(),
    }
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)
    onDiff.mockClear()

    pipeline.processFile(fp)
    const diffs: EntityDiff[] = onDiff.mock.calls[0][1]
    expect(diffs[0].oldSig).toContain('User')
    expect(diffs[0].newSig).toContain('UserV2')
  })

  it('file read error: does not throw and does not call onDiff', () => {
    const missing = path.join(tmpDir, 'nonexistent.ts')
    const parser = mockParser([])
    expect(() => createPipeline(parser, onDiff).processFile(missing)).not.toThrow()
    expect(onDiff).not.toHaveBeenCalled()
  })

  it('file read error: parser not called', () => {
    const missing = path.join(tmpDir, 'nonexistent.ts')
    const parser = mockParser([])
    createPipeline(parser, onDiff).processFile(missing)
    expect(parser.parse).not.toHaveBeenCalled()
  })

  it('file read error leaves previous entity state intact', () => {
    const fp = writeFile('fn.ts')
    const parser: ParserLike = {
      parse: jest.fn().mockReturnValue([makeEntity('foo', 'foo(): void')]),
      clearCache: jest.fn(),
    }
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)
    onDiff.mockClear()

    // error — should not wipe stored state
    pipeline.processFile(path.join(tmpDir, 'missing.ts'))

    // same result again for fp → no diff
    pipeline.processFile(fp)
    expect(onDiff).not.toHaveBeenCalled()
  })

  it('parser called with correct filePath and file source', () => {
    const content = 'export function foo(): void {}'
    const fp = writeFile('check.ts', content)
    const parser = mockParser([])
    createPipeline(parser, onDiff).processFile(fp)

    expect(parser.parse).toHaveBeenCalledWith(fp, content)
  })

  // ── clearFile ─────────────────────────────────────────────────────────────

  it('clearFile resets state: next parse treated as new entity', () => {
    const fp = writeFile('fn.ts')
    const parser = mockParser([makeEntity('foo', 'foo(): void')])
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fp)
    onDiff.mockClear()

    pipeline.clearFile(fp)

    pipeline.processFile(fp)
    expect(onDiff).toHaveBeenCalledTimes(1)
    expect(onDiff.mock.calls[0][1][0].oldSig).toBeNull()
  })

  it('clearFile calls parser.clearCache with the file path', () => {
    const fp = writeFile('fn.ts')
    const parser = mockParser([])
    const pipeline = createPipeline(parser, onDiff)

    pipeline.clearFile(fp)
    expect(parser.clearCache).toHaveBeenCalledWith(fp)
  })

  it('clearFile on unknown file does not throw', () => {
    const parser = mockParser([])
    expect(() => createPipeline(parser, onDiff).clearFile('/unknown/file.ts')).not.toThrow()
  })

  it('clearFile does not affect other tracked files', () => {
    const fa = writeFile('a.ts')
    const fb = writeFile('b.ts')
    const parser = mockParser([makeEntity('foo', 'foo(): void')])
    const pipeline = createPipeline(parser, onDiff)

    pipeline.processFile(fa)
    pipeline.processFile(fb)
    onDiff.mockClear()

    pipeline.clearFile(fa)

    // b.ts unchanged — no diff
    pipeline.processFile(fb)
    expect(onDiff).not.toHaveBeenCalled()
  })
})
