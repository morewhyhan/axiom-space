# Profile Confidence 计算公式

> ⚠️ **注意**: 本文档描述 confidence 的计算目标。
> 当前实现中 confidence 为 Cognition API 返回的模拟值，
> 尚未按照以下公式实现。
>
> TODO: 在 `server/core/cognition/profile-confidence.ts` 中实现本公式。

## 公式

```
confidence = min(1.0, 
    w1 * f(permanentCardCount) + 
    w2 * g(wikilinkEdgeCount) + 
    w3 * h(chatRoundCount) + 
    w4 * j(quizCorrectRate)
)
```

## 信号权重

| 信号 | 权重 | 函数 | 说明 |
|------|------|------|------|
| 永久卡数量 | w1 = 0.35 | f(x) = min(1, x/50) | 50 张满 |
| WikiLink 边数 | w2 = 0.30 | g(x) = min(1, x/80) | 80 条满 |
| 对话轮数 | w3 = 0.20 | h(x) = min(1, x/30) | 30 轮满 |
| Quiz 正确率 | w4 = 0.15 | j(x) = x (0~1) | 直接使用 |

## 阈值

| 阈值 | 值 | 含义 |
|------|:---:|------|
| T_PUSH | 0.6 | ≥ 此值 → 开启主动推送 |
| CONFIDENCE_LOW_MAX | 0.3 | 永久卡=0 时 confidence ≤ 此值 |
| INITIAL_CONFIDENCE | 0.15 | 新用户初始值 |

## 边界条件

- 永久卡 = 0 → confidence ≤ 0.2 (CONFIDENCE_LOW_MAX 以下)
- 永久卡 ≥ 30 且 wikilink 边 ≥ 50 → confidence ≥ 0.6
- confidence 单调不降（除非显式 reset）
