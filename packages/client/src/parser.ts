import Parser from 'tree-sitter'
import TypeScript from 'tree-sitter-typescript'
import { Entity, EntityKind } from './types'

const DECLARATION_TYPES = new Set([
  'function_declaration',
  'lexical_declaration',
  'variable_declaration',
  'type_alias_declaration',
  'interface_declaration',
  'class_declaration',
])

export class TSParser {
  private parser: Parser
  private previousTrees: Map<string, Parser.Tree> = new Map()

  constructor() {
    this.parser = new Parser()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.parser.setLanguage(TypeScript.typescript as any)
  }

  parse(filePath: string, source: string): Entity[] {
    // Full re-parse every time. Passing prevTree without calling tree.edit() produces
    // wrong byte offsets when source length changes — incremental mode requires explicit edits.
    const tree = this.parser.parse(source)
    this.previousTrees.set(filePath, tree)
    return this.extractTopLevel(tree.rootNode, filePath)
  }

  clearCache(filePath: string): void {
    this.previousTrees.delete(filePath)
  }

  private extractTopLevel(root: Parser.SyntaxNode, file: string): Entity[] {
    const entities: Entity[] = []
    for (const node of root.children) {
      const entity = this.tryExtract(node, file)
      if (entity) entities.push(entity)
    }
    return entities
  }

  private tryExtract(node: Parser.SyntaxNode, file: string): Entity | null {
    let target = node

    if (node.type === 'export_statement') {
      const decl =
        node.childForFieldName('declaration') ??
        node.children.find((c) => DECLARATION_TYPES.has(c.type))
      if (!decl) return null
      target = decl
    }

    switch (target.type) {
      case 'function_declaration':
        return this.extractFunction(target, file)
      case 'lexical_declaration':
      case 'variable_declaration':
        return this.extractArrowFunction(target, file)
      case 'type_alias_declaration':
        return this.extractType(target, file)
      case 'interface_declaration':
        return this.extractInterface(target, file)
      case 'class_declaration':
        return this.extractClass(target, file)
      default:
        return null
    }
  }

  private extractFunction(node: Parser.SyntaxNode, file: string): Entity | null {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const params = node.childForFieldName('parameters')?.text ?? '()'
    const returnType = node.childForFieldName('return_type')?.text ?? ''

    return {
      name: nameNode.text,
      kind: 'function',
      signature: `${nameNode.text}${params}${returnType}`,
      body: node.text,
      file,
      line: node.startPosition.row + 1,
    }
  }

  private extractArrowFunction(node: Parser.SyntaxNode, file: string): Entity | null {
    for (const child of node.children) {
      if (child.type !== 'variable_declarator') continue

      const nameNode = child.childForFieldName('name')
      const valueNode = child.childForFieldName('value')
      if (!nameNode || !valueNode) continue
      if (valueNode.type !== 'arrow_function') continue

      const params = valueNode.childForFieldName('parameters')?.text ?? '()'
      const returnType = valueNode.childForFieldName('return_type')?.text ?? ''

      return {
        name: nameNode.text,
        kind: 'function',
        signature: `${nameNode.text}${params}${returnType}`,
        body: node.text,
        file,
        line: node.startPosition.row + 1,
      }
    }
    return null
  }

  private extractType(node: Parser.SyntaxNode, file: string): Entity | null {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    return {
      name: nameNode.text,
      kind: 'type',
      signature: node.text.replace(/\s+/g, ' ').trim(),
      body: node.text,
      file,
      line: node.startPosition.row + 1,
    }
  }

  private extractInterface(node: Parser.SyntaxNode, file: string): Entity | null {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    return {
      name: nameNode.text,
      kind: 'interface',
      signature: node.text.replace(/\s+/g, ' ').trim(),
      body: node.text,
      file,
      line: node.startPosition.row + 1,
    }
  }

  private extractClass(node: Parser.SyntaxNode, file: string): Entity | null {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const bodyNode = node.childForFieldName('body')
    const headerLen = bodyNode
      ? bodyNode.startIndex - node.startIndex
      : node.text.length
    const header = node.text.substring(0, headerLen).replace(/\s+/g, ' ').trim()

    return {
      name: nameNode.text,
      kind: 'class',
      signature: header,
      body: node.text,
      file,
      line: node.startPosition.row + 1,
    }
  }
}
