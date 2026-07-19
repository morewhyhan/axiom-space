import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateInventoryRaceExplanation,
  findInventoryRaceAccuracyViolations,
} from '@/server/core/domain/inventory-race-contract'
import { validatePermanentCardContent } from '@/server/core/domain/contracts'

test('a complete inventory-race explanation identifies the interleaving, correction, and boundary', () => {
  const explanation = `
库存只剩 1 时，请求 A 和请求 B 可能都在任何写回发生之前读到 1。两个请求随后交错执行，
各自依据同一份已经过期的库存状态通过判断，再分别扣减，因此单次代码看起来正确，组合起来却会超卖。
可以把库存条件和扣减合成一条原子条件更新，并以影响行数判断谁成功。这个办法也有边界：
如果流程还跨越订单、支付和发券，就仍需设计事务范围、幂等与失败补偿，不能把单行更新当成全部一致性方案。
  `

  assert.deepEqual(evaluateInventoryRaceExplanation(explanation), {
    substantial: true,
    competingOperations: true,
    sharedStaleState: true,
    interleaving: true,
    atomicCorrection: true,
    boundaryOrCounterexample: true,
  })
  assert.deepEqual(findInventoryRaceAccuracyViolations(explanation), [])
})

test('sequentializing concurrent requests is reported as a deterministic accuracy violation', () => {
  const violations = findInventoryRaceAccuracyViolations(
    '库存超卖不可能发生：第一个请求读取 1，第二个请求必然读取 0，所以两个请求一定完全顺序执行。',
  )

  assert.deepEqual(violations.map((item) => item.code), ['sequentialReadAssumption'])
})

test('calling a split check-then-update sequence atomic is rejected', () => {
  const violations = findInventoryRaceAccuracyViolations(
    '在库存超卖场景中，先查询库存，再扣减库存，这就是原子操作，不会留出并发空隙。',
  )

  assert.deepEqual(violations.map((item) => item.code), ['splitCheckUpdateCalledAtomic'])
})

test('treating a transaction as a universal oversell fix is rejected', () => {
  const violations = findInventoryRaceAccuracyViolations(
    '库存超卖问题只要用了事务，就能保证一致，完全不需要说明隔离级别、更新条件或跨系统范围。',
  )

  assert.deepEqual(violations.map((item) => item.code), ['transactionAsUniversalFix'])
})

test('treating a local lock as a distributed lock is rejected', () => {
  const violations = findInventoryRaceAccuracyViolations(
    '库存超卖发生在多实例集群中，使用 synchronized 就能解决分布式超卖，不需要共享的一致性边界。',
  )

  assert.deepEqual(violations.map((item) => item.code), ['localLockAsDistributedFix'])
})

test('permanent-card validation rejects deterministic inventory-race errors even when structure is complete', () => {
  const content = `# 库存超卖

## 定义与位置

定义：库存超卖属于 [[并发控制]] 中的共享状态问题，它用于解释多个请求怎样处理最后一件商品。

## 例子与应用

例如在电商库存应用场景中，第一个请求读取 1，第二个请求必然读取 0，所以请求天然会顺序完成。
先查询库存，再扣减库存，这就是原子操作。只要用了事务，就能保证一致，库存一定不超卖。
即使系统部署为多实例集群，使用 synchronized 就能解决分布式超卖。

## 关系、依据与边界

依据课程资料和运行记录，这张卡与 [[事务边界]]、[[原子更新]] 存在前置关系。
边界是支付与订单属于另一层问题；保留这张卡很有必要，因为删掉它会丢掉后续学习步骤的证据链。
  `

  const result = validatePermanentCardContent(content)
  const accuracyCodes = result.issues
    .filter((issue) => issue.dimension === 'accuracy')
    .map((issue) => issue.code)

  assert.equal(Object.values(result.checks).every(Boolean), true, 'fixture should pass every structural quality check')
  assert.equal(result.passed, false)
  assert.deepEqual(accuracyCodes, [
    'inventoryRace:sequentialReadAssumption',
    'inventoryRace:splitCheckUpdateCalledAtomic',
    'inventoryRace:transactionAsUniversalFix',
    'inventoryRace:localLockAsDistributedFix',
  ])
  assert.deepEqual(
    result.missingElements.filter((item) => item.startsWith('accuracy:')),
    accuracyCodes.map((code) => `accuracy:${code}`),
  )
})
