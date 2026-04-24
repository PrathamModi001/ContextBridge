import fs from 'fs'
import os from 'os'
import path from 'path'
import { writeToWorkspace, readFromWorkspace, inferFilename } from '../../src/workspace'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-agent-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('writeToWorkspace', () => {
  it('writes file to workspace', () => {
    writeToWorkspace(tmpDir, 'auth.ts', 'export const x = 1')
    const content = fs.readFileSync(path.join(tmpDir, 'auth.ts'), 'utf8')
    expect(content).toBe('export const x = 1')
  })

  it('creates nested directories', () => {
    writeToWorkspace(tmpDir, 'services/auth.service.ts', 'export const y = 2')
    const exists = fs.existsSync(path.join(tmpDir, 'services', 'auth.service.ts'))
    expect(exists).toBe(true)
  })

  it('overwrites existing file', () => {
    writeToWorkspace(tmpDir, 'auth.ts', 'v1')
    writeToWorkspace(tmpDir, 'auth.ts', 'v2')
    const content = fs.readFileSync(path.join(tmpDir, 'auth.ts'), 'utf8')
    expect(content).toBe('v2')
  })

  it('throws on path traversal attempt', () => {
    expect(() => writeToWorkspace(tmpDir, '../../etc/passwd', 'malicious')).toThrow('Path traversal detected')
  })

  it('throws on absolute path outside workspace', () => {
    expect(() => writeToWorkspace(tmpDir, '/etc/evil.ts', 'x')).toThrow('Path traversal detected')
  })
})

describe('readFromWorkspace', () => {
  it('reads existing file', () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'hello world')
    expect(readFromWorkspace(tmpDir, 'test.ts')).toBe('hello world')
  })

  it('returns null for missing file', () => {
    expect(readFromWorkspace(tmpDir, 'nonexistent.ts')).toBeNull()
  })
})

describe('inferFilename', () => {
  it('extracts .ts filename from task', () => {
    expect(inferFilename('Refactor validateUser in auth.ts to accept permissions')).toBe('auth.ts')
  })

  it('extracts service file names', () => {
    expect(inferFilename('Add callers in user.service.ts that call validateUser')).toBe('user.service.ts')
  })

  it('returns generated.ts when no filename found', () => {
    expect(inferFilename('Add a new logging utility')).toBe('generated.ts')
  })

  it('prefers first .ts match', () => {
    expect(inferFilename('Update auth.ts and user.ts')).toBe('auth.ts')
  })
})
