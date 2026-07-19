DO $$
DECLARE
  v_vault_id TEXT;
  v_card_id TEXT;
BEGIN
  SELECT id INTO v_vault_id
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
  SET content = $card$
# Visitor 双重分派

## 定义 Definition

Visitor 双重分派是一种把“元素真实类型”和“访问者真实类型”先后纳入方法选择的分派机制。第一次由元素进入自己的 `accept`，第二次由 `accept` 内的 `this` 选择对应的 `visit` 重载，再由 Visitor 的真实类型执行重写实现。

## 位置与关系 Position / Relations

它属于 [[软件设计模式]] 中 Visitor 模式的核心机制，并与“编译期重载选择”“运行期重写分派”直接关联。没有这两段分派，就无法解释为什么 `visitor.visit(node)` 与 `node.accept(visitor)` 的结果不同。

## 例子 Example

例如：`Node n = new PdfNode(); visitor.visit(n)` 会在编译期按变量 `n` 的静态类型选中 `visit(Node)`；而 `n.accept(visitor)` 会先进入 `PdfNode.accept`，再用 `this` 选中 `visit(PdfNode)`，最后执行具体 Visitor 的重写实现。

## 应用场景 Application

当元素类型相对稳定、但需要持续增加报表、导出、校验等操作时，可以使用 Visitor，把新增操作集中在新的 Visitor 实现中。

## 边界 Boundary

它不是“根据运行时参数自动选择重载”。如果元素类型经常增加，每增加一种元素都要修改 Visitor 接口及已有实现，此时 Visitor 的维护成本会明显上升，不适合继续使用。

## 掌握证据 Evidence

学生已用自己的话解释两次分派，并把机制迁移到陌生 AST 节点；同时能指出“元素类型频繁增加”这一失败边界。证据来自本轮苏格拉底式追问后的费曼输出与 Agent B 记录。

## 为什么必要 Why it matters

因为只记住“双重分派”这个术语，无法预测真实代码会进入哪个方法；保留这张永久卡，才能在新场景中判断编译期选择、运行期分派以及模式失效边界。
$card$,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = v_card_id;

  INSERT INTO "vaultMemory" (id, "vaultId", key, value, category, "createdAt")
  VALUES (
    'a3-cap-review-pass-' || v_card_id,
    v_vault_id,
    'a3-cap-review-pass:' || v_card_id,
    jsonb_build_object(
      'sourceObjectId', v_card_id,
      'sourceObjectType', 'card',
      'feynmanStatus', 'accepted',
      'promotionReady', true,
      'evidenceSummary', '学生完成陌生 AST 场景迁移，并准确说明 Visitor 的失败边界。',
      'agentChannel', 'B',
      'seededFor', 'A3 Cap segmented recording'
    )::TEXT,
    'observation',
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("vaultId", key) DO UPDATE
  SET value = EXCLUDED.value,
      category = EXCLUDED.category;

  RAISE NOTICE 'Prepared A3 review-pass state: card %', v_card_id;
END $$;
