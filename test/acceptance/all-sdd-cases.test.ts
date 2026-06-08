import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXPECTED_CASE_COUNTS,
  EXPECTED_TOTAL_CASES,
  assertCaseShape,
  loadAcceptanceCases,
  summarizeCases,
} from './case-loader'
import { assertExecutableAcceptanceCase } from './sdd-executable-contract'

const cases = loadAcceptanceCases()

test('SDD acceptance case registry contains exactly 289 cases', () => {
  assert.equal(cases.length, EXPECTED_TOTAL_CASES)
})

test('SDD acceptance case IDs are unique', () => {
  const ids = cases.map((testCase) => testCase.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('SDD acceptance case counts match the coverage map', () => {
  assert.deepEqual(summarizeCases(cases), EXPECTED_CASE_COUNTS)
})

test('every SDD acceptance case has executable contract metadata', () => {
  const failures = cases.flatMap((testCase) =>
    assertCaseShape(testCase).map((error) => `${testCase.id}: ${error}`),
  )

  assert.deepEqual(failures, [])
})

for (const acceptanceCase of cases) {
  test(acceptanceCaseName(acceptanceCase), () => {
    assertExecutableAcceptanceCase(acceptanceCase)
  })
}

function acceptanceCaseName(testCase: (typeof cases)[number]): string {
  return `${testCase.id} ${testCase.title} [${testCase.method}]`
}
