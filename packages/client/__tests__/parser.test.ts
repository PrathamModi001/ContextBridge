import { TSParser } from '../src/parser'
import { Entity } from '../src/types'

const parser = new TSParser()

function parse(src: string, file = 'test.ts'): Entity[] {
  parser.clearCache(file)
  return parser.parse(file, src)
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const MULTI_ENTITY_FIXTURE = `
export async function validateUser(id: string): Promise<User> {
  return db.users.find(id)
}

export type Permission = 'read' | 'write'

export interface AuthConfig {
  secret: string
  ttl: number
}
`

// ── Basic extraction ─────────────────────────────────────────────────────────

describe('function extraction', () => {
  it('extracts exported async function', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const fn = entities.find((e) => e.name === 'validateUser')
    expect(fn).toBeDefined()
    expect(fn!.kind).toBe('function')
  })

  it('signature includes name + params + return type', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const fn = entities.find((e) => e.name === 'validateUser')!
    expect(fn.signature).toBe('validateUser(id: string): Promise<User>')
  })

  it('extracts non-exported function at top level', () => {
    const entities = parse('function helper(x: number): string { return String(x) }')
    expect(entities).toHaveLength(1)
    expect(entities[0].name).toBe('helper')
    expect(entities[0].kind).toBe('function')
  })

  it('function with no return type annotation', () => {
    const entities = parse('export function doSomething(x: string) { console.log(x) }')
    const fn = entities.find((e) => e.name === 'doSomething')!
    expect(fn.signature).toBe('doSomething(x: string)')
  })

  it('function with no params', () => {
    const entities = parse('export function noop(): void {}')
    expect(entities[0].signature).toBe('noop(): void')
  })

  it('generic function signature', () => {
    const entities = parse('export function identity<T>(val: T): T { return val }')
    const fn = entities.find((e) => e.name === 'identity')!
    expect(fn.signature).toContain('identity')
    expect(fn.signature).toContain('val: T')
    expect(fn.signature).toContain(': T')
  })

  it('function with optional param', () => {
    const entities = parse('export function foo(id: string, ttl?: number): void {}')
    expect(entities[0].signature).toBe('foo(id: string, ttl?: number): void')
  })

  it('function with multiple params', () => {
    const entities = parse('export function create(name: string, age: number, active: boolean): User {}')
    expect(entities[0].signature).toContain('name: string')
    expect(entities[0].signature).toContain('age: number')
    expect(entities[0].signature).toContain('active: boolean')
  })

  it('function body is captured', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const fn = entities.find((e) => e.name === 'validateUser')!
    expect(fn.body).toContain('db.users.find')
  })

  it('line number is 1-indexed and correct', () => {
    const src = `\n\nexport function foo(): void {}`
    const entities = parse(src)
    expect(entities[0].line).toBe(3)
  })

  it('does NOT extract nested function inside another function', () => {
    const src = `
export function outer(): void {
  function inner(): void {}
}
`
    const entities = parse(src)
    expect(entities.map((e) => e.name)).not.toContain('inner')
    expect(entities.map((e) => e.name)).toContain('outer')
  })
})

describe('arrow function extraction', () => {
  it('extracts const arrow function', () => {
    const entities = parse('const greet = (name: string): string => `Hello ${name}`')
    expect(entities).toHaveLength(1)
    expect(entities[0].name).toBe('greet')
    expect(entities[0].kind).toBe('function')
  })

  it('exported const arrow function', () => {
    const entities = parse('export const greet = (name: string): string => `Hello ${name}`')
    const fn = entities.find((e) => e.name === 'greet')!
    expect(fn).toBeDefined()
    expect(fn.signature).toBe('greet(name: string): string')
  })

  it('arrow function with no return type', () => {
    const entities = parse('const log = (msg: string) => console.log(msg)')
    expect(entities[0].signature).toBe('log(msg: string)')
  })

  it('non-arrow const (not a function) is not extracted', () => {
    const entities = parse('const MAX_RETRIES = 3')
    expect(entities).toHaveLength(0)
  })
})

describe('type extraction', () => {
  it('extracts type alias', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const t = entities.find((e) => e.name === 'Permission')
    expect(t).toBeDefined()
    expect(t!.kind).toBe('type')
  })

  it('type signature includes full definition', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const t = entities.find((e) => e.name === 'Permission')!
    expect(t.signature).toContain("'read'")
    expect(t.signature).toContain("'write'")
  })

  it('complex union type', () => {
    const entities = parse("export type Status = 'active' | 'inactive' | 'pending'")
    expect(entities[0].name).toBe('Status')
    expect(entities[0].signature).toContain("'pending'")
  })

  it('generic type alias', () => {
    const entities = parse('export type Maybe<T> = T | null | undefined')
    expect(entities[0].name).toBe('Maybe')
    expect(entities[0].kind).toBe('type')
  })
})

describe('interface extraction', () => {
  it('extracts interface', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const iface = entities.find((e) => e.name === 'AuthConfig')
    expect(iface).toBeDefined()
    expect(iface!.kind).toBe('interface')
  })

  it('interface signature contains fields', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const iface = entities.find((e) => e.name === 'AuthConfig')!
    expect(iface.signature).toContain('secret')
    expect(iface.signature).toContain('ttl')
  })

  it('interface with optional fields', () => {
    const entities = parse('export interface Config { host: string; port?: number }')
    expect(entities[0].signature).toContain('port?')
  })

  it('extended interface', () => {
    const entities = parse('export interface AdminConfig extends AuthConfig { role: string }')
    expect(entities[0].name).toBe('AdminConfig')
    expect(entities[0].signature).toContain('extends AuthConfig')
  })
})

describe('class extraction', () => {
  it('extracts class', () => {
    const entities = parse('export class UserService { getName(): string { return "x" } }')
    expect(entities).toHaveLength(1)
    expect(entities[0].name).toBe('UserService')
    expect(entities[0].kind).toBe('class')
  })

  it('class signature is header only (not full body)', () => {
    const entities = parse('export class UserService { getName(): string { return "very long body here" } }')
    expect(entities[0].signature).toContain('UserService')
    expect(entities[0].signature).not.toContain('very long body here')
  })

  it('class with extends', () => {
    const entities = parse('export class AdminService extends UserService { }')
    expect(entities[0].signature).toContain('extends UserService')
  })

  it('class body is captured in body field', () => {
    const entities = parse('export class Svc { fn(): void {} }')
    expect(entities[0].body).toContain('fn()')
  })
})

describe('multi-entity files', () => {
  it('extracts all entity types from one file', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    expect(entities.length).toBeGreaterThanOrEqual(3)
    expect(entities.some((e) => e.kind === 'function')).toBe(true)
    expect(entities.some((e) => e.kind === 'type')).toBe(true)
    expect(entities.some((e) => e.kind === 'interface')).toBe(true)
  })

  it('each entity has unique name', () => {
    const entities = parse(MULTI_ENTITY_FIXTURE)
    const names = entities.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('edge cases', () => {
  it('empty file returns empty array', () => {
    expect(parse('')).toHaveLength(0)
  })

  it('file with only comments returns empty array', () => {
    expect(parse('// just a comment\n/* block comment */')).toHaveLength(0)
  })

  it('file with only imports returns empty array', () => {
    expect(parse("import { foo } from './bar'")).toHaveLength(0)
  })

  it('re-export statement does not crash', () => {
    expect(() => parse("export { foo } from './bar'")).not.toThrow()
  })

  it('export default does not crash', () => {
    expect(() => parse('export default 42')).not.toThrow()
  })
})

describe('incremental parsing', () => {
  const FILE = 'incremental.ts'

  beforeEach(() => parser.clearCache(FILE))

  it('second parse of same content returns same entities', () => {
    const src = 'export function foo(x: string): void {}'
    const first = parser.parse(FILE, src)
    const second = parser.parse(FILE, src)
    expect(second[0].signature).toBe(first[0].signature)
  })

  it('detects signature change on incremental parse', () => {
    const v1 = 'export async function validateUser(id: string): Promise<User> { return db.find(id) }'
    const v2 = 'export async function validateUser(id: string, permissions: string[]): Promise<User> { return db.find(id) }'

    parser.parse(FILE, v1)
    const entities = parser.parse(FILE, v2)
    const fn = entities.find((e) => e.name === 'validateUser')!
    expect(fn.signature).toContain('permissions: string[]')
  })

  it('detects return type change on incremental parse', () => {
    const v1 = 'export function getUser(id: string): User { return {} as User }'
    const v2 = 'export function getUser(id: string): UserV2 { return {} as UserV2 }'

    parser.parse(FILE, v1)
    const entities = parser.parse(FILE, v2)
    expect(entities[0].signature).toContain('UserV2')
  })

  it('detects new entity added to file', () => {
    const v1 = 'export function foo(): void {}'
    const v2 = 'export function foo(): void {}\nexport function bar(): string { return "x" }'

    parser.parse(FILE, v1)
    const entities = parser.parse(FILE, v2)
    expect(entities.map((e) => e.name)).toContain('bar')
  })

  it('handles parsing multiple different files independently', () => {
    parser.parse('fileA.ts', 'export function alpha(): void {}')
    parser.parse('fileB.ts', 'export function beta(): string { return "x" }')

    const aEntities = parser.parse('fileA.ts', 'export function alpha(x: number): void {}')
    const bEntities = parser.parse('fileB.ts', 'export function beta(): string { return "x" }')

    expect(aEntities[0].signature).toContain('x: number')
    expect(bEntities[0].signature).toBe('beta(): string')
  })
})
