-- Make the existing A3 resource-generation evidence visible as one demo conversation.
-- Idempotent: re-running replaces only this dedicated demo thread. Resolve all
-- foreign keys by semantic identity so reseeding the golden vault cannot leave
-- this recording fixture pointing at stale UUIDs.

DO $$
DECLARE
  demo_user_id "user".id%TYPE;
  mature_vault_id vault.id%TYPE;
  resource_pack_id card.id%TYPE;
BEGIN
  SELECT u.id, v.id, c.id
    INTO demo_user_id, mature_vault_id, resource_pack_id
  FROM "user" u
  JOIN vault v ON v."userId" = u.id
  JOIN card c ON c."vaultId" = v.id
  WHERE u.email = 'demo@axiom.space'
    AND v.name = '设计模式黄金案例·长期档案'
    AND c.title = 'Visitor 双重分派个性化资源包'
  ORDER BY c."updatedAt" DESC
  LIMIT 1;

  IF demo_user_id IS NULL OR mature_vault_id IS NULL OR resource_pack_id IS NULL THEN
    RAISE EXCEPTION 'A3 mature vault or Visitor resource pack is missing; run db:seed:a3-golden first';
  END IF;

  INSERT INTO "learningSession" (
    id,
    "userId",
    "vaultId",
    domain,
    concept,
    status,
    phase,
    outcome,
    metadata,
    "createdAt",
    "updatedAt"
  )
  VALUES (
    'a3-cap-resource-conversation-20260718',
    demo_user_id,
    mature_vault_id,
    '__agent__',
    '个性化资源：用户点单与系统推送',
    'active',
    'conversation',
    '六类资源已生成并通过质量检查；主动推送严格等待用户确认。',
    jsonb_build_object(
      'sessionKind', 'conversation',
      'threadStatus', 'active',
      'resourcePackCardId', resource_pack_id,
      'resourcePackTitle', 'Visitor 双重分派个性化资源包',
      'seededFor', 'A3 segmented demo: explicit request and evidence-driven push'
    )::text,
    NOW() - INTERVAL '10 minutes',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    "userId" = EXCLUDED."userId",
    "vaultId" = EXCLUDED."vaultId",
    domain = EXCLUDED.domain,
    concept = EXCLUDED.concept,
    status = EXCLUDED.status,
    phase = EXCLUDED.phase,
    outcome = EXCLUDED.outcome,
    metadata = EXCLUDED.metadata,
    "updatedAt" = NOW();
END $$;

DELETE FROM "learningMessage"
WHERE "sessionId" = 'a3-cap-resource-conversation-20260718';

INSERT INTO "learningMessage" (id, "sessionId", role, content, "timestamp", metadata)
VALUES
  (
    'a3-cap-resource-msg-01',
    'a3-cap-resource-conversation-20260718',
    'assistant',
    '我会先读取当前知识节点、六维画像、正式测验与已有资源清单。已经掌握的基础 UML 不重复生成。',
    NOW() - INTERVAL '9 minutes',
    '{"evidenceGrade":"observed","agent":"teaching"}'
  ),
  (
    'a3-cap-resource-msg-02',
    'a3-cap-resource-conversation-20260718',
    'user',
    '这一次把讲解文档、思维导图、题库、代码、关系图和视频全部生成，并放在一起。',
    NOW() - INTERVAL '8 minutes',
    '{"intent":"explicit_resource_request"}'
  ),
  (
    'a3-cap-resource-msg-03',
    'a3-cap-resource-conversation-20260718',
    'assistant',
    '这是你的明确请求，不需要额外确认。我会生成六类资源，各自保留真实文件格式，并创建一个资源包文献节点统一打开。',
    NOW() - INTERVAL '7 minutes',
    '{"tool":"push_resource","requestedKinds":["document","mindmap","quiz","code","diagram","video"]}'
  ),
  (
    'a3-cap-resource-msg-04',
    'a3-cap-resource-conversation-20260718',
    'assistant',
    '六类资源全部完成，并通过非空、格式、来源和预览检查。资源包已经写入知识图谱；每一项都可以在右侧单独预览。',
    NOW() - INTERVAL '6 minutes',
    '{"result":"completed","qualityGate":"passed","resourceCount":6}'
  ),
  (
    'a3-cap-resource-msg-05',
    'a3-cap-resource-conversation-20260718',
    'user',
    '以后不要重复推送基础 UML。',
    NOW() - INTERVAL '5 minutes',
    '{"preference":"skip_mastered_basics"}'
  ),
  (
    'a3-cap-resource-msg-06',
    'a3-cap-resource-conversation-20260718',
    'assistant',
    '收到。根据你的迁移测验和路径记录，Visitor 与 Strategy、Command 的选择边界仍是缺口。我可以生成一份边界对照和隔周复测题库，但这是系统主动建议，需要你先确认。',
    NOW() - INTERVAL '4 minutes',
    '{"intent":"evidence_driven_suggestion","requiresConfirmation":true,"confidence":0.88}'
  ),
  (
    'a3-cap-resource-msg-07',
    'a3-cap-resource-conversation-20260718',
    'user',
    '同意生成边界对照和题库，不要重复 UML。',
    NOW() - INTERVAL '3 minutes',
    '{"confirmation":"accepted"}'
  ),
  (
    'a3-cap-resource-msg-08',
    'a3-cap-resource-conversation-20260718',
    'assistant',
    '已按确认生成并写入文献节点；资源与学习证据已经关联，基础 UML 建议已忽略。',
    NOW() - INTERVAL '2 minutes',
    '{"result":"completed","pushBoundary":"confirmed_by_user"}'
  );
