/** JS/TS built-in identifiers and keywords to exclude from call-graph extraction. */
export const BUILTIN_IDENTIFIERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof', 'in', 'of',
  'new', 'delete', 'throw', 'await', 'async', 'function', 'class', 'const', 'let', 'var',
  'void', 'yield', 'export', 'import', 'try', 'finally', 'super', 'this',
  'console', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Error',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'JSON', 'Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
  'describe', 'it', 'test', 'expect', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach',
  'require', 'exports', 'module', 'process', 'Buffer', 'global', 'undefined', 'null',
  'then', 'push', 'pop', 'map', 'filter', 'reduce', 'find', 'forEach',
  'slice', 'splice', 'join', 'split', 'includes',
  'log', 'error', 'warn', 'info', 'debug',
])
