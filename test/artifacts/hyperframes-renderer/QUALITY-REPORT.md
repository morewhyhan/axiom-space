# HyperFrames Renderer Smoke Test

Generated from renderer smoke tests under `test/artifacts/hyperframes-renderer/`.

只做文件级校验：二进制容器格式是否正确，不检查视觉内容和排版质量。

## 2026-06-10 Run 3 (06:16 UTC)

Artifact: `sdd-hyperframes-1781043342047-or5kt8okd7/summary.json`

| File | Size (bytes) | Header | Valid? |
|---|---|---|---|
| `demo.docx` | 24,507 | `PK..` (ZIP) | ✅ |
| `demo.pdf` | 24,982 | `%PDF` | ✅ |
| `demo.pptx` | 53,532 | `PK..` (ZIP) | ✅ |

## 2026-06-10 Run 2 (04:51 UTC)

Artifact: `sdd-hyperframes-1781038141072-qb151tuiojh/summary.json`

| File | Size (bytes) | Header | Valid? |
|---|---|---|---|
| `demo.docx` | 24,507 | `PK..` (ZIP) | ✅ |
| `demo.pdf` | 24,982 | `%PDF` | ✅ |
| `demo.pptx` | 53,532 | `PK..` (ZIP) | ✅ |

## 2026-06-08 Run 1

Artifact: `sdd-hyperframes-1780890994986-tnsr6eg8azn/summary.json`

| File | Size (bytes) | Header | Valid? |
|---|---|---|---|
| `demo.docx` | 24,507 | `PK..` (ZIP) | ✅ |
| `demo.pdf` | 24,982 | `%PDF` | ✅ |
| `demo.pptx` | 53,532 | `PK..` (ZIP) | ✅ |

## 结论

- 3 次运行结果完全一致（字节级相同）
- docx / pdf / pptx 三种格式均生成有效二进制容器
- 输出是确定性的（无时间戳、无随机 ID）
- 文件头校验通过，但未验证视觉内容和 Office 应用打开效果
