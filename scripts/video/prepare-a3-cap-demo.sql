DO $$
DECLARE
  v_user_id TEXT;
  v_vault_id TEXT;
  v_card_id TEXT;
  v_session_id TEXT;
  v_now TIMESTAMP(3) := CURRENT_TIMESTAMP;
BEGIN
  SELECT id, "userId" INTO v_vault_id, v_user_id
  FROM vault
  WHERE name = '设计模式黄金案例'
  LIMIT 1;

  IF v_vault_id IS NULL THEN
    RAISE EXCEPTION 'Clean A3 vault not found';
  END IF;

  SELECT id INTO v_card_id
  FROM card
  WHERE "vaultId" = v_vault_id
    AND title = 'Visitor 双重分派'
  LIMIT 1;

  IF v_card_id IS NULL THEN
    RAISE EXCEPTION 'Visitor double-dispatch card not found';
  END IF;

  UPDATE card
  SET content = content || E'\n\n## 费曼学习输出\n\n我用自己的话解释：第一次由元素的真实类型进入 accept；在具体元素的方法体里，this 的静态类型让编译器选中对应的 visit 重载；随后再由 Visitor 的真实类型执行重写实现。\n\n## Agent B · 观察记录\n\n- 已记录：能够区分编译期重载选择与运行期重写分派。\n- 证据来源：本轮苏格拉底式追问后的费曼解释。\n- 迁移证据：已迁移到陌生 AST 节点。\n- 失败边界：对象结构频繁增加新类型时，Visitor 的维护成本会显著上升。'
  WHERE id = v_card_id
    AND POSITION('Agent B · 观察记录' IN content) = 0;

  SELECT id INTO v_session_id
  FROM "learningSession"
  WHERE "userId" = v_user_id
    AND "vaultId" = v_vault_id
    AND domain = '__agent__'
    AND metadata LIKE '%' || v_card_id || '%'
  ORDER BY "updatedAt" DESC
  LIMIT 1;

  UPDATE "learningSession"
  SET status = 'paused'
  WHERE "userId" = v_user_id
    AND "vaultId" = v_vault_id
    AND domain = '__agent__'
    AND status = 'active';

  IF v_session_id IS NULL THEN
    v_session_id := 'a3-cap-visitor-thread-' || v_card_id;
    INSERT INTO "learningSession" (
      id, "userId", "vaultId", domain, concept, status, phase,
      outcome, metadata, "createdAt", "updatedAt"
    ) VALUES (
      v_session_id,
      v_user_id,
      v_vault_id,
      '__agent__',
      'Visitor 双重分派',
      'active',
      'card-thread',
      '苏格拉底式追问后完成费曼输出，Agent B 已写回证据，等待掌握审核。',
      jsonb_build_object(
        'sessionKind', 'card-thread',
        'cardId', v_card_id,
        'cardType', 'fleeting',
        'cardTitle', 'Visitor 双重分派',
        'threadStatus', 'active',
        'processStage', 'review-ready',
        'seededFor', 'A3 Cap segmented recording'
      )::TEXT,
      v_now - INTERVAL '8 minutes',
      v_now
    );
  ELSE
    UPDATE "learningSession"
    SET concept = 'Visitor 双重分派',
        status = 'active',
        phase = 'card-thread',
        outcome = '苏格拉底式追问后完成费曼输出，Agent B 已写回证据，等待掌握审核。',
        metadata = jsonb_build_object(
          'sessionKind', 'card-thread',
          'cardId', v_card_id,
          'cardType', 'fleeting',
          'cardTitle', 'Visitor 双重分派',
          'threadStatus', 'active',
          'processStage', 'review-ready',
          'seededFor', 'A3 Cap segmented recording'
        )::TEXT,
        "updatedAt" = v_now
    WHERE id = v_session_id;
  END IF;

  DELETE FROM "learningMessage" WHERE "sessionId" = v_session_id;

  INSERT INTO "learningMessage" (id, "sessionId", role, content, timestamp, metadata)
  VALUES
    (v_session_id || '-m01', v_session_id, 'assistant',
      '先不背定义。Node n = new PdfNode(); visitor.visit(n) 会进入哪个重载？决定发生在编译期还是运行期？',
      v_now - INTERVAL '385 seconds',
      '{"taskSurface":"card-task","processStage":"agent-a-socratic-question","evidenceEligible":false}'),
    (v_session_id || '-m02', v_session_id, 'user',
      '我原以为会进入 visit(PdfNode)，但运行结果是 visit(Node)。我现在分不清是对象真实类型还是变量声明类型在起作用。',
      v_now - INTERVAL '330 seconds',
      '{"taskSurface":"card-task","processStage":"student-misconception","evidenceEligible":true}'),
    (v_session_id || '-m03', v_session_id, 'assistant',
      '很好，先保留这个冲突。请不用术语堆砌，用自己的话解释：accept 到底保留了哪一段类型信息？',
      v_now - INTERVAL '275 seconds',
      '{"taskSurface":"card-task","processStage":"agent-a-socratic-followup","evidenceEligible":false}'),
    (v_session_id || '-m04', v_session_id, 'user',
      '第一次由元素的真实类型进入 accept；在具体元素的方法体里，this 的静态类型让编译器选中对应的 visit 重载；随后再由 Visitor 的真实类型执行重写实现。',
      v_now - INTERVAL '220 seconds',
      '{"taskSurface":"card-task","processStage":"student-feynman-output","evidenceEligible":true}'),
    (v_session_id || '-m05', v_session_id, 'assistant',
      'Agent B 已把你的原话、判断依据和当前缺口写回右侧灵感卡。核心因果链已经闭合，但还不能升级永久卡：下一步要迁移到陌生 AST 节点，并说明 Visitor 不适用的边界。',
      v_now - INTERVAL '165 seconds',
      '{"taskSurface":"card-task","processStage":"agent-b-evidence-writeback","evidenceEligible":false,"agentChannel":"B"}'),
    (v_session_id || '-m06', v_session_id, 'user',
      '换成 AST 也一样：具体节点先进入自己的 accept，再把 this 交给 visitor 的对应重载。如果节点类型经常增加，Visitor 会迫使所有 Visitor 跟着修改，这时它就不合适。',
      v_now - INTERVAL '110 seconds',
      '{"taskSurface":"card-task","processStage":"student-transfer-output","evidenceEligible":true}'),
    (v_session_id || '-m07', v_session_id, 'assistant',
      '这次输出补上了陌生场景迁移和失败边界。Agent B 已追加证据；现在可以发起审核，但是否成为永久卡仍由掌握证据决定，而不是由 AI 单方面宣布。',
      v_now - INTERVAL '55 seconds',
      '{"taskSurface":"card-task","processStage":"agent-b-review-ready","evidenceEligible":false,"agentChannel":"B"}');

  RAISE NOTICE 'Prepared A3 Cap demo thread: session %, card %, messages 7', v_session_id, v_card_id;
END $$;
