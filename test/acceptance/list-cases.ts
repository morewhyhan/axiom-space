import { loadAcceptanceCases, summarizeCases } from './case-loader'

const cases = loadAcceptanceCases()
const summary = summarizeCases(cases)

console.log(`Total acceptance cases: ${cases.length}`)
for (const [prefix, count] of Object.entries(summary)) {
  console.log(`${prefix}: ${count}`)
}
