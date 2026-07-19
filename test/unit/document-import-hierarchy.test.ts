import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  buildExplicitDocumentStructurePlan,
  extractDocumentCategoryGroups,
  extractDocumentHeadingConcepts,
} from '../../server/core/learning/document-import-service'

describe('document import hierarchy', () => {
  it('keeps literature outside the hierarchy and groups concrete patterns below three domains', () => {
    const document = readFileSync('docs/03-宣传资料/设计模式教学资料.md', 'utf8')
    const groups = extractDocumentCategoryGroups(document, [], '设计模式')
    const concepts = extractDocumentHeadingConcepts(document, '设计模式')

    assert.deepEqual(groups.map((group) => group.title), ['创建型模式', '结构型模式', '行为型模式'])
    assert(groups[0].memberTitles.includes('工厂方法模式'))
    assert(groups[1].memberTitles.includes('适配器模式'))
    assert(groups[2].memberTitles.includes('Visitor 模式'))
    assert(!groups.some((group) => /文献|资料/.test(group.title)))
    assert.equal(concepts.length, 23)
    assert.equal(groups[0].memberTitles.length, 5)
    assert.equal(groups[1].memberTitles.length, 7)
    assert.equal(groups[2].memberTitles.length, 11)
    assert.equal(concepts.find((concept) => concept.title === '工厂方法模式')?.categoryTitle, '创建型模式')
    assert.equal(concepts.find((concept) => concept.title === '模板方法模式')?.categoryTitle, '行为型模式')
    assert.equal(concepts.some((concept) => concept.title.includes('双重分派')), false)
  })

  it('uses the explicit document hierarchy instead of asking AI to redefine the main spine', () => {
    const document = readFileSync('docs/03-宣传资料/设计模式教学资料.md', 'utf8')
    const concepts = extractDocumentHeadingConcepts(document, '设计模式')
    const plan = buildExplicitDocumentStructurePlan({
      parentTitle: '设计模式',
      topic: '设计模式',
      document,
      conceptNames: concepts.map((concept) => concept.title),
      fleetingTitles: [],
    })

    assert(plan)
    assert.deepEqual(plan.conditions.map((condition) => condition.title), ['创建型模式', '结构型模式', '行为型模式'])
    assert.equal(plan.assignments.find((assignment) => assignment.cardTitle === '工厂方法模式')?.conditionTitle, '创建型模式')
    assert.equal(plan.assignments.find((assignment) => assignment.cardTitle === '适配器模式')?.conditionTitle, '结构型模式')
    assert.equal(plan.assignments.find((assignment) => assignment.cardTitle === 'Visitor 模式')?.conditionTitle, '行为型模式')
    assert.equal(plan.coverageCheck?.sufficient, true)
  })
})
