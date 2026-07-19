/**
 * 并发库存/单次资源领取的确定性契约。
 *
 * 这里只检查可重复的机制证据与确定性事实错误；不用关键词分数
 * 替代语义评估，也不把“写了一张好卡”当成“学生已经掌握”。
 */

export type InventoryRaceExplanationChecks = {
  substantial: boolean
  competingOperations: boolean
  sharedStaleState: boolean
  interleaving: boolean
  atomicCorrection: boolean
  boundaryOrCounterexample: boolean
}

export type InventoryRaceAccuracyViolation = {
  code: 'sequentialReadAssumption' | 'splitCheckUpdateCalledAtomic' | 'transactionAsUniversalFix' | 'localLockAsDistributedFix'
  label: string
  message: string
  fix: string
}

export function isInventoryRaceContext(context: string) {
  return /(?:库存.{0,12}(?:超卖|扣减|并发)|超卖|竞态条件|共享旧状态|丢失更新|最后一张优惠券|未领取.{0,18}同时)/i.test(context)
}

export function evaluateInventoryRaceExplanation(explanation: string): InventoryRaceExplanationChecks {
  const compact = explanation.replace(/\s+/g, '')
  return {
    substantial: compact.length >= 140,
    competingOperations: /(?:两个|两次|多个|请求\s*[AB]|甲.{0,20}乙)/i.test(explanation),
    sharedStaleState: /(?:旧状态|过期状态|同一份.{0,12}(?:状态|库存|结果)|都.{0,12}(?:读到|saw|read).{0,12}(?:1|未领取))/i.test(explanation),
    interleaving: /(?:交错|在.{0,18}之前|先.{0,18}再|读取.{0,24}判断.{0,24}(?:修改|写回|扣减)|timeline)/i.test(explanation),
    atomicCorrection: /(?:原子|条件更新|影响行数|乐观锁|悲观锁|版本号|compare.?and.?set|where.{0,30}(?:stock|status))/i.test(explanation),
    boundaryOrCounterexample: /(?:边界|反例|不够|不适用|不代表|支付|订单|跨系统|补偿|幂等|如果)/i.test(explanation),
  }
}

export function findInventoryRaceAccuracyViolations(text: string): InventoryRaceAccuracyViolation[] {
  if (!isInventoryRaceContext(text)) return []
  const violations: InventoryRaceAccuracyViolation[] = []

  if (/(?:A|第一个请求).{0,24}(?:读取|读到).{0,8}1.{0,48}(?:B|第二个请求).{0,24}(?:一定|必然|肯定).{0,10}(?:读取|读到).{0,8}0/i.test(text)) {
    violations.push({
      code: 'sequentialReadAssumption',
      label: '将并发请求误当成完全顺序',
      message: '如果两个请求都在任何写回之前读取，它们都可能读到库存 1。',
      fix: '先画出读取、判断和写回的交错时间线，再判断每一步看到的状态。',
    })
  }
  if (/(?:先查|查询|读取).{0,30}(?:再扣|再更新|后修改).{0,30}(?:就是|仍然是|算是).{0,8}原子/i.test(text)) {
    violations.push({
      code: 'splitCheckUpdateCalledAtomic',
      label: '把分开的检查与修改误称为原子操作',
      message: '应用层先查询、后更新之间会存在可被其他请求穿过的空隙。',
      fix: '使用带条件的单条更新、版本比较或明确的锁策略，并检查真实更新结果。',
    })
  }
  if (/(?:只要|加了|用了).{0,12}事务.{0,24}(?:一定|就能|必然|完全).{0,18}(?:不超卖|解决所有|保证一致)/i.test(text)) {
    violations.push({
      code: 'transactionAsUniversalFix',
      label: '把事务当成无条件的通用解法',
      message: '事务是边界，不是自动防超卖开关；结果还取决于隔离级别、更新条件、锁和跨系统范围。',
      fix: '说清事务包含哪些写入、使用什么隔离/锁策略，以及跨服务失败如何幂等或补偿。',
    })
  }
  if (/(?:synchronized|本地锁|进程锁).{0,28}(?:一定|就能|必然|完全).{0,18}(?:解决|防止).{0,16}(?:集群|多实例|分布式|超卖)/i.test(text)) {
    violations.push({
      code: 'localLockAsDistributedFix',
      label: '把本地锁误当成跨实例锁',
      message: '本地进程锁只能约束同一进程内的竞争，不能自动串行化其他服务实例。',
      fix: '把互斥边界放到所有实例都共享的一致性层，并明确故障恢复策略。',
    })
  }

  return violations
}

