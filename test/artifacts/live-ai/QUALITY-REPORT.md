# Live AI Quality Report

Generated from live test artifacts saved under `test/artifacts/live-ai/`.

This report covers only the live outputs captured in this run. It is a narrow quality sample, not a complete verdict on every AI path in 08.

## Artifact Set

- `sdd-agent-1780885773079-fhpjyrhzs24/agent-role-prompts.json`
- `sdd-sidecar-1780885815844-1558bkyncvc/sidecar-resource-generation.json`
- `sdd-api-1780886538247-fj3wjnxemlr/api-real-deepseek.json`
- `sdd-api-1780886538247-fj3wjnxemlr/learning-path-adjustments.json`
- `sdd-sidecar-1780887871564-37be790wn6q/sidecar-resource-generation-multi.json`

Older API artifacts from the previous run are still present in the same directory tree for comparison.

## Findings

### Agent role prompts

The live role prompt test is structurally sound. Every role returned the exact required schema, preserved `role`, `token`, and `status`, and produced non-empty summaries.

Quality is only moderate. The responses are valid smoke-test outputs, but they are mostly generic and templated. The `Profile` reply, for example, invents a detailed learner profile that is not grounded in the test prompt. That is acceptable for a schema compliance probe, but it is not strong evidence of real reasoning quality.

### DeepSeek document extraction

The direct DeepSeek extraction is the most semantically grounded artifact in the set. It correctly extracts the two concepts present in the document, keeps the JSON schema intact, and the normalized output matches the parsed structure.

Quality is good for integration coverage, but still shallow. The extractor stays close to the source text, yet it only emits a minimal relation set and duplicates concept content in the fleeting cards. That is fine for a compact source document, but it is not enough to claim robust extraction quality across richer inputs.

### Learning path adjustments

This is the strongest artifact in the batch. The response is specific, actionable, and tied to the assessment signal:

- it identifies the trigger as `assessment`
- it carries a concrete `score` and `maxScore`
- it gives a precise recommendation to review the target concept
- it explains the reason in plain language

This output is useful, readable, and directly traceable to the source state. It is the best evidence in the current batch that the AI output is not just well-formed, but actually operational.

### Sidecar resource generation

The generated document is coherent and substantial. It follows the requested structure, explains the topic in a readable way, and produces a usable Markdown resource with sections and code examples.

Quality is good for a single document artifact. The main limitation is coverage, not coherence: the live test only exercises `document` generation, so it does not yet prove the quality of `mindmap`, `quiz`, `code`, `video`, `svg`, `diagram`, `docx`, `pdf`, or `ppt`.

### Multi-format resource generation

The follow-up multi-format run improves coverage, and it exposes the weakest parts of the current AI stack.

Observed results:

- `mindmap` completed and produced a readable Mermaid mindmap with a sensible structure.
- `quiz` completed and produced a valid JSON question set. The questions are usable, but still fairly generic and template-like.
- `code` completed and produced a coherent exercise with objective, starter code, tasks, and sample solution.
- `diagram` failed validation because the cleaned output no longer contained the `mermaid` keyword even though the raw response started with a Mermaid block. This is a format-handling weakness.
- `svg` failed because the model returned empty content. This is the clearest quality failure in the batch.

This is the most important quality signal from the live run: not all resource formats are equally reliable. Text-heavy artifacts are currently stronger than rendered or syntax-sensitive ones.

## Overall Judgment

The saved live outputs show that the AI pipeline is working at two different levels:

1. Schema compliance and integration wiring are stable.
2. Real usefulness varies by task.

The current batch does not justify a blanket claim of high AI quality. It does justify a narrower claim:

- path adjustments are already operationally useful
- document generation is coherent
- extraction is grounded but shallow
- role prompts are structurally correct but semantically weak as a quality signal
- mindmap / quiz / code are serviceable
- diagram and svg are currently weak or unreliable

## Next Step

If you want the quality bar to be meaningful instead of cosmetic, the next test asset should be a small golden set with explicit rubric checks for:

- groundedness
- completeness
- actionability
- format adherence
- source attribution
