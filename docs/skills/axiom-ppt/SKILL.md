---
name: "axiom-ppt"
description: "Generate real PowerPoint (.pptx) files. Invoke when user says 生成PPT/演示文稿/幻灯片."
phases:
  - number: 1
    name: "生成PPT"
    transition: "auto"
    prompt: |
      [Phase 1/1 生成PPT]
      用户要求生成 PPT，主题：{domain}。

      立即调用 generate_ppt 工具，参数：
      - topic = "{domain}"

      不要反问用户、不要读 skill、不要手动创建文件。只需调 generate_ppt 工具，工具内部会自动生成幻灯片内容和 .pptx 文件。
---

# AXIOM PPT — PPT 生成 Skill

## 概述

调用 generate_ppt 工具生成真实 .pptx 文件并放入文献盒。工具只需 topic 参数，内部自动生成幻灯片内容。
