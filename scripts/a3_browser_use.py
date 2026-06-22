#!/usr/bin/env python3
"""Run the A3 demo check with the official browser-use Agent."""

from __future__ import annotations

import argparse
import asyncio
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BROWSER_USE_HOME = Path("/tmp/axiom-browser-use-home")
DEFAULT_BROWSER_USE_CONFIG = Path("/tmp/axiom-browser-use-config")
DEFAULT_BROWSER_USE_PROFILE = Path("/tmp/axiom-browser-use-profile")
DEFAULT_PLAYWRIGHT_CACHE = Path("/home/why/.cache/ms-playwright")

PROOF_SECTIONS_BY_SCENE: dict[int, list[int]] = {
    1: [1, 2],
    2: [3],
    3: [3],
    4: [4],
    5: [4],
    6: [4],
    7: [5],
    8: [6],
    9: [7],
    10: [7],
    11: [8, 10],
    12: [8],
    13: [9],
    14: [10],
    15: [11],
    16: [12],
    17: [12],
    18: [13],
    19: [13],
    20: [14],
}

GRAPH_COURSE_MATERIAL = (
    "DS Chapter 6 Graphs. Definition: G=(V,E). Example: a weighted city graph; "
    "shortest path means minimum total weight, not fewest edges. Dijkstra: select "
    "the nearest unsettled vertex and relax edges; use only nonnegative weights."
)

os.environ.setdefault("HOME", str(DEFAULT_BROWSER_USE_HOME))
os.environ.setdefault("BROWSER_USE_CONFIG_DIR", str(DEFAULT_BROWSER_USE_CONFIG))
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

PYTHON_BIN_DIR = Path(sys.executable).resolve().parent
current_path = os.environ.get("PATH", "")
if str(PYTHON_BIN_DIR) not in current_path.split(os.pathsep):
    os.environ["PATH"] = f"{PYTHON_BIN_DIR}{os.pathsep}{current_path}" if current_path else str(PYTHON_BIN_DIR)

try:
    from browser_use import Agent, BrowserProfile
    from browser_use.browser.profile import ViewportSize
    from browser_use.llm.deepseek.chat import ChatDeepSeek
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Official browser-use is not installed in this Python environment. "
        "Use /tmp/axiom-browser-use-venv/bin/python or install browser-use[core]."
    ) from exc


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def find_doc(prefix: str) -> Path:
    matches = sorted((ROOT / "docs").rglob(f"{prefix}*.md"))
    if not matches:
        raise FileNotFoundError(f"Could not find docs file starting with {prefix!r}")
    return matches[0]


def normalize_deepseek_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if "deepseek.com" in normalized and not normalized.endswith("/v1"):
        normalized = f"{normalized}/v1"
    return normalized


def request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    cookie_header: str | None = None,
) -> tuple[int, dict[str, Any], http.cookiejar.CookieJar]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if cookie_header:
        headers["Cookie"] = cookie_header

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    timeout = int(os.environ.get("A3_BROWSER_USE_HTTP_TIMEOUT_SECONDS", "90"))
    try:
        with opener.open(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            parsed = json.loads(body) if body else {}
            return response.status, parsed, jar
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError:
            parsed = {"error": body}
        return exc.code, parsed, jar


def cookie_header_from_jar(jar: http.cookiejar.CookieJar) -> str:
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in jar)


def storage_cookie_from_jar(
    jar: http.cookiejar.CookieJar,
    start_url: str,
) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(start_url)
    host = parsed.hostname or "localhost"
    for cookie in jar:
        if cookie.name.endswith("session_token"):
            return {
                "name": cookie.name,
                "value": cookie.value,
                "domain": host,
                "path": cookie.path or "/",
                "expires": int(time.time()) + 604800,
                "httpOnly": bool(cookie.has_nonstandard_attr("HttpOnly") or cookie.has_nonstandard_attr("httponly")),
                "secure": parsed.scheme == "https",
                "sameSite": "Lax",
            }
    raise RuntimeError("Auth response did not include a session cookie")


def prepare_auth_storage_state(
    start_url: str,
    run_dir: Path,
    test_name: str,
    test_email: str,
    test_password: str,
) -> Path:
    base = start_url.rstrip("/")
    sign_in_url = f"{base}/api/auth/sign-in/email"
    sign_up_url = f"{base}/api/auth/sign-up/email"
    vaults_url = f"{base}/api/vaults"

    status, body, jar = request_json(
        sign_in_url,
        method="POST",
        payload={"email": test_email, "password": test_password},
    )
    if status >= 400 or not cookie_header_from_jar(jar):
        status, body, jar = request_json(
            sign_up_url,
            method="POST",
            payload={"email": test_email, "password": test_password, "name": test_name},
        )
    if status >= 400:
        raise RuntimeError(f"Auth setup failed ({status}): {body}")

    cookie_header = cookie_header_from_jar(jar)
    if not cookie_header:
        raise RuntimeError("Auth setup did not produce a cookie")

    status, body, _ = request_json(vaults_url, cookie_header=cookie_header)
    if status >= 400:
        raise RuntimeError(f"Vault list setup failed ({status}): {body}")
    vaults = body.get("vaults") if isinstance(body, dict) else None
    if not isinstance(vaults, list):
        vaults = []

    data_vault = next((vault for vault in vaults if vault.get("name") == "数据结构"), None)
    if data_vault is None:
        status, body, _ = request_json(
            vaults_url,
            method="POST",
            payload={"name": "数据结构"},
            cookie_header=cookie_header,
        )
        if status >= 400:
            raise RuntimeError(f"Vault create setup failed ({status}): {body}")

    parsed = urllib.parse.urlparse(start_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    storage_state = {
        "cookies": [storage_cookie_from_jar(jar, start_url)],
        "origins": [
            {
                "origin": origin,
                "localStorage": [
                    {
                        "name": "axiom-store",
                        "value": json.dumps(
                            {
                                "state": {
                                    "mode": "dashboard",
                                    "currentVaultId": None,
                                    "hasCompletedOnboarding": True,
                                },
                                "version": 10,
                            },
                            ensure_ascii=False,
                        ),
                    }
                ],
            }
        ],
    }
    path = run_dir / "storage-state.json"
    path.write_text(json.dumps(storage_state, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def find_local_browser() -> Path | None:
    explicit = os.environ.get("A3_BROWSER_USE_EXECUTABLE_PATH") or os.environ.get(
        "BROWSER_USE_EXECUTABLE_PATH"
    )
    if explicit:
        path = Path(explicit)
        return path if path.exists() else None

    candidates = [
        Path("/usr/bin/google-chrome"),
        Path("/usr/bin/google-chrome-stable"),
        Path("/usr/bin/chromium"),
        Path("/usr/bin/chromium-browser"),
    ]
    if DEFAULT_PLAYWRIGHT_CACHE.exists():
        candidates.extend(
            sorted(
                DEFAULT_PLAYWRIGHT_CACHE.glob("chromium-*/chrome-linux64/chrome"),
                reverse=True,
            )
        )

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def extract_section(text: str, heading_pattern: str, stop_pattern: str) -> str:
    lines = text.splitlines()
    start = None
    heading_re = re.compile(heading_pattern)
    stop_re = re.compile(stop_pattern)

    for index, line in enumerate(lines):
        if heading_re.match(line):
            start = index
            break
    if start is None:
        return ""

    end = len(lines)
    for index in range(start + 1, len(lines)):
        if stop_re.match(lines[index]):
            end = index
            break

    return "\n".join(lines[start:end]).strip()


def extract_scene(script_text: str, scene: int) -> str:
    return extract_section(
        script_text,
        rf"^### 场景 {scene:02d}[：:]",
        r"^(### 场景 \d{2}[：:]|## \d+\. )",
    )


def extract_proof_sections(proof_text: str, scene: int) -> str:
    sections: list[str] = []
    for proof_number in PROOF_SECTIONS_BY_SCENE.get(scene, []):
        section = extract_section(
            proof_text,
            rf"^### {proof_number:02d}\. ",
            r"^(### \d{2}\. |## \d+\. )",
        )
        if section:
            sections.append(section)

    minimum_checklist = extract_section(
        proof_text,
        r"^## 9\. 最低页面对照清单",
        r"^## 10\. ",
    )
    if minimum_checklist:
        sections.append(minimum_checklist)

    return "\n\n".join(sections)


def build_scene_task(
    start_url: str,
    scene: int,
    scenario_section: str,
    proof_sections: str,
    test_name: str,
    test_email: str,
    test_password: str,
) -> str:
    material_instruction = ""
    scene_focus_instruction = ""
    if scene in {4, 5}:
        material_instruction = f"""

Test material for import scenes:
- Prefer clicking "填入图论讲义示例" when it is visible.
- If the sample button is not visible, paste this exact one-line ASCII course material into the textarea labeled "粘贴资料全文".
- Do not invent another source and do not leave the material field empty.
- For Scene 05, if the page is already past the import form and shows imported graph/Dijkstra material,
  generated literature/concept cards, or the "图与最短路径" learning path, verify those visible results instead
  of trying to import the same material again.

{GRAPH_COURSE_MATERIAL}
"""
    if scene in {9, 10}:
        scene_focus_instruction = """

Card-thread guardrails for Scene 09/10:
- These scenes must happen inside the current learning card thread, not in a free conversation.
- Prefer the visible card thread tied to the shortest-path misunderstanding card from the earlier path/workspace flow.
- If the page is in AI workspace but no current card thread is open, first open the visible left-side path/session panel, locate the shortest-path clarification task/card, and enter that card thread.
- Avoid creating a new free talk session for Scene 09/10 unless the product gives no visible path back to the card thread; if that happens, report it as a product bug.
- For Scene 09, the expected success shape is: AI first asks the user to explain in their own words, then the user gives a concrete counterexample.
- For Scene 09, type the user's answer as one single line without newline characters, so Enter/newline does not submit only the first sentence:
  "因为边权不同：一条边权重100，三条边10+10+10=30，所以三条更短；最短看权重总和，不是边数。"
- If the textarea already contains or history already shows only a short first sentence, send the missing counterexample as another short single-line user message:
  "一条边权重100，三条边每条10，总共30，所以三条更短；最短比较权重总和，不是边数。"
- For Scene 10, verify the user's wording appears in the current card and that a visible save/record update is shown.
"""
    if scene == 12:
        scene_focus_instruction = """

Resource-generation guardrails for Scene 12:
- This scene is an action request. If five resource cards are not already visible, open the AI conversation for the current card and send:
  "请基于这张卡和刚导入的讲义，生成适合我补这个误区的学习资源。"
- Do not keep scrolling the same card panel more than twice after it is clear no resource section is appearing.
- If you have already scrolled the current card panel twice and still do not see 讲解文档/思维导图/练习题/代码实操/视频 or animation resource cards, stop scrolling immediately. The next action must be typing the request into the current card's AI conversation textarea and pressing 发送.
- Do not click 提炼为永久, +NEW, 新建卡片, or create unrelated cards for this scene.
- PASS requires visible evidence of all of these:
  1. generation basis tied to the current card/source/profile gap,
  2. a progress/status view while or after resources generate,
  3. at least five resource types such as 讲解文档, 思维导图, 练习题, 代码实操, 视频/动画脚本,
  4. a resource pack/card opened in preview or READ mode,
  5. at least one resource preview that can be opened or is already visible.
- A generic learning path list does not count as the five generated resource cards.
"""
    if scene == 13:
        scene_focus_instruction = """

Multi-agent collaboration guardrails for Scene 13:
- This scene verifies the collaboration evidence produced by resource generation.
- Prefer opening the most recent generated resource pack/card from AI 工作台 or 卡片库. It may be a literature card with a title related to the current misconception/topic, a visible resource pack, or a recently generated AI resource card.
- If a normal task card is open and it only shows fields such as 学生当前误区, 当前要解决的问题, or 画像依据, do not keep waiting on that card. Open the generated resource pack/read preview instead.
- If you see "最近的 AI 资源生成状态", resource types, or a generated resource list, use that as the bridge to locate and open the corresponding resource pack/card.
- PASS requires visible evidence of the role outputs, ideally in one collaboration/协同 panel. Accept equivalent visible labels for these roles:
  1. 诊断 Agent: identifies the learner misconception or profile gap,
  2. 文献 Agent: references current card, imported source, vault, or RAG evidence,
  3. 路径 Agent: connects the output to the current path/task/next step,
  4. 资源 Agent: lists generated resources such as 讲解文档, 思维导图, 练习题, 代码实操, 视频/动画脚本, Mermaid 图表,
  5. 评估 Agent: shows review, guardrail, quality, or fact-check status,
  6. 观察 Agent: records profile/observation/push basis.
- Evidence spread across ordinary static task-card sections is PARTIAL unless the six agent roles or their collaboration outputs are visibly connected.
- If the PATH tab stays on skeleton/loading placeholders for more than 10 seconds, record it as a bug and return to AI 工作台 instead of waiting there indefinitely.
"""
    if scene == 15:
        scene_focus_instruction = """

Mastery-assessment guardrails for Scene 15:
- This scene verifies the assessment result, not a fresh attempt to create another assessment.
- Prefer 路径规划/PATH for this scene. The normal route is: open PATH, find the current "图与最短路径" learning path, click a visible "完成" or "评估掌握" action on the relevant shortest-path task, then inspect the Learning_Assessment result panel.
- If a Learning_Assessment panel is already visible, use it directly. It should show 掌握度, the question/standard, answer preview/evidence, feedback, and next step.
- If conversation history already shows the user's counterexample plus the system's mastery judgment, use that visible evidence and stop. Do not keep scrolling to find an earlier duplicate copy.
- PASS requires visible evidence of:
  1. a prompt or assessment context asking why weighted shortest path is not simply the fewest edges,
  2. the user's counterexample with one direct edge having high weight and a multi-edge route with lower total weight,
  3. a pass/through judgment such as 掌握判断：通过, 已通过, or equivalent,
  4. reasons that mention distinguishing edge count from total weight, giving a concrete counterexample, and explaining in the user's own words,
  5. a next step such as Dijkstra 的选择过程, Dijkstra 适用边界, or equivalent.
- If the card reading panel stays on "加载卡片内容..." but the AI conversation history contains the evidence above, record the loading state as a UX bug and still PASS the scene.
- Do not keep scrolling the same container more than three times once the pass judgment and user counterexample are visible.
"""
    if scene == 16:
        scene_focus_instruction = """

Permanent-card quality-gate guardrails for Scene 16:
- This scene verifies rejection of an incorrect fleeting draft. Do not use an already-correct or already-permanent card as the primary evidence.
- Prefer the visible card titled "A3错误示例：最短路径误解" or any fleeting draft whose content says "最短路径就是经过边数最少的路径。"
- Open the card library if needed, search/filter for "错误示例", "最短路径误解", or "边数最少", then open the fleeting draft.
- With that incorrect draft open, click "提炼为永久". PASS requires the rejection dialog or equivalent visible result, not a successful promotion.
- The visible evidence should include:
  1. the incorrect example text about shortest path being the fewest edges,
  2. "升级被驳回" or "暂不能升级为永久知识",
  3. quality reasons across clarity/accuracy/necessity or equivalent labels,
  4. a concrete fix suggestion such as adding source evidence, boundary/counterexample, relations, or usage.
- If the only available card is already permanent or already correct, report that as a test-data/product mismatch instead of clicking its promotion control.
"""
    if scene == 17:
        scene_focus_instruction = """

Permanent-card successful-promotion guardrails for Scene 17:
- This scene continues the quality-gate flow. If the app opens in Graph/Dashboard, do not fail early; click "AI 工作台 / WORKSPACE", open the card library, and find the target draft.
- Prefer the fleeting draft titled "A3错误示例：最短路径误解". It is the card that was rejected in Scene 16.
- Open that card and inspect its content. If it already contains the corrected content below, do not retype it; use the visible corrected content as evidence and click "提炼为永久".
- If the card still contains the incorrect one-line claim, switch to the editable/live view if needed, select the whole markdown body, and replace it with the corrected content below. Wait for auto-save or click outside the editor if needed before promoting.
- Corrected content to use:

# A3错误示例：最短路径误解

## 定义
带权图中的最短路径比较的是路径总代价，也就是路径上所有边权之和，不是经过的边数。

## 边界与反例
边数少不一定总代价低。反例：A 到 B 有一条直接边，权重为 100；另一条路线 A 到 C 到 D 到 B 有三条边，每条权重为 10，总代价为 30，所以三条边路径更短。

## 关系与位置
它属于 [[图与最短路径]] 的概念边界，连接到 [[权重与路径]]、[[最短路径]] 和后续 Dijkstra 选择过程。

## 应用
做带权图题目时，先比较路径总代价，再讨论算法选择；无权图中 BFS 的边数最少不能直接套到带权图。

## 依据与必要性
依据来自导入讲义、学生自己的反例解释和掌握评估通过记录。保留这张卡能防止把“最短路径”误解成“边数最少”，删掉它会丢失关键概念边界。

- After the corrected content is saved, click "提炼为永久". PASS requires visible success such as "已沉淀为永久知识卡", card type becoming "永久知识", or recent activity showing the promotion.
- If the promotion is rejected for missing assessment evidence, report it as a test-data mismatch only after confirming the content has been corrected and saved.
"""
    if scene == 20:
        scene_focus_instruction = """

Closing-loop replay guardrails for Scene 20:
- This is a closing replay scene, not a clean first-run setup. Do not fail because the "数据结构" vault already exists or because it is no longer empty.
- The goal is to verify that the completed demo chain has persisted evidence across the product. Use the existing vault state as replay evidence.
- Do not try to rerun all 19 prior scenes. Visit the smallest set of pages needed to collect evidence:
  1. Dashboard for vault/cards/graph growth,
  2. AI 工作台 / card library or current resource panel for misconception card, five resources, multi-agent/resource evidence,
  3. 路径规划 for learning path, assessment, and push suggestions if needed,
  4. 知识图谱 for graph/node/edge results,
  5. 认知洞察 for profile changes and next-step learning state.
- PASS can be based on persisted evidence, including labels, counts, cards, conversation/history snippets, graph stats, resource panels, assessment panels, promotion/rejection logs, push recommendations, and insight/profile observations.
- Required replay evidence should cover the learning problem, not a feature checklist:
  student misconception -> profile/diagnosis -> imported material/path/card -> user explanation -> resources/agents -> assessment -> quality gate -> permanent knowledge/graph -> insight/next step.
- If exact evidence is split across pages, use extract on the current page and summarize where each evidence item was found. Do not mark FAIL merely because the chain is not shown in one single screen.
- Do not call done after only seeing the Dashboard or vault counts. That is an intermediate checkpoint, not a final result.
- Do not call done with text like "I need to continue exploring" or "let me visit other sections"; if more evidence is needed, navigate to the next required page instead.
- Before calling done, you must have evidence from at least three distinct areas among Dashboard, AI 工作台/card library, 路径规划, 知识图谱, and 认知洞察. If you have fewer than three areas, keep navigating.
- Stop once the replay chain is sufficiently proven. Do not create a new vault, delete anything, or restart onboarding.
"""

    return f"""
You are using the official browser-use Agent to run one scene-level test for
AXIOM Space A3.

Start URL: {start_url}
Current scene: Scene {scene:02d}

Use this test identity if registration or login is required. Prefer login when
the account may already exist; register only when login is impossible or the
page clearly indicates no account exists:
- Nickname: {test_name}
- Email: {test_email}
- Password: {test_password}

Operate the live page from browser observations. Do not use a fixed selector
script. Click visible controls, type into visible fields, and re-observe after
each state change.

Navigation guardrails:
- Treat the top bar with labels like "AI 工作台 / WORKSPACE" and "路径规划 / PATH"
  as the main workspace mode navigation.
- In the AI workspace, the slim left activity rail controls the workspace panels.
  If the workspace says "未选择卡片" or no task/card list is visible, click the
  visible rail buttons labeled like "打开路径与会话" or "打开卡片库" before using
  top navigation again.
- When a scene asks for path planning, click the visible main-navigation control
  labeled "路径规划" or "PATH".
- Never click "退出" or "退出登录" unless the current scene explicitly asks to log
  out. If a click would sign out, stop and report it as a navigation mismatch.
- Never click destructive controls unless the current scene explicitly asks for
  deletion or cleanup. Treat labels, titles, aria-labels, menu items, dialogs, or
  buttons containing "删除", "移除", "清空", "归档", "Delete", "Remove", "Clear",
  or "Archive" as destructive. If such a dialog appears, cancel it and report a
  navigation mismatch.
- After submitting login or registration, wait and observe until the workspace,
  vault picker, or a visible auth error appears. Submitting credentials is not
  a scene result.
- Do not call the final done action until you can produce the full final answer
  format below with PASS, PARTIAL, or FAIL evidence.
- When a form has several inputs, use its accessible label. For Scene 04/05,
  type "图与最短路径" into the input labeled "路径主题" or "资料主题". If a
  button labeled "填入图论讲义示例" is visible, click it to fill the material
  field. Otherwise paste the course material into the textarea labeled
  "粘贴资料全文" or "粘贴文献内容".

Scope:
- Test only Scene {scene:02d}. Do not continue into the next scene except when
  the current scene's success state naturally lands there.
- If the app is already past the scene's start state, decide whether the visible
  state can still prove this scene. If not, report the mismatch instead of
  forcing unrelated actions.
- Scene 05 can pass from persisted evidence created by Scene 04: imported
  material/result cards, import progress completion, and the "图与最短路径"
  learning path are valid evidence. Do not search indefinitely for the import
  form if those results are already visible.
- Stop as soon as the scene has PASS/PARTIAL/FAIL evidence.
{scene_focus_instruction}

Final answer format:
1. Status: PASS, PARTIAL, or FAIL.
2. Actions performed.
3. Visible page evidence, quoting exact visible labels/text when possible.
4. Missing evidence compared with the proof standard.
5. Bugs or UX problems found.
6. Whether the next scene is ready to run.
{material_instruction}

SCENE SCRIPT FROM DOCUMENT 09
{scenario_section}

PROOF STANDARD FROM DOCUMENT 08
{proof_sections}
""".strip()


def build_full_task(start_url: str, script_08: Path, script_09: Path) -> str:
    proof_script = script_08.read_text(encoding="utf-8")
    scenario_script = script_09.read_text(encoding="utf-8")

    return f"""
You are using the official browser-use Agent to run a real end-to-end check of
the AXIOM Space A3 demo.

Start URL: {start_url}

Operate the live page from visual/browser observations. Do not use a fixed
selector script. At every important stage, observe the current page, decide the
next click or input from what is visible, and continue in the order described by
the scenario script.

Primary rules:
- Follow script 09 as the user-scene order.
- Use script 08 as the proof checklist and evidence standard.
- Treat the top bar with labels like "AI 工作台 / WORKSPACE" and "路径规划 / PATH"
  as the main workspace mode navigation.
- In the AI workspace, the slim left activity rail controls the workspace panels.
  If the workspace says "未选择卡片" or no task/card list is visible, click the
  visible rail buttons labeled like "打开路径与会话" or "打开卡片库" before using
  top navigation again.
- Never click "退出" or "退出登录" unless the script explicitly asks to log out.
- Never click destructive controls unless the script explicitly asks for deletion
  or cleanup. Treat labels, titles, aria-labels, menu items, dialogs, or buttons
  containing "删除", "移除", "清空", "归档", "Delete", "Remove", "Clear", or
  "Archive" as destructive. If such a dialog appears, cancel it and record the
  mismatch instead of accepting it.
- After submitting login or registration, wait and observe until the workspace,
  vault picker, or a visible auth error appears. Submitting credentials is not
  a completed scene.
- Do not call the final done action until the requested evidence is visible or
  a real blocker is visible.
- Prefer natural user actions: click visible controls, type into visible fields,
  scroll when content is hidden, and recover from UI state changes by observing
  the page again.
- When the page state does not match the script, record what is visible and
  continue only if the next action is still safe.
- Do not leave the local app unless a script explicitly requires it.
- The final answer must summarize completed scenes, blockers, visible bugs, and
  screenshot/history evidence created by browser-use.

SCRIPT 09 - USER SCENE ORDER
{scenario_script}

SCRIPT 08 - PROOF CHECKLIST
{proof_script}
""".strip()


def build_task(
    start_url: str,
    script_08: Path,
    script_09: Path,
    scene: int | None,
    test_name: str,
    test_email: str,
    test_password: str,
) -> str:
    if scene is None:
        return build_full_task(start_url, script_08, script_09)

    if scene < 1 or scene > 20:
        raise ValueError("--scene must be between 1 and 20")

    proof_text = script_08.read_text(encoding="utf-8")
    scenario_text = script_09.read_text(encoding="utf-8")
    scenario_section = extract_scene(scenario_text, scene)
    if not scenario_section:
        raise ValueError(f"Could not extract Scene {scene:02d} from document 09")

    proof_sections = extract_proof_sections(proof_text, scene)
    if not proof_sections:
        raise ValueError(f"Could not extract proof standard for Scene {scene:02d}")

    return build_scene_task(
        start_url=start_url,
        scene=scene,
        scenario_section=scenario_section,
        proof_sections=proof_sections,
        test_name=test_name,
        test_email=test_email,
        test_password=test_password,
    )


def safe_history_value(history: Any, name: str) -> Any:
    try:
        value = getattr(history, name)
        return value() if callable(value) else value
    except Exception as exc:  # noqa: BLE001 - summary should survive history quirks.
        return f"<unavailable: {exc}>"


def parse_args(env: dict[str, str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run A3 with official browser-use instead of a custom runner."
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("A3_BROWSER_USE_URL", "http://localhost:3000"),
        help="Local app URL to open first.",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=int(os.environ.get("A3_BROWSER_USE_MAX_STEPS", "60")),
        help="Maximum Browser Use agent steps.",
    )
    parser.add_argument(
        "--scene",
        type=int,
        default=None,
        help="Run one scene from document 09, from 1 to 20.",
    )
    parser.add_argument(
        "--artifacts",
        type=Path,
        default=ROOT / "test" / "artifacts" / "a3-browser-use",
        help="Directory where history, task text, and media are written.",
    )
    parser.add_argument(
        "--profile-dir",
        type=Path,
        default=DEFAULT_BROWSER_USE_PROFILE,
        help="Browser profile directory used by browser-use.",
    )
    parser.add_argument("--headed", action="store_true", help="Show the browser window.")
    parser.add_argument(
        "--no-vision",
        action="store_true",
        help="Disable screenshot/image input for models that do not support vision.",
    )
    parser.add_argument(
        "--no-gif",
        action="store_true",
        help="Do not ask browser-use to generate a run GIF.",
    )
    parser.add_argument(
        "--record-video",
        action="store_true",
        help="Record MP4 video if browser-use[video] optional dependencies are installed.",
    )
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=960)
    parser.add_argument(
        "--browser-executable",
        type=Path,
        default=None,
        help="Optional local Chromium/Chrome executable for browser-use.",
    )
    parser.add_argument(
        "--model",
        default=(
            os.environ.get("A3_BROWSER_USE_MODEL")
            or os.environ.get("BROWSER_USE_MODEL")
            or "deepseek-chat"
        ),
    )
    parser.add_argument(
        "--base-url",
        default=(
            os.environ.get("A3_BROWSER_USE_BASE_URL")
            or os.environ.get("BROWSER_USE_BASE_URL")
            or env.get("AI_BASE_URL")
            or "https://api.deepseek.com/v1"
        ),
    )
    parser.add_argument(
        "--test-name",
        default=os.environ.get("A3_BROWSER_USE_TEST_NAME", "A3测试用户"),
        help="Nickname for scene tests that need registration.",
    )
    parser.add_argument(
        "--test-email",
        default=os.environ.get("A3_BROWSER_USE_TEST_EMAIL"),
        help="Email for scene tests that need registration.",
    )
    parser.add_argument(
        "--test-password",
        default=os.environ.get("A3_BROWSER_USE_TEST_PASSWORD", "AxiomTest123!"),
        help="Password for scene tests that need registration.",
    )
    parser.add_argument(
        "--skip-auth-setup",
        action="store_true",
        help="Let browser-use handle login/register instead of preparing auth state first.",
    )
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    return parser.parse_args(argv)


async def run() -> int:
    env = load_dotenv(ROOT / ".env")
    args = parse_args(env)

    api_key = (
        os.environ.get("A3_BROWSER_USE_API_KEY")
        or os.environ.get("BROWSER_USE_API_KEY")
        or env.get("AI_API_KEY")
    )
    if not api_key:
        print(
            "Missing API key. Set A3_BROWSER_USE_API_KEY, BROWSER_USE_API_KEY, "
            "or AI_API_KEY in .env.",
            file=sys.stderr,
        )
        return 2

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    run_name = f"scene-{args.scene:02d}-{timestamp}" if args.scene else timestamp
    run_dir = args.artifacts / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = args.profile_dir
    if profile_dir == DEFAULT_BROWSER_USE_PROFILE:
        profile_dir = run_dir / "browser-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    browser_executable = args.browser_executable or find_local_browser()
    test_email = args.test_email or f"a3-browser-use-{timestamp}@example.com"
    storage_state_path = None
    if args.scene and not args.skip_auth_setup:
        storage_state_path = prepare_auth_storage_state(
            start_url=args.url,
            run_dir=run_dir,
            test_name=args.test_name,
            test_email=test_email,
            test_password=args.test_password,
        )

    script_08 = find_doc("08-A3")
    script_09 = find_doc("09-A3")
    task = build_task(
        start_url=args.url,
        script_08=script_08,
        script_09=script_09,
        scene=args.scene,
        test_name=args.test_name,
        test_email=test_email,
        test_password=args.test_password,
    )
    (run_dir / "task.txt").write_text(task, encoding="utf-8")

    base_url = normalize_deepseek_base_url(args.base_url)
    llm = ChatDeepSeek(
        model=args.model,
        api_key=api_key,
        base_url=base_url,
        temperature=0,
        max_tokens=4096,
    )

    viewport = ViewportSize(width=args.width, height=args.height)
    profile_user_data_dir = None if storage_state_path else profile_dir
    profile = BrowserProfile(
        headless=not args.headed,
        viewport=viewport,
        window_size=viewport,
        executable_path=browser_executable,
        storage_state=storage_state_path,
        user_data_dir=profile_user_data_dir,
        downloads_path=run_dir / "downloads",
        traces_dir=run_dir / "traces",
        record_video_dir=run_dir / "video" if args.record_video else None,
        chromium_sandbox=False,
        keep_alive=False,
    )

    print(f"[browser-use] versioned package: official browser-use Agent")
    print(f"[browser-use] url: {args.url}")
    print(f"[browser-use] scene: {args.scene or 'full'}")
    print(f"[browser-use] model: {args.model}")
    print(f"[browser-use] base_url: {base_url}")
    print(f"[browser-use] vision: {not args.no_vision}")
    print(f"[browser-use] browser: {browser_executable or 'browser-use default'}")
    print(f"[browser-use] auth_setup: {storage_state_path or 'browser-driven'}")
    print(f"[browser-use] artifacts: {run_dir}")

    agent = Agent(
        task=task,
        llm=llm,
        browser_profile=profile,
        use_vision=not args.no_vision,
        save_conversation_path=run_dir / "conversation",
        generate_gif=False if args.no_gif else str(run_dir / "run.gif"),
        max_actions_per_step=1,
        use_thinking=False,
        use_judge=False,
        directly_open_url=True,
        source="axiom-space-a3-browser-use",
    )

    history = await agent.run(max_steps=args.max_steps)
    history.save_to_file(run_dir / "history.json")

    summary = {
        "url": args.url,
        "scene": args.scene,
        "model": args.model,
        "base_url": base_url,
        "use_vision": not args.no_vision,
        "max_steps": args.max_steps,
        "script_08": str(script_08.relative_to(ROOT)),
        "script_09": str(script_09.relative_to(ROOT)),
        "test_email": test_email if args.scene else None,
        "auth_setup": str(storage_state_path.relative_to(ROOT)) if storage_state_path else None,
        "number_of_steps": safe_history_value(history, "number_of_steps"),
        "is_done": safe_history_value(history, "is_done"),
        "is_successful": safe_history_value(history, "is_successful"),
        "final_result": safe_history_value(history, "final_result"),
        "errors": safe_history_value(history, "errors"),
        "urls": safe_history_value(history, "urls"),
        "screenshots": safe_history_value(history, "screenshot_paths"),
    }
    (run_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"[browser-use] summary: {run_dir / 'summary.json'}")
    return 0 if summary["is_successful"] is True else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
