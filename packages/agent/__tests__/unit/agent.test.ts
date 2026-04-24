import { runAgent } from '../../src/agent'
import * as groqModule from '../../src/groq'
import * as contextModule from '../../src/context'
import * as workspaceModule from '../../src/workspace'

jest.mock('../../src/groq')
jest.mock('../../src/context')
jest.mock('../../src/workspace')

const mockGenerateCode = groqModule.generateCode as jest.MockedFunction<typeof groqModule.generateCode>
const mockExtractCodeBlock = groqModule.extractCodeBlock as jest.MockedFunction<typeof groqModule.extractCodeBlock>
const mockFetchContext = contextModule.fetchContext as jest.MockedFunction<typeof contextModule.fetchContext>
const mockValidateUsage = contextModule.validateUsage as jest.MockedFunction<typeof contextModule.validateUsage>
const mockWriteToWorkspace = workspaceModule.writeToWorkspace as jest.MockedFunction<typeof workspaceModule.writeToWorkspace>
const mockInferFilename = workspaceModule.inferFilename as jest.MockedFunction<typeof workspaceModule.inferFilename>

const BASE_CONFIG = {
  dev: 'devB',
  serverUrl: 'http://localhost:3000',
  workspace: '/tmp/workspace-devB',
}

describe('runAgent — SMART mode', () => {
  beforeEach(() => {
    mockFetchContext.mockResolvedValue('# ContextBridge Snapshot\n### validateUser\n- signature: `validateUser(id: string)`')
    mockGenerateCode.mockResolvedValue('```typescript\nconst x = 1\n```')
    mockExtractCodeBlock.mockReturnValue('const x = 1')
    mockValidateUsage.mockResolvedValue({ conflicts: [] })
    mockInferFilename.mockReturnValue('auth.ts')
    mockWriteToWorkspace.mockImplementation(() => undefined)
  })

  it('fetches context before generating', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    expect(mockFetchContext).toHaveBeenCalledWith('http://localhost:3000')
  })

  it('calls generateCode with smart mode', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    expect(mockGenerateCode).toHaveBeenCalledWith(
      expect.stringContaining('live state'),
      'Add caller in auth.ts',
      'smart',
    )
  })

  it('validates code after generation', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    expect(mockValidateUsage).toHaveBeenCalledWith('http://localhost:3000', 'const x = 1')
  })

  it('writes generated code to workspace', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    expect(mockWriteToWorkspace).toHaveBeenCalledWith('/tmp/workspace-devB', 'auth.ts', 'const x = 1')
  })

  it('returns filename and code', async () => {
    const result = await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    expect(result.filename).toBe('auth.ts')
    expect(result.code).toBe('const x = 1')
  })

  it('re-generates when validation returns conflicts', async () => {
    mockValidateUsage.mockResolvedValueOnce({
      conflicts: [{
        entity: 'validateUser',
        yourSignature: 'validateUser(userId)',
        liveSignature: 'validateUser(id: string, permissions: string[])',
        severity: 'warning',
        devId: 'devA',
        correctedCall: 'validateUser(id, permissions)',
      }],
    })
    mockValidateUsage.mockResolvedValueOnce({ conflicts: [] })
    mockGenerateCode
      .mockResolvedValueOnce('```typescript\nbad code\n```')
      .mockResolvedValueOnce('```typescript\ngood code\n```')
    mockExtractCodeBlock
      .mockReturnValueOnce('bad code')
      .mockReturnValueOnce('good code')

    const result = await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    expect(mockGenerateCode).toHaveBeenCalledTimes(2)
    expect(mockGenerateCode.mock.calls[1][1]).toContain('FIX THESE SIGNATURE MISMATCHES')
    expect(mockGenerateCode.mock.calls[1][1]).toContain('validateUser')
    expect(result.code).toBe('good code')
  })

  it('includes correctedCall in re-prompt', async () => {
    mockValidateUsage.mockResolvedValueOnce({
      conflicts: [{
        entity: 'validateUser',
        yourSignature: 'validateUser(userId)',
        liveSignature: 'validateUser(id: string, permissions: string[])',
        severity: 'warning',
        devId: 'devA',
        correctedCall: 'validateUser(id, permissions)',
      }],
    })
    mockValidateUsage.mockResolvedValueOnce({ conflicts: [] })
    mockGenerateCode.mockResolvedValue('raw')
    mockExtractCodeBlock.mockReturnValue('code')

    await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    const rePrompt = mockGenerateCode.mock.calls[1][1]
    expect(rePrompt).toContain('validateUser(id, permissions)')
  })

  it('warns when conflicts remain after re-generation', async () => {
    const conflict = {
      entity: 'validateUser', yourSignature: 'validateUser()',
      liveSignature: 'validateUser(id: string)', severity: 'warning', devId: 'devA', correctedCall: 'validateUser(id)',
    }
    mockValidateUsage.mockResolvedValueOnce({ conflicts: [conflict] })
    mockValidateUsage.mockResolvedValueOnce({ conflicts: [conflict] })
    mockGenerateCode.mockResolvedValue('raw')
    mockExtractCodeBlock.mockReturnValue('code')

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('remain after re-generation'))
    warnSpy.mockRestore()
  })

  it('propagates write errors', async () => {
    mockWriteToWorkspace.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(runAgent({ ...BASE_CONFIG, task: 'Add caller in auth.ts', mode: 'smart' })).rejects.toThrow('disk full')
  })
})

describe('runAgent — DUMB mode', () => {
  beforeEach(() => {
    mockGenerateCode.mockResolvedValue('```typescript\nconst x = 1\n```')
    mockExtractCodeBlock.mockReturnValue('const x = 1')
    mockInferFilename.mockReturnValue('generated.ts')
    mockWriteToWorkspace.mockImplementation(() => undefined)
  })

  it('skips context fetch', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add logger', mode: 'dumb' })
    expect(mockFetchContext).not.toHaveBeenCalled()
  })

  it('skips validation', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add logger', mode: 'dumb' })
    expect(mockValidateUsage).not.toHaveBeenCalled()
  })

  it('calls generateCode with dumb mode', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add logger', mode: 'dumb' })
    expect(mockGenerateCode).toHaveBeenCalledWith(
      expect.any(String),
      'Add logger',
      'dumb',
    )
  })

  it('still writes to workspace', async () => {
    await runAgent({ ...BASE_CONFIG, task: 'Add logger', mode: 'dumb' })
    expect(mockWriteToWorkspace).toHaveBeenCalled()
  })
})
