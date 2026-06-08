# MF-02 从资料导入进入学习

| 字段 | 内容 |
|---|---|
| 用例 ID | MF-02 |
| 对照 | 06 第 13.3、5.2；07 第 5.2；08 第 4.2 |
| 测试方式 | API 集成 + UI / E2E |
| 输入 | title=`操作系统笔记`、source=`课程笔记 URL`、content=`包含进程、线程、调度的资料`、vaultId |
| 操作 | 粘贴带标题、来源和正文的资料，触发导入，检查 literature、概念、关系、路径和 ImportResult |
| 预期输出 | LiteratureCard、ExtractedConcept、ExtractedFleeting、ExtractedRelation、LearningPath、ImportResult |
| 通过标准 | LiteratureCard.source 或 citation 非空；所有新建 Card / Edge / Path 的 vaultId 等于输入 vaultId；ImportResult 至少包含 created / skipped / errors；source 为空时返回 ValidationError，且不创建 permanent 卡 |
| 如果错了，可能是什么错 | 导入绕过来源校验；source 丢失导致不可追溯；抽取流程直接生成 permanent；ImportResult 统计和真实写入不一致；跨 Vault 写入没有被拦住 |

