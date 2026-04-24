import Groq from 'groq-sdk'
import { generateCode, extractCodeBlock } from '../../src/groq'

jest.mock('groq-sdk')
const MockGroq = jest.mocked(Groq)

describe('generateCode', () => {
  let mockCreate: jest.Mock

  beforeEach(() => {
    mockCreate = jest.fn()
    MockGroq.mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as unknown as Groq)
  })

  it('calls Groq with smart model and returns content', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '```typescript\nconst x = 1\n```' } }],
    })
    const result = await generateCode('system', 'task', 'smart')
    expect(result).toBe('```typescript\nconst x = 1\n```')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.stringContaining('70b'),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: 'system' }),
          expect.objectContaining({ role: 'user',   content: 'task' }),
        ]),
        temperature: 0.1,
      }),
    )
  })

  it('uses dumb model in dumb mode', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'code' } }] })
    await generateCode('sys', 'task', 'dumb')
    expect(mockCreate.mock.calls[0][0].model).toContain('8b')
  })

  it('returns empty string when content is null', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
    const result = await generateCode('sys', 'task', 'smart')
    expect(result).toBe('')
  })

  it('propagates groq errors', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'))
    await expect(generateCode('sys', 'task', 'smart')).rejects.toThrow('rate limited')
  })

  it('defaults to smart mode', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] })
    await generateCode('sys', 'task')
    expect(mockCreate.mock.calls[0][0].model).toContain('70b')
  })
})

describe('extractCodeBlock', () => {
  it('extracts typescript code block', () => {
    expect(extractCodeBlock('```typescript\nconst x = 1\n```')).toBe('const x = 1')
  })

  it('extracts ts shorthand block', () => {
    expect(extractCodeBlock('```ts\nfunction foo() {}\n```')).toBe('function foo() {}')
  })

  it('extracts generic code block', () => {
    expect(extractCodeBlock('```\nconst y = 2\n```')).toBe('const y = 2')
  })

  it('returns trimmed raw response when no code block', () => {
    expect(extractCodeBlock('  const z = 3  ')).toBe('const z = 3')
  })

  it('handles multiline code', () => {
    const input = '```typescript\nfunction add(a: number, b: number) {\n  return a + b\n}\n```'
    expect(extractCodeBlock(input)).toBe('function add(a: number, b: number) {\n  return a + b\n}')
  })

  it('extracts first block when multiple blocks present', () => {
    const input = '```typescript\nblock1\n```\n```typescript\nblock2\n```'
    expect(extractCodeBlock(input)).toBe('block1')
  })
})
