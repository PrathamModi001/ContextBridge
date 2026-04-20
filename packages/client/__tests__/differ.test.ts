import { diffEntities } from '../src/differ'
import { Entity, EntityDiff } from '../src/types'

function makeEntity(overrides: Partial<Entity> & { name: string }): Entity {
  return {
    kind: 'function',
    signature: `${overrides.name}(): void`,
    body: `function ${overrides.name}() {}`,
    file: 'test.ts',
    line: 1,
    ...overrides,
  }
}

// ── No-diff cases ────────────────────────────────────────────────────────────

describe('no diff', () => {
  it('returns empty array for identical entity lists', () => {
    const e = makeEntity({ name: 'foo', signature: 'foo(x: string): void' })
    expect(diffEntities([e], [e])).toHaveLength(0)
  })

  it('returns empty array for two empty lists', () => {
    expect(diffEntities([], [])).toHaveLength(0)
  })

  it('returns empty for populated prev + empty next (no deletion tracking)', () => {
    const prev = [makeEntity({ name: 'foo' })]
    expect(diffEntities(prev, [])).toHaveLength(0)
  })

  it('ignores body-only change when signature unchanged', () => {
    const prev = [makeEntity({ name: 'foo', signature: 'foo(): void', body: 'function foo() { return 1 }' })]
    const next = [makeEntity({ name: 'foo', signature: 'foo(): void', body: 'function foo() { return 2 }' })]
    expect(diffEntities(prev, next)).toHaveLength(0)
  })

  it('ignores line number change when signature unchanged', () => {
    const prev = [makeEntity({ name: 'foo', line: 1 })]
    const next = [makeEntity({ name: 'foo', line: 10 })]
    expect(diffEntities(prev, next)).toHaveLength(0)
  })

  it('ignores file change when signature unchanged', () => {
    const prev = [makeEntity({ name: 'foo', file: 'a.ts' })]
    const next = [makeEntity({ name: 'foo', file: 'b.ts' })]
    expect(diffEntities(prev, next)).toHaveLength(0)
  })
})

// ── New entities ─────────────────────────────────────────────────────────────

describe('new entity detection', () => {
  it('new entity has oldSig null', () => {
    const next = [makeEntity({ name: 'bar' })]
    const diffs = diffEntities([], next)
    expect(diffs[0].oldSig).toBeNull()
  })

  it('all entities are new when prev is empty', () => {
    const next = [makeEntity({ name: 'a' }), makeEntity({ name: 'b' }), makeEntity({ name: 'c' })]
    const diffs = diffEntities([], next)
    expect(diffs).toHaveLength(3)
    expect(diffs.every((d) => d.oldSig === null)).toBe(true)
  })

  it('new entity diff contains correct name', () => {
    const diffs = diffEntities([], [makeEntity({ name: 'myFn', signature: 'myFn(x: string): void' })])
    expect(diffs[0].name).toBe('myFn')
    expect(diffs[0].newSig).toBe('myFn(x: string): void')
  })

  it('new entity diff preserves kind', () => {
    const diffs = diffEntities([], [makeEntity({ name: 'IFoo', kind: 'interface', signature: 'interface IFoo {}' })])
    expect(diffs[0].kind).toBe('interface')
  })

  it('new entity diff preserves body', () => {
    const body = 'export function foo() { /* impl */ }'
    const diffs = diffEntities([], [makeEntity({ name: 'foo', body })])
    expect(diffs[0].body).toBe(body)
  })

  it('new entity diff preserves file + line', () => {
    const diffs = diffEntities([], [makeEntity({ name: 'foo', file: 'auth.ts', line: 42 })])
    expect(diffs[0].file).toBe('auth.ts')
    expect(diffs[0].line).toBe(42)
  })
})

// ── Changed signatures ───────────────────────────────────────────────────────

describe('signature change detection', () => {
  it('detects changed signature', () => {
    const prev = [makeEntity({ name: 'foo', signature: 'foo(a: string)' })]
    const next = [makeEntity({ name: 'foo', signature: 'foo(a: string, b: number)' })]
    const diffs = diffEntities(prev, next)
    expect(diffs).toHaveLength(1)
  })

  it('oldSig is the previous signature', () => {
    const prev = [makeEntity({ name: 'foo', signature: 'foo(a: string)' })]
    const next = [makeEntity({ name: 'foo', signature: 'foo(a: string, b: number)' })]
    const diffs = diffEntities(prev, next)
    expect(diffs[0].oldSig).toBe('foo(a: string)')
  })

  it('newSig is the current signature', () => {
    const prev = [makeEntity({ name: 'foo', signature: 'foo(a: string)' })]
    const next = [makeEntity({ name: 'foo', signature: 'foo(a: string, b: number)' })]
    const diffs = diffEntities(prev, next)
    expect(diffs[0].newSig).toBe('foo(a: string, b: number)')
  })

  it('return type change detected', () => {
    const prev = [makeEntity({ name: 'getUser', signature: 'getUser(id: string): User' })]
    const next = [makeEntity({ name: 'getUser', signature: 'getUser(id: string): UserV2' })]
    expect(diffEntities(prev, next)).toHaveLength(1)
  })

  it('param removal detected', () => {
    const prev = [makeEntity({ name: 'fn', signature: 'fn(a: string, b: number)' })]
    const next = [makeEntity({ name: 'fn', signature: 'fn(a: string)' })]
    expect(diffEntities(prev, next)).toHaveLength(1)
  })

  it('optional param added detected', () => {
    const prev = [makeEntity({ name: 'fn', signature: 'fn(id: string)' })]
    const next = [makeEntity({ name: 'fn', signature: 'fn(id: string, ttl?: number)' })]
    expect(diffEntities(prev, next)).toHaveLength(1)
  })

  it('changed diff preserves updated body', () => {
    const prev = [makeEntity({ name: 'fn', signature: 'fn(): void', body: 'old body' })]
    const next = [makeEntity({ name: 'fn', signature: 'fn(x: string): void', body: 'new body' })]
    const diffs = diffEntities(prev, next)
    expect(diffs[0].body).toBe('new body')
  })
})

// ── Mixed scenarios ───────────────────────────────────────────────────────────

describe('mixed entity lists', () => {
  it('detects new + changed, ignores unchanged', () => {
    const prev = [
      makeEntity({ name: 'unchanged', signature: 'unchanged(): void' }),
      makeEntity({ name: 'changed', signature: 'changed(a: string)' }),
    ]
    const next = [
      makeEntity({ name: 'unchanged', signature: 'unchanged(): void' }),
      makeEntity({ name: 'changed', signature: 'changed(a: string, b: number)' }),
      makeEntity({ name: 'newFn', signature: 'newFn(): string' }),
    ]

    const diffs = diffEntities(prev, next)
    expect(diffs).toHaveLength(2)

    const changedDiff = diffs.find((d) => d.name === 'changed')!
    expect(changedDiff.oldSig).toBe('changed(a: string)')

    const newDiff = diffs.find((d) => d.name === 'newFn')!
    expect(newDiff.oldSig).toBeNull()

    expect(diffs.find((d) => d.name === 'unchanged')).toBeUndefined()
  })

  it('all three entity kinds can appear in diffs together', () => {
    const diffs = diffEntities(
      [],
      [
        makeEntity({ name: 'fn', kind: 'function' }),
        makeEntity({ name: 'IFoo', kind: 'interface' }),
        makeEntity({ name: 'TBar', kind: 'type' }),
      ],
    )
    const kinds = diffs.map((d) => d.kind)
    expect(kinds).toContain('function')
    expect(kinds).toContain('interface')
    expect(kinds).toContain('type')
  })

  it('order of diffs matches order of next array', () => {
    const names = ['a', 'b', 'c', 'd']
    const next = names.map((n) => makeEntity({ name: n }))
    const diffs = diffEntities([], next)
    expect(diffs.map((d) => d.name)).toEqual(names)
  })

  it('large list — only changed entities returned', () => {
    const prev = Array.from({ length: 50 }, (_, i) => makeEntity({ name: `fn${i}`, signature: `fn${i}(): void` }))
    const next = [
      ...Array.from({ length: 50 }, (_, i) => makeEntity({ name: `fn${i}`, signature: `fn${i}(): void` })),
      makeEntity({ name: 'fn50', signature: 'fn50(): string' }),
    ]
    const diffs = diffEntities(prev, next)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].name).toBe('fn50')
  })
})

// ── Type safety ───────────────────────────────────────────────────────────────

describe('return type shape', () => {
  it('diff has all required EntityDiff fields', () => {
    const diffs: EntityDiff[] = diffEntities([], [makeEntity({ name: 'foo', file: 'a.ts', line: 5 })])
    const d = diffs[0]
    expect(typeof d.name).toBe('string')
    expect(typeof d.kind).toBe('string')
    expect(d.oldSig).toBeNull()
    expect(typeof d.newSig).toBe('string')
    expect(typeof d.body).toBe('string')
    expect(typeof d.file).toBe('string')
    expect(typeof d.line).toBe('number')
  })
})
