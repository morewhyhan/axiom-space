import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type AcceptanceCase = {
  id: string
  title: string
  sourceFile: string
  section: string
  method: string
  input: string
  expectedOutput: string
  passCriteria: string
  failureHypothesis: string
  references: string
  operation?: string
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const MAIN_FLOW_FILES = [
  'test/main-flows/01-web-mvp-closed-loop.md',
  'test/main-flows/02-document-import-to-learning.md',
  'test/main-flows/03-step-to-forge.md',
  'test/main-flows/04-card-polish-and-promote.md',
  'test/main-flows/05-assessment-and-progress.md',
  'test/main-flows/06-galaxy-cognition-display.md',
]

const TABLE_CASE_FILES = [
  'test/domain/01-core-objects.md',
  'test/domain/02-fine-objects.md',
  'test/domain/03-aggregates-services-events-and-runtime.md',
  'test/scenarios/01-user-scenarios.md',
  'test/priorities/01-p0-p1-p2.md',
]

const CASE_ID_RE = /^(MF-\d{2}|OBJ-\d{3}|FINE-\d{3}|AGG-\d{3}|SRV-\d{3}|EVT-\d{3}|DOCEVAL-\d{3}|NOTIF-\d{3}|AGENT-\d{3}|SUB-\d{3}|GUIDE-\d{3}|MEM-\d{3}|EXT-\d{3}|UI-\d{3}|SCN-\d{3}|P[0-2]-\d{3})$/

export const EXPECTED_CASE_COUNTS: Record<string, number> = {
  MF: 6,
  OBJ: 72,
  FINE: 75,
  AGG: 9,
  SRV: 10,
  EVT: 20,
  DOCEVAL: 7,
  NOTIF: 5,
  AGENT: 13,
  SUB: 12,
  GUIDE: 8,
  MEM: 7,
  EXT: 9,
  UI: 10,
  SCN: 6,
  P0: 8,
  P1: 6,
  P2: 6,
}

export const EXPECTED_TOTAL_CASES = Object.values(EXPECTED_CASE_COUNTS).reduce(
  (sum, count) => sum + count,
  0,
)

export function loadAcceptanceCases(): AcceptanceCase[] {
  const cases = [
    ...MAIN_FLOW_FILES.flatMap(loadVerticalCaseFile),
    ...TABLE_CASE_FILES.flatMap(loadTableCaseFile),
  ]

  return cases.sort((a, b) => a.id.localeCompare(b.id))
}

export function casePrefix(id: string): string {
  if (id.startsWith('P0-')) return 'P0'
  if (id.startsWith('P1-')) return 'P1'
  if (id.startsWith('P2-')) return 'P2'
  return id.split('-')[0]
}

export function summarizeCases(cases: AcceptanceCase[]): Record<string, number> {
  return cases.reduce<Record<string, number>>((summary, testCase) => {
    const prefix = casePrefix(testCase.id)
    summary[prefix] = (summary[prefix] ?? 0) + 1
    return summary
  }, {})
}

export function assertCaseShape(testCase: AcceptanceCase): string[] {
  const errors: string[] = []

  if (!CASE_ID_RE.test(testCase.id)) {
    errors.push('用例 ID 不符合约定格式')
  }

  for (const [field, value] of Object.entries({
    title: testCase.title,
    sourceFile: testCase.sourceFile,
    section: testCase.section,
    method: testCase.method,
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    passCriteria: testCase.passCriteria,
    failureHypothesis: testCase.failureHypothesis,
  })) {
    if (!value || value.trim().length === 0) {
      errors.push(`${field} 不能为空`)
    }
  }

  if (!hasConcretePassCriteria(testCase.passCriteria)) {
    errors.push('通过标准必须包含可检查的字段、状态、数量、错误类型或来源指针')
  }

  if (testCase.failureHypothesis.length < 4) {
    errors.push('失败原因过短，不能定位可能错误')
  }

  return errors
}

function loadVerticalCaseFile(relativePath: string): AcceptanceCase[] {
  const content = readSpec(relativePath)
  const fields = parseVerticalFields(content)
  const id = fields['用例 ID']
  const heading = firstHeading(content)
  const title = stripIdFromTitle(heading, id)

  return [
    {
      id,
      title,
      sourceFile: relativePath,
      section: heading,
      method: fields['测试方式'],
      input: fields['输入'],
      expectedOutput: fields['预期输出'],
      passCriteria: fields['通过标准'],
      failureHypothesis: fields['如果错了，可能是什么错'],
      references: fields['对照'],
      operation: fields['操作'],
    },
  ]
}

function loadTableCaseFile(relativePath: string): AcceptanceCase[] {
  const content = readSpec(relativePath)
  const lines = content.split(/\r?\n/)
  const cases: AcceptanceCase[] = []
  let section = firstHeading(content)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const heading = line.match(/^#{2,3}\s+(.+)$/)
    if (heading) {
      section = heading[1].trim()
      continue
    }

    if (!line.trim().startsWith('|')) continue

    const header = parseRow(line)
    const separator = parseRow(lines[index + 1] ?? '')
    if (!header.includes('用例 ID') || !isSeparator(separator)) continue

    index += 2
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      const cells = parseRow(lines[index])
      const row = toRowObject(header, cells)
      if (row['用例 ID']) {
        cases.push(rowToCase(row, relativePath, section))
      }
      index += 1
    }
  }

  return cases
}

function rowToCase(row: Record<string, string>, sourceFile: string, section: string): AcceptanceCase {
  const title =
    row['对象'] ??
    row['服务'] ??
    row['事件'] ??
    row['场景'] ??
    row['范围'] ??
    row['用例 ID']

  return {
    id: row['用例 ID'],
    title,
    sourceFile,
    section,
    method: row['测试方式'],
    input: row['输入'],
    expectedOutput: row['预期输出'],
    passCriteria: row['通过标准'],
    failureHypothesis: row['如果错了，可能是什么错'],
    references: [row['对照 06'], row['对照 07']].filter(Boolean).join('; '),
  }
}

function parseVerticalFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const [key, value] = parseRow(line)
    if (!key || key === '字段' || key.startsWith('---')) continue
    fields[key] = value ?? ''
  }
  return fields
}

function parseRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return withoutEdges.split('|').map((cell) => cell.trim())
}

function toRowObject(header: string[], cells: string[]): Record<string, string> {
  return header.reduce<Record<string, string>>((row, key, index) => {
    row[key] = cells[index] ?? ''
    return row
  }, {})
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))
}

function firstHeading(content: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1].trim() ?? '未命名测试文件'
}

function stripIdFromTitle(title: string, id: string): string {
  return title.replace(new RegExp(`^${escapeRegExp(id)}\\s*`), '').trim()
}

function hasConcretePassCriteria(criteria: string): boolean {
  const concreteTokens = [
    '`',
    'id',
    'Id',
    'status',
    'type',
    'source',
    'evidence',
    'error',
    'reason',
    'score',
    'missingSections',
    '数量',
    '状态',
    '等于',
    '返回',
    '不',
    '含',
    '一致',
    '变化',
    '写入',
    '读取',
    '显示',
    '最终',
    '创建',
    '删除',
    '标记',
    '数组',
    '为空',
    '非空',
    'ValidationError',
    'PermissionError',
    'BoundaryError',
    'ConflictError',
    'StateTransitionError',
    'failed',
  ]

  return criteria.length >= 12 && concreteTokens.some((token) => criteria.includes(token))
}

function readSpec(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
