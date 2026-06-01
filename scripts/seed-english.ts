import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { syncEdgesFromContent } from '../lib/wiki-links'

const prisma = new PrismaClient()

function randomPastDate(daysBack: number): Date { const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * daysBack)); d.setHours(Math.floor(Math.random() * 24), 0, 0, 0); return d; }

function slugify(text: string): string {
  return text.replace(/[《》()（）,，：、\s]+/g, '').trim()
}
function makePath(cluster: string, title: string): string {
  return `${cluster}/${slugify(title)}.md`
}
function getTags(subject: string, type: string, extra?: string[]): string[] {
  const base = [subject]
  if (type === 'permanent') base.push('core')
  else if (type === 'fleeting') base.push('idea')
  else if (type === 'literature') base.push('reference')
  if (extra) base.push(...extra)
  return base
}

interface CardDef { title: string; content: string; type: 'permanent' | 'fleeting' | 'literature'; tags?: string[] }
interface SubjectDef { name: string; color: string; cards: CardDef[] }
interface EdgeDef { sourceTitle: string; targetTitle: string; type: 'related' | 'prerequisite' | 'derived' | 'counter' }

// ─── Card definitions ─────────────────────────────────────────────────────────

const SUBJECTS: SubjectDef[] = [
  {
    name: '词汇与语法',
    color: '#a855f7',
    cards: [
      { title: '词根词缀记忆法', type: 'permanent', content: '## 词根词缀记忆法\n\n通过分解单词为前缀、词根、后缀来理解和记忆词义的方法。\n\n### 常见前缀\n- un-/in-/im-/dis-：否定（unable, impossible, disagree）\n- re-：再次（review, return, rebuild）\n- pre-：之前（preview, predict, prepare）\n- inter-：之间（international, interact, interview）\n\n### 常见后缀\n- -tion/-sion：名词（education, decision）\n- -ment：名词（development, achievement）\n- -able/-ible：形容词（comfortable, possible）\n- -ly：副词（quickly, carefully）', tags: ['vocabulary', 'method'] },
      { title: '语法时态体系', type: 'permanent', content: '## 英语时态体系\n\n英语共有16种时态，由时间和状态两个维度交叉构成。\n\n### 时间维度: 过去 / 现在 / 将来 / 过去将来\n### 状态维度: 一般 / 进行 / 完成 / 完成进行\n\n### 最常用的8种\n1. 一般现在时 — I study\n2. 一般过去时 — I studied\n3. 一般将来时 — I will study\n4. 现在进行时 — I am studying\n5. 现在完成时 — I have studied\n6. 过去进行时 — I was studying\n7. 过去完成时 — I had studied\n8. 现在完成进行时 — I have been studying', tags: ['grammar', 'core'] },
      { title: '句子成分与五大句型', type: 'permanent', content: '## 句子成分\n\n主语(Subject) + 谓语(Predicate) + 宾语(Object) + 定语(Attribute) + 状语(Adverbial) + 补语(Complement) + 表语(Predicative)\n\n### 五大基本句型\n1. SV: He runs.\n2. SVO: I love you.\n3. SVC: She is kind.\n4. SVOO: He gave me a book.\n5. SVOC: I find it interesting.', tags: ['grammar', 'core'] },
      { title: '非谓语动词', type: 'permanent', content: '## 非谓语动词\n\n三种形式：不定式(to do)、动名词(doing)、分词(doing/done)\n\n### 不定式\n- 功能：主语、宾语、定语、状语、补语\n- To learn English is important.\n\n### 动名词\n- 功能：主语、宾语、表语\n- Swimming is good for health.\n\n### 分词\n- 现在分词 doing（主动/进行）\n- 过去分词 done（被动/完成）\n- The exciting movie / The excited audience', tags: ['grammar', 'core'] },
      { title: '定语从句', type: 'permanent', content: '## 定语从句\n\n关系词：who(人), whom(人,宾格), which(物), that(人/物), whose(人/物,定语)\n\n### 限制性 vs 非限制性\n- 限制性：去掉后句意不完整，无逗号\n- 非限制性：补充说明，有逗号\n\nThe book that I bought is interesting.\nMy brother, who lives in Beijing, is a doctor.', tags: ['grammar', 'core'] },
      { title: '名词性从句', type: 'permanent', content: '## 名词性从句\n\n四种：主语从句、宾语从句、表语从句、同位语从句\n\n- That he passed surprised us.（主语从句）\n- I know that you are right.（宾语从句）\n- The truth is that I was late.（表语从句）\n- The news that he won is exciting.（同位语从句）\n\n注意：that 在名词性从句中不做成分，但不能省略（宾语从句除外）', tags: ['grammar', 'core'] },
      { title: '虚拟语气', type: 'permanent', content: '## 虚拟语气\n\n### 与现在相反\nIf I were you, I would accept.\n\n### 与过去相反\nIf I had known, I would have come.\n\n### 与将来可能相反\nIf it should rain, we would stay.\n\n### 其他用法\n- I wish I knew the answer.\n- I suggest that he go now.\n- He acts as if he were the boss.', tags: ['grammar', 'core'] },
      { title: '被动语态', type: 'permanent', content: '## 被动语态\n\n结构：be + 过去分词 (by ...)\n\n| 时态 | 被动 |\n|------|------|\n| 一般现在 | am/is/are done |\n| 一般过去 | was/were done |\n| 一般将来 | will be done |\n| 现在进行 | am being done |\n| 现在完成 | have been done |\n\nThe experiment was conducted.（科技写作常用）', tags: ['grammar', 'core'] },
      { title: '情态动词', type: 'permanent', content: '## 情态动词\n\ncan(能力/许可), may(可能/许可), must(必须), should(应该), would(意愿), shall(建议)\n\n### 情态动词 + have done\n- must have done — 一定做过\n- might have done — 可能做过\n- could have done — 本来可以做（但没做）\n- should have done — 本来应该做（但没做）\n- needn\'t have done — 本来不必做（但做了）', tags: ['grammar', 'core'] },
      { title: '主谓一致', type: 'permanent', content: '## 主谓一致\n\n### 特殊情况\n- either...or / neither...nor / not only...but also → 就近原则\n- as well as → 随前\n- each/every + n → 单数\n- a number of → 复数 / the number of → 单数\n\nEither you or he is wrong.\nThe teacher, as well as the students, is happy.\nThe number of students is increasing.', tags: ['grammar', 'core'] },
      { title: '强调句与倒装', type: 'permanent', content: '## 强调句与倒装\n\n### 强调句\nIt is/was + 被强调部分 + that/who + 剩余部分\nIt was I that met John yesterday.\n\n### 倒装\n- 完全倒装：Here comes the bus.\n- 部分倒装：Never have I seen such beauty.\n  Only then did I realize the truth.\n  Not until he arrived did we start.', tags: ['grammar', 'advanced'] },
      { title: '连词与从句', type: 'permanent', content: '## 连词\n\n并列连词：and, but, or, for, yet, so\n\n从属连词：\n- 时间：when, while, before, after, since, until\n- 原因：because, since, as, now that\n- 条件：if, unless, provided that, as long as\n- 让步：although, though, even if\n- 目的：so that, in order that\n- 结果：so...that, such...that', tags: ['grammar', 'writing'] },
      { title: '构词法', type: 'permanent', content: '## 构词法\n\n1. 派生法：act → react → reaction\n2. 合成法：class + room = classroom\n3. 转化法：water (n.) → water (v.)\n4. 缩略法：exam = examination', tags: ['vocabulary', 'method'] },
      { title: '介词搭配', type: 'permanent', content: '## 常见介词搭配\n\n动词+介词：depend on, wait for, belong to, suffer from, deal with, agree with\n\n形容词+介词：interested in, good at, afraid of, different from, responsible for\n\n名词+介词：reason for, cause of, advantage of, relationship with', tags: ['vocabulary', 'grammar'] },
      { title: '英语词性分类', type: 'permanent', content: '## 英语词性\n\n1. 名词(n.) — book, student, knowledge\n2. 代词(pron.) — I, you, he, she, it\n3. 动词(v.) — run, study, become\n4. 形容词(adj.) — beautiful, important\n5. 副词(adv.) — quickly, very, always\n6. 介词(prep.) — in, on, at, for\n7. 连词(conj.) — and, but, because\n8. 感叹词(interj.) — oh, wow, alas\n9. 冠词(art.) — a, an, the\n10. 数词(num.) — one, first, hundred', tags: ['grammar', 'basic'] },
      { title: 'affect vs effect', type: 'fleeting', content: 'affect (v.) 影响 — effect (n.) 效果\n记法：affect = Action(动词), effect = End result(名词)', tags: ['vocabulary', 'mistakes'] },
      { title: 'complement vs compliment', type: 'fleeting', content: 'complement 互补 — compliment 赞美\n记法：compliment 中有 I(我)，被人夸奖', tags: ['vocabulary', 'mistakes'] },
      { title: 'principal vs principle', type: 'fleeting', content: 'principal 主要的/校长 — principle 原则\n记法：principal = pal(朋友，校长是你的朋友)', tags: ['vocabulary', 'mistakes'] },
      { title: 'stationary vs stationery', type: 'fleeting', content: 'stationary 静止的 — stationery 文具\n记法：stationery = e = envelope(信封)', tags: ['vocabulary', 'mistakes'] },
      { title: 'accept vs except', type: 'fleeting', content: 'accept (v.) 接受 — except (prep.) 除了\n记法：except = exclude(排除)', tags: ['vocabulary', 'mistakes'] },
      { title: 'lie vs lay', type: 'fleeting', content: 'lie/lay/lain 躺 — lay/laid/laid 放置 — lie/lied/lied 说谎\n最易混的是 lie(躺)的过去式就是 lay', tags: ['vocabulary', 'mistakes'] },
      { title: 'rise vs raise', type: 'fleeting', content: 'rise (vi.,不及物) — raise (vt.,及物)\n太阳升起用 rise，举手用 raise', tags: ['vocabulary', 'mistakes'] },
      { title: 'bring vs take vs fetch', type: 'fleeting', content: 'bring 带来(朝说话者) — take 带走(远离) — fetch 去取来(往返)', tags: ['vocabulary', 'mistakes'] },
      { title: 'say vs tell vs speak vs talk', type: 'fleeting', content: 'say+内容 — tell+人 — speak+语言 — talk+about', tags: ['vocabulary', 'mistakes'] },
      { title: 'used to vs be used to', type: 'fleeting', content: 'used to+do 过去常常 — be used to+doing 习惯于 — be used to+do 被用来做', tags: ['vocabulary', 'grammar'] },
      { title: '不定式 vs 动名词作宾语', type: 'fleeting', content: '只能接不定式：want, hope, expect, decide, refuse, promise\n只能接动名词：enjoy, finish, avoid, mind, suggest, practice\n含义不同：remember doing(记得做过) / remember to do(记得要做)', tags: ['grammar', 'important'] },
      { title: '感官动词', type: 'fleeting', content: 'see/hear/watch + do(全过程) / + doing(正在进行)\n被动语态要加 to：He was seen to cross the street.', tags: ['grammar', 'important'] },
      { title: '反意疑问句', type: 'fleeting', content: '前肯定后否定，前否定后肯定\nLet\'s go, shall we? / I\'m right, aren\'t I?\nNothing is perfect, is it? / Everyone knows, don\'t they?', tags: ['grammar', 'important'] },
      { title: 'as 的多种用法', type: 'fleeting', content: '①作为 ②当...时 ③因为 ④如同 ⑤尽管(倒装) ⑥随着 ⑦比较', tags: ['vocabulary', 'grammar'] },
      { title: '常见不可数名词', type: 'fleeting', content: 'information, advice, knowledge, furniture, equipment, progress, homework, news\n(不能说 a/an，没有复数)', tags: ['vocabulary', 'important'] },
      { title: 'it 作形式主语', type: 'fleeting', content: '形式主语：It is important to study.\n形式宾语：I find it difficult to learn Chinese.', tags: ['grammar', 'important'] },
      { title: 'there be 句型', type: 'fleeting', content: 'There be + 名词 + 地点/时间\n就近原则：be取决于最靠近的名词\n拓展：there seems to be, there used to be, there must be', tags: ['grammar', 'basic'] },
      { title: '比较级与最高级', type: 'fleeting', content: '单音节 -er/-est，多音节 more/most\n不规则：good→better→best, bad→worse→worst, much→more→most', tags: ['grammar', 'basic'] },
      { title: '否定前缀 un-/in-/dis-', type: 'fleeting', content: 'un-最常见：happy→unhappy\nin-变体：impossible, illegal, irregular\ndis-：agree→disagree, appear→disappear', tags: ['vocabulary', 'word-formation'] },
      { title: 'economic vs economical', type: 'fleeting', content: 'economic 经济学的 — economical 节约的\n-ical 后缀常表示有...特性的', tags: ['vocabulary', 'mistakes'] },
      { title: 'sensitive vs sensible', type: 'fleeting', content: 'sensitive (to) 敏感的 — sensible 明智的\nsensible 和 sense(理智)有关', tags: ['vocabulary', 'mistakes'] },
      { title: 'worth vs worthy vs worthwhile', type: 'fleeting', content: 'worth+n/doing — worthy of+n — worthwhile to do\nThe book is worth reading.', tags: ['vocabulary', 'mistakes'] },
      { title: '疑问词+ever', type: 'fleeting', content: 'whatever, whoever, wherever, whenever, however\nWhatever you do, do it well.', tags: ['grammar', 'important'] },
      { title: '省略句', type: 'fleeting', content: '并列省略：I like coffee and she (likes) tea.\n比较省略：He is taller than I (am).\n状语省略：If (it is) possible, let me know.', tags: ['grammar', 'writing'] },
      { title: '插入语', type: 'fleeting', content: '常见：however, therefore, in my opinion, for example, that is\nThe project, however, was a success.', tags: ['grammar', 'writing'] },
      { title: '英文标点差异', type: 'fleeting', content: '句号是 . 不是 。\n列举用 Oxford comma: a, b, and c\n所有格用\'s，中文没有', tags: ['writing', 'basic'] },
      { title: '动词时态呼应', type: 'fleeting', content: '主句过去→从句过去(或过去完成)\n真理永远用一般现在\n虚拟语气不受主句时态影响', tags: ['grammar', 'writing'] },
      { title: '主语从句 It 句型', type: 'fleeting', content: 'It + be + adj + that...\nIt is essential that you practice daily.\nThat 从句作主语时常用 it 代替', tags: ['grammar', 'important'] },
      { title: '双重否定', type: 'fleeting', content: '两个否定等于肯定\nnot impossible = possible\nnot uncommon = common\nIt\'s not uncommon for students to make mistakes.', tags: ['grammar', 'advanced'] },
      { title: '独立主格', type: 'fleeting', content: '名词/代词 + 分词/不定式/介词短语\nThe work done, we went home.\nWeather permitting, we\'ll go out.', tags: ['grammar', 'advanced'] },
      { title: '《英语语法新思维》张满胜', type: 'literature', content: '全套三册，从思维角度理解语法，大量真实例句。适合系统学习。⭐⭐⭐⭐⭐', tags: ['grammar', 'book'] },
      { title: '《Word Power Made Easy》', type: 'literature', content: 'Norman Lewis 经典词汇书。通过词源学习，系统讲解词根词缀。⭐⭐⭐⭐⭐', tags: ['vocabulary', 'book'] },
      { title: '《English Grammar in Use》', type: 'literature', content: 'Raymond Murphy 剑桥语法经典。左页讲解右页练习，145个单元。⭐⭐⭐⭐⭐', tags: ['grammar', 'book'] },
      { title: '《Merriam-Webster Vocabulary Builder》', type: 'literature', content: '按词根分类讲解，每单元包含8个词根和相关词汇。⭐⭐⭐⭐', tags: ['vocabulary', 'book'] },
      { title: 'Anki 间隔重复法', type: 'literature', content: '基于遗忘曲线的主动回忆工具。每天10-20张新卡，打分调复习间隔。⭐⭐⭐⭐⭐', tags: ['vocabulary', 'method', 'tool'] },
      { title: '《英语阅读参考手册》', type: 'literature', content: '叶永昌先生经典之作。以英语关联词和常用词为目，详细讲解语法难点。⭐⭐⭐⭐', tags: ['grammar', 'book'] },
      { title: '《柯林斯语法系列》', type: 'literature', content: 'Cobuild 系列从真实语料库提取例句，描述真实用法。⭐⭐⭐⭐', tags: ['grammar', 'book'] },
      { title: '《The Elements of Style》', type: 'literature', content: 'Strunk & White 写作圣经。简明扼要的英文写作指南。⭐⭐⭐⭐⭐', tags: ['writing', 'book'] },
    ],
  },
  {
    name: '阅读理解',
    color: '#22d3ee',
    cards: [
      { title: '主旨题解题思路', type: 'permanent', content: '## 主旨题\n\n提问：main idea / best title / author\'s purpose\n\n1. 通读首段找主题\n2. 关注每段首句(主题句)\n3. 找转折词后的内容\n4. 排除法：排除过宽或过窄的选项\n\n干扰项特征：以偏概全、过于宽泛、与原文矛盾', tags: ['reading', 'method'] },
      { title: '细节题定位法', type: 'permanent', content: '## 细节题\n\n提问：according to / which is true / the author mentions\n\n1. 关键词定位：专有名词、数字、大写词\n2. 同义替换：正确选项是原文改写\n3. 顺序原则：题目顺序对应文章顺序\n\n含绝对词(all/never)的选项常错\n含模糊词(some/may)的选项更可能对', tags: ['reading', 'method'] },
      { title: '推断题逻辑', type: 'permanent', content: '## 推断题\n\n提问：infer / imply / suggest / conclude\n\n原则：①基于原文 ②只推一步 ③排除绝对选项\n\n错误特征：直接引用原文、与原文矛盾、无中生有、推理过度', tags: ['reading', 'method'] },
      { title: '词义猜测技巧', type: 'permanent', content: '## 词义猜测\n\n上下文线索：\n- 定义：is, means, refers to\n- 同义：or, that is, in other words\n- 反义：but, however, unlike\n- 举例：such as, for example, including\n\n构词法：词根词缀分析\n考试技巧：代入法，把选项依次代入原文', tags: ['reading', 'method'] },
      { title: '长难句分析', type: 'permanent', content: '## 长难句分析\n\n1. 找谓语动词→找到主干\n2. 划掉从句(定语/状语从句)\n3. 找连接词(and/but/or并列)\n4. 确定修饰关系\n\n每天分析3-5个真题长难句', tags: ['reading', 'grammar'] },
      { title: '快速阅读技巧', type: 'permanent', content: '## 快速阅读\n\nSkimming(略读)：读标题、首段、每段首句\nScanning(扫读)：关键词定位，不读全文\n\n提高速度：扩大视幅、减少回读、计时阅读', tags: ['reading', 'method'] },
      { title: '逻辑连接词', type: 'permanent', content: '## 逻辑连接词\n\n因果：because, therefore, consequently\n转折：but, however, nevertheless\n递进：furthermore, moreover, in addition\n举例：for example, for instance, such as\n总结：in conclusion, to sum up, overall', tags: ['reading', 'writing'] },
      { title: '考研阅读六大题型', type: 'permanent', content: '## 考研阅读题型\n\n主旨大意题(15%) — 通读首尾段\n细节理解题(35%) — 关键词定位\n推断判断题(20%) — 基于原文一步推理\n词义猜测题(10%) — 上下文线索\n观点态度题(10%) — 形容词/副词/转折词\n写作目的题(10%) — 识别体裁', tags: ['reading', 'exam'] },
      { title: '段落主题句', type: 'permanent', content: '## 段落主题句\n\n位置：段首(最常见) > 段尾 > 段中\n\n找不到主题句时：\n- 自己总结该段讨论什么\n- 关注 but/however/therefore 后的内容\n- 关注重复出现的词', tags: ['reading', 'method'] },
      { title: '态度题解题', type: 'permanent', content: '## 态度题\n\n正面：positive, supportive, optimistic\n负面：negative, critical, skeptical\n中立：neutral, objective, impartial\n\nindifferent(漠不关心)是常见干扰项\n作者有观点才会写文章', tags: ['reading', 'method'] },
      { title: '考研阅读常见陷阱', type: 'permanent', content: '## 常见陷阱\n\n1. 偷换概念 2. 张冠李戴 3. 因果倒置\n4. 扩大范围 5. 无中生有 6. 答非所问\n\n出题人最爱：同义替换和偷换概念', tags: ['reading', 'exam'] },
      { title: '文章体裁特点', type: 'permanent', content: '## 文章体裁\n\n议论文：观点→论证→结论\n说明文：介绍事物/概念，客观中立\n记叙文：讲故事，时间顺序', tags: ['reading', 'basic'] },
      { title: '英汉思维差异与阅读', type: 'permanent', content: '## 英汉思维差异\n\n英语：直线式思维，先结论后论证\n汉语：螺旋式思维，先铺垫后点题\n\n英语段落通常以 topic sentence 开头\n汉语段落常以铺垫开头', tags: ['reading', 'advanced'] },
      { title: '批判性阅读', type: 'permanent', content: '## 批判性阅读\n\n不仅要理解文章说了什么，还要判断：\n- 作者的立场和偏见\n- 论据是否充分\n- 逻辑是否有漏洞\n- 是否有其他可能性\n\n常问：What is the author\'s agenda?', tags: ['reading', 'advanced'] },
      { title: '阅读笔记方法', type: 'permanent', content: '## 阅读笔记\n\nCornell 法：Notes(记录) + Cues(提示) + Summary(总结)\n\n每篇记录：新词10-15个，好句5-10句，主旨1-2句，个人感想', tags: ['reading', 'method'] },
      { title: '题干信号词速查', type: 'fleeting', content: 'main idea→主旨题, according to→细节题, infer→推断题, means→词义题, attitude→态度题', tags: ['reading', 'exam'] },
      { title: '选项排除速查', type: 'fleeting', content: '绝对化(all/none/never)优先排除，与原文矛盾排除，未提及排除', tags: ['reading', 'method'] },
      { title: '真题三遍法', type: 'fleeting', content: '第一遍模拟考试→第二遍精读分析→第三遍总结复盘', tags: ['reading', 'exam'] },
      { title: '同义替换类型', type: 'fleeting', content: '词性转换、同义词、上下义词、正反转换\n正确选项从不照抄原文', tags: ['reading', 'exam'] },
      { title: '长难句主干提取', type: 'fleeting', content: '找谓语→删掉介词短语→删掉从句→删掉插入语→剩主干', tags: ['reading', 'grammar'] },
      { title: '阅读速度目标', type: 'fleeting', content: '考研70-80wpm, 雅思80-100, 托福100-120, GRE120-150', tags: ['reading', 'method'] },
      { title: '阅读速度训练', type: 'fleeting', content: '指读法、群读法(一次3-5词)、计时阅读、扩大词汇量', tags: ['reading', 'method'] },
      { title: '构词法猜词应用', type: 'fleeting', content: 'spect(看)=inspect/respect/prospect\nport(搬)=export/import/transport\ndict(说)=predict/contradict', tags: ['reading', 'vocabulary'] },
      { title: '考研阅读时间分配', type: 'fleeting', content: '每篇8-10分钟，先读题目标关键词，再读文章定位答案', tags: ['reading', 'exam'] },
      { title: '英语新闻阅读推荐', type: 'fleeting', content: 'The Economist 语言精炼，The Guardian 自由派视角，BBC News 简洁中立', tags: ['reading', 'reference'] },
      { title: '如何读学术论文', type: 'fleeting', content: '先读Abstract→Introduction→Conclusion→再看Results和Discussion', tags: ['reading', 'advanced'] },
      { title: '猜词必杀技', type: 'fleeting', content: '不认识词时：看上下文有没有定义、同义词、反义词、举例。代入法最实用', tags: ['reading', 'method'] },
      { title: 'but 后面的重点', type: 'fleeting', content: '阅读中遇到 but/however/yet，圈起来！后面的内容通常是考点', tags: ['reading', 'exam'] },
      { title: '泛指与特指', type: 'fleeting', content: 'a/an 表泛指(第一次出现)，the 表特指(已提到或双方都知道)\n阅读中注意冠词暗示的信息', tags: ['reading', 'grammar'] },
      { title: '例子与观点的区分', type: 'fleeting', content: 'for example/such as/like 后面是例子\n例子前后通常是观点(考点所在)', tags: ['reading', 'method'] },
    ],
  },
  {
    name: '写作与翻译',
    color: '#f472b6',
    cards: [
      { title: '英语写作结构', type: 'permanent', content: '## 三段式\n\n引言(20%)：背景→引出话题→提出论点\n主体(60%)：论点+论据+例证 × 2-3\n结论(20%)：重申观点→总结要点→升华', tags: ['writing', 'method'] },
      { title: '段落展开方法', type: 'permanent', content: '## 段落展开\n\nTopic Sentence → Supporting Sentences → 总结句\n\n因果展开、举例展开、比较对比展开、递进展开', tags: ['writing', 'method'] },
      { title: '句子多样化', type: 'permanent', content: '## 句子多样化\n\n变换开头：副词/介词短语/分词/不定式\n变换结构：简单句→并列句→复合句\n长短交替：2-3个长句后跟一个短句', tags: ['writing', 'method'] },
      { title: '考研作文模板', type: 'permanent', content: '## 考研作文\n\n大作文：描述图画→分析原因→结论建议\n小作文：写信目的→具体内容→期待回复\n\n模板要灵活，不要生搬硬套', tags: ['writing', 'exam'] },
      { title: '英译汉技巧', type: 'permanent', content: '## 英译汉\n\n1. 词性转换：名词→动词\n2. 语序调整：后置定语→前置\n3. 增词减词：冠词可省\n4. 断句：长句拆短句', tags: ['writing', 'translation'] },
      { title: '汉译英技巧', type: 'permanent', content: '## 汉译英\n\n1. 确定主语(汉语常省略)\n2. 时态判断(根据时间状语)\n3. 关联词显化(汉语隐含逻辑)\n4. 避免中式英语(不逐字翻译)', tags: ['writing', 'translation'] },
      { title: '常见写作错误', type: 'permanent', content: '## 常见错误\n\n1. 句子碎片(Because I was tired.→不完整)\n2. 串句(I like English I study hard.→缺连词)\n3. 主谓不一致(He go→goes)\n4. 悬垂修饰语(Walking home, the rain started.→谁走?)', tags: ['writing', 'mistakes'] },
      { title: '学术写作风格', type: 'permanent', content: '## 学术写作\n\n客观(少用I/you)、准确(用词精确)、正式(避免口语)、逻辑清晰\n\n非正式→正式：get→obtain, a lot of→significant, kids→children, start→commence', tags: ['writing', 'advanced'] },
      { title: '英汉语言差异', type: 'permanent', content: '## 英汉差异\n\n英语形合(靠连接词) vs 汉语意合(靠语义)\n英语静态(用名词) vs 汉语动态(用动词)\n英语多用被动 vs 汉语多用主动\n英语先结论后解释 vs 汉语先铺垫后点题', tags: ['writing', 'translation'] },
      { title: '英语修辞手法', type: 'permanent', content: '## 修辞\n\n明喻(simile): like/as - Life is like a box of chocolates.\n暗喻(metaphor): All the world\'s a stage.\n排比(parallelism): of the people, by the people, for the people', tags: ['writing', 'advanced'] },
      { title: '写作连贯性', type: 'permanent', content: '## 连贯性\n\n指代一致：代词指代明确\n逻辑连接：用适当的连接词\n主题统一：一段只讨论一个主题\n信息顺序：从已知到未知', tags: ['writing', 'method'] },
      { title: '英语段落类型', type: 'permanent', content: '## 段落类型\n\n叙述段：按时间顺序\n描写段：按空间顺序\n说明段：解释概念\n议论段：表达观点\n混合段：多种手法结合', tags: ['writing', 'basic'] },
      { title: '写作开头方式', type: 'permanent', content: '## 开头方式\n\n1. 设问句：Have you ever...?\n2. 数据引述：According to a recent survey...\n3. 名言引用：As the saying goes...\n4. 背景介绍：With the development of...', tags: ['writing', 'method'] },
      { title: '写作结尾方式', type: 'permanent', content: '## 结尾方式\n\n1. 总结式：In conclusion, ...\n2. 建议式：It is high time that ...\n3. 展望式：I am confident that ...\n4. 警示式：If we don\'t ... we will ...', tags: ['writing', 'method'] },
      { title: '英语标点规范', type: 'permanent', content: '## 标点\n\n句号用. 不是。\nOxford comma：I like A, B, and C.\n引号句末标点在引号内。\n所有格用\'s。', tags: ['writing', 'basic'] },
      { title: '作文加分句型', type: 'fleeting', content: 'Only by doing...can we...（倒装强调）\nSo important is...that...（倒装强调）\nIt is...that matters most.（强调句）', tags: ['writing', 'advanced'] },
      { title: '大作文描写句型', type: 'fleeting', content: 'As is vividly shown in the picture,...\nThe chart clearly illustrates that...\nIt is noticeable that...', tags: ['writing', 'exam'] },
      { title: '大作文分析句型', type: 'fleeting', content: 'The phenomenon can be attributed to...\nSeveral factors contribute to this trend.\nFirst and foremost,... Moreover,...', tags: ['writing', 'exam'] },
      { title: '大作文结论句型', type: 'fleeting', content: 'In my opinion, ...\nIt is advisable that ...\nOnly through joint efforts can we ...', tags: ['writing', 'exam'] },
      { title: '小作文书信开头', type: 'fleeting', content: 'I am writing to express my gratitude for...\nI apologize for not being able to...\nI would like to apply for the position of...', tags: ['writing', 'exam'] },
      { title: '小作文书信结尾', type: 'fleeting', content: 'I would appreciate it if you could...\nI look forward to your early reply.\nPlease accept my sincere apologies.', tags: ['writing', 'exam'] },
      { title: '翻译中的被动处理', type: 'fleeting', content: '英语被动→汉语主动\nIt is said that...→据说\nIt must be admitted that...→必须承认', tags: ['writing', 'translation'] },
      { title: '翻译中的定语从句', type: 'fleeting', content: '短定语前置，长定语独立成句\nThe man who is standing there→站在那里的那个人\nI like the book which he wrote→我喜欢他写的那本书', tags: ['writing', 'translation'] },
      { title: '避免中式英语', type: 'fleeting', content: '好好学习→study hard(不是 good good study)\n人山人海→huge crowd(不是 people mountain people sea)\n逐字翻译常见病', tags: ['writing', 'translation'] },
      { title: '英文写作连接词', type: 'fleeting', content: '递进：furthermore, moreover, in addition\n转折：however, nevertheless, on the other hand\n因果：therefore, consequently, as a result', tags: ['writing', 'method'] },
      { title: '雅思写作Task 2结构', type: 'fleeting', content: 'Introduction(背景+观点)→Body1(论点1)→Body2(论点2)→Conclusion(总结)', tags: ['writing', 'exam'] },
      { title: '翻译长句断句法', type: 'fleeting', content: '英语长句先找主干，再分析修饰，最后按汉语习惯重组', tags: ['writing', 'translation'] },
      { title: '写作中的平行结构', type: 'fleeting', content: '并列成分要保持形式一致\n❌ I like reading, to swim, and jogging.\n✅ I like reading, swimming, and jogging.', tags: ['writing', 'method'] },
      { title: '书面语 vs 口语', type: 'fleeting', content: '书面语：正式词汇、完整句式、逻辑连接\n口语：简短句、缩略形式、填补词\n考研写作用书面语', tags: ['writing', 'basic'] },
      { title: '作文自查清单', type: 'fleeting', content: '写完检查：①时态一致吗？②主谓一致吗？③单复数对吗？④拼写对吗？⑤冠词用对了吗？', tags: ['writing', 'method'] },
    ],
  },
  {
    name: '听说口语',
    color: '#818cf8',
    cards: [
      { title: '英语发音基础', type: 'permanent', content: '## 发音基础\n\n元音：长元音/i:/ɑ:/ɔ:/u:/ə:/，短元音/ɪ/ʌ/ɒ/ʊ/ə/e/æ/，双元音8个\n辅音：爆破音6个、摩擦音8个、破擦音6个、鼻音3个、舌侧音、半元音2个\n\n练习要点：听录音跟读、看镜子观察口型、录音对比', tags: ['speaking', 'pronunciation'] },
      { title: '连读与弱读', type: 'permanent', content: '## 连读弱读\n\n辅音+元音：Not at all → No-ta-tall\n元音+元音：Go on → Go-won\nt+y→tʃ：Don\'t you → Donchu\n\n弱读：to→/tə/, for→/fər/, and→/ən/, of→/əv/', tags: ['speaking', 'pronunciation'] },
      { title: '英语语调', type: 'permanent', content: '## 语调\n\n降调(↘)：陈述句、特殊疑问句\n升调(↗)：一般疑问句、不确定的反意疑问句\n\n重音改变含义：\nI didn\'t say he stole the money.\n(重音在不同词上含义不同)', tags: ['speaking', 'pronunciation'] },
      { title: '口语常用句型', type: 'permanent', content: '## 口语句型\n\n表达观点：In my opinion, As far as I\'m concerned, It seems to me that\n\n同意：Absolutely! / You\'re right.\n不同意：I\'m not sure about that.\n\n请求重复：Could you say that again?\n填补停顿：Well, You know, Actually, The thing is', tags: ['speaking', 'conversation'] },
      { title: '精听五步法', type: 'permanent', content: '## 精听五步法\n\n1. 盲听主旨\n2. 逐句听写\n3. 校对原文\n4. 跟读模仿\n5. 再次盲听确认\n\n材料：1-3分钟音频，能听懂70%左右', tags: ['listening', 'method'] },
      { title: '英语思维训练', type: 'permanent', content: '## 英语思维\n\n跳过翻译：看到事物直接联想英语\n\n训练方法：\n1. 自言自语：用英语描述正在做的事\n2. 写日记：每天3-5句\n3. 影子跟读：跟着音频同步朗读\n4. 用英语思考：看到物品想英文名', tags: ['speaking', 'method'] },
      { title: '英语会话技巧', type: 'permanent', content: '## 会话技巧\n\n开启：Hi, nice to meet you. So, what do you think about...?\n维持：Follow-up questions, Showing interest, Adding info\n结束：It was nice talking to you. Let\'s catch up again.', tags: ['speaking', 'conversation'] },
      { title: '英语演讲技巧', type: 'permanent', content: '## 演讲技巧\n\n结构：开场Hook→主题→3个要点→总结→号召行动\n\n技巧：Eye contact / Gesture / Pause / Voice variation / Storytelling', tags: ['speaking', 'presentation'] },
      { title: '听力预测技巧', type: 'permanent', content: '## 听力预测\n\n听前：读题目，预测话题和答案类型\n听中：抓关键词，注意信号词(but, however, first)\n听后：检查拼写和语法', tags: ['listening', 'method'] },
      { title: '英语口音差异', type: 'permanent', content: '## 口音差异\n\n美音：r 卷舌、t→d (writer→rider)、没有\'(英音glottal stop)\n英音：r 不卷舌、t 清晰、语调起伏大\n\n建议：听懂各种口音，但用自己的口音表达', tags: ['speaking', 'pronunciation'] },
      { title: '听力笔记技巧', type: 'permanent', content: '## 听力笔记\n\n记关键词(名词/动词/数字/转折词)\n用符号和缩写(↑↓→√×= ≠ + -)\n不要试图记全，只记关键信息\n\n笔记结构：竖排、缩进、分层', tags: ['listening', 'method'] },
      { title: '雅思口语Part 1', type: 'permanent', content: '## 雅思口语Part 1\n\n日常话题(工作/学习/爱好/家乡)\n每个回答2-3句话，直接回答问题+扩展\n\n结构：直接回答 + 原因/举例/个人经历', tags: ['speaking', 'exam'] },
      { title: '雅思口语Part 2', type: 'permanent', content: '## 雅思口语Part 2\n\n1分钟准备，1-2分钟独白\n\n结构：Introduction→What/When/Where→Why/How→Feeling→Conclusion\n\n记笔记：关键词，不写完整句子', tags: ['speaking', 'exam'] },
      { title: '雅思口语Part 3', type: 'permanent', content: '## 雅思口语Part 3\n\n抽象问题讨论(与Part 2话题相关)\n\n结构：直接回答 + 解释 + 举例 + 对比\n\n常用：Generally speaking, In most cases, For instance, On the other hand', tags: ['speaking', 'exam'] },
      { title: '英语配音学习法', type: 'permanent', content: '## 配音学习法\n\n选喜欢的电影/剧集片段(30秒-1分钟)\n1. 看字幕听懂大意\n2. 逐句跟读模仿语音语调\n3. 同步配音录下来对比\n4. 重复直到与原声一致\n\n推荐：BBC纪录片、迪士尼动画、TED演讲', tags: ['speaking', 'method'] },
      { title: '英语歌曲学英语', type: 'fleeting', content: '通过英语歌学发音和语感。推荐：The Beatles, Taylor Swift, Ed Sheeran\n方法：听→看歌词→跟唱→理解含义', tags: ['listening', 'method'] },
      { title: '播客学习法', type: 'fleeting', content: '推荐播客：BBC 6 Minute English, This American Life, TED Talks Daily\n听完→看文本→查词→跟读', tags: ['listening', 'method'] },
      { title: '美剧学英语', type: 'fleeting', content: '老友记(Friends)经典入门，摩登家庭(Modern Family)日常对话\n方法：先看中字→再看英字→最后无字', tags: ['listening', 'method'] },
      { title: '英语角交流技巧', type: 'fleeting', content: '听不懂就说：Could you please say that again?\n卡壳就说：Let me rephrase that.\n想追问：That\'s interesting! Can you tell me more?', tags: ['speaking', 'conversation'] },
      { title: '口语流利度训练', type: 'fleeting', content: '计时1分钟不间断说英语(任何话题)\n每天3轮，中间不暂停\n目的：训练大脑在压力下输出英语', tags: ['speaking', 'method'] },
      { title: 'th 发音技巧', type: 'fleeting', content: '/θ/轻咬舌尖吹气(thanks, think, math)\n/ð/轻咬舌尖振动(this, that, mother)\n中国人最易发错的两个音', tags: ['speaking', 'pronunciation'] },
      { title: '英语数字听力', type: 'fleeting', content: '13 vs 30（thirTEEN vs THIRty）\n1008读作 one thousand AND eight\n0读作 zero/oh/nil 取决于语境', tags: ['listening', 'basic'] },
      { title: '听力连读检测', type: 'fleeting', content: '常见连读：Not at all, First of all, In an instant\n听不出来是因为连读，不是因为语速快\n专门练习连读辨识', tags: ['listening', 'pronunciation'] },
      { title: '强调语气表达', type: 'fleeting', content: 'I do believe you.（助动词do强调）\nIt is you who I trust.（强调句）\nYou are absolutely right.（副词强调）', tags: ['speaking', 'advanced'] },
      { title: '英语笑话理解', type: 'fleeting', content: '英语笑话常基于：双关语(pun)、文化梗、误解\n听不懂笑话 = 语言或文化理解不到位\n多了解英语文化背景有助理解', tags: ['listening', 'culture'] },
      { title: '雅思听力题型', type: 'fleeting', content: '填空(注意拼写和语法)、选择(同义替换)、匹配(快速预读)、地图(方向感)\n每种题型有自己的解题技巧', tags: ['listening', 'exam'] },
      { title: '托福听力笔记', type: 'fleeting', content: '托福听力是学术场景(讲座/对话)\n重点记：主题、分论点、例证、转折、结论\n只记关键词和信号词后的内容', tags: ['listening', 'exam'] },
      { title: '商务英语口语', type: 'fleeting', content: '会议：I\'d like to start by looking at.../Moving on to the next point...\n谈判：From our perspective.../Could you clarify...\n邮件：Please find attached.../I look forward to hearing from you.', tags: ['speaking', 'business'] },
      { title: '英语面试准备', type: 'fleeting', content: '自我介绍：背景+经验+优势(2分钟内)\n常见问题：Why this job? / What are your strengths? / Weaknesses?\nSTAR法回答：Situation+Task+Action+Result', tags: ['speaking', 'business'] },
      { title: 'TED演讲学习法', type: 'fleeting', content: '选喜欢的TED演讲\n先看一遍中文字幕理解内容\n再看英文字幕学习表达\n最后跟读模仿语音语调\n每周精学一篇', tags: ['listening', 'method'] },
    ],
  },
]

// ─── Edge definitions ──────────────────────────────────────────────────────────

const GRAMMAR_EDGES: EdgeDef[] = [
  // Permanent → Permanent
  { sourceTitle: '词根词缀记忆法', targetTitle: '构词法', type: 'related' },
  { sourceTitle: '语法时态体系', targetTitle: '被动语态', type: 'related' },
  { sourceTitle: '语法时态体系', targetTitle: '虚拟语气', type: 'related' },
  { sourceTitle: '句子成分与五大句型', targetTitle: '定语从句', type: 'prerequisite' },
  { sourceTitle: '句子成分与五大句型', targetTitle: '名词性从句', type: 'prerequisite' },
  { sourceTitle: '句子成分与五大句型', targetTitle: '非谓语动词', type: 'related' },
  { sourceTitle: '非谓语动词', targetTitle: '不定式 vs 动名词作宾语', type: 'derived' },
  { sourceTitle: '定语从句', targetTitle: '名词性从句', type: 'related' },
  { sourceTitle: '连词与从句', targetTitle: '定语从句', type: 'related' },
  { sourceTitle: '连词与从句', targetTitle: '名词性从句', type: 'related' },
  { sourceTitle: '主谓一致', targetTitle: '句子成分与五大句型', type: 'related' },
  { sourceTitle: '被动语态', targetTitle: '语法时态体系', type: 'derived' },
  { sourceTitle: '虚拟语气', targetTitle: '语法时态体系', type: 'related' },
  { sourceTitle: '强调句与倒装', targetTitle: '句子成分与五大句型', type: 'related' },
  { sourceTitle: '英语词性分类', targetTitle: '句子成分与五大句型', type: 'prerequisite' },
  { sourceTitle: '情态动词', targetTitle: '虚拟语气', type: 'related' },
  { sourceTitle: '介词搭配', targetTitle: '英语词性分类', type: 'related' },
  { sourceTitle: '词根词缀记忆法', targetTitle: '否定前缀 un-/in-/dis-', type: 'related' },
  { sourceTitle: '构词法', targetTitle: '词根词缀记忆法', type: 'related' },
  // Permanent → Fleeting
  { sourceTitle: '句子成分与五大句型', targetTitle: 'it 作形式主语', type: 'related' },
  { sourceTitle: '语法时态体系', targetTitle: '动词时态呼应', type: 'related' },
  { sourceTitle: '非谓语动词', targetTitle: '感官动词', type: 'related' },
  { sourceTitle: '定语从句', targetTitle: '翻译中的定语从句', type: 'related' },
  { sourceTitle: '强调句与倒装', targetTitle: '疑问词+ever', type: 'related' },
  { sourceTitle: '强调句与倒装', targetTitle: '双重否定', type: 'related' },
  { sourceTitle: '连词与从句', targetTitle: '省略句', type: 'related' },
  { sourceTitle: '英语词性分类', targetTitle: '常见不可数名词', type: 'related' },
  { sourceTitle: '句子成分与五大句型', targetTitle: '主语从句 It 句型', type: 'related' },
  { sourceTitle: '句子成分与五大句型', targetTitle: '独立主格', type: 'related' },
  { sourceTitle: '词根词缀记忆法', targetTitle: '否定前缀 un-/in-/dis-', type: 'related' },
  { sourceTitle: '英语词性分类', targetTitle: 'there be 句型', type: 'related' },
]

const READING_EDGES: EdgeDef[] = [
  // Permanent → Permanent
  { sourceTitle: '考研阅读六大题型', targetTitle: '主旨题解题思路', type: 'derived' },
  { sourceTitle: '考研阅读六大题型', targetTitle: '细节题定位法', type: 'derived' },
  { sourceTitle: '考研阅读六大题型', targetTitle: '推断题逻辑', type: 'derived' },
  { sourceTitle: '考研阅读六大题型', targetTitle: '词义猜测技巧', type: 'derived' },
  { sourceTitle: '考研阅读六大题型', targetTitle: '态度题解题', type: 'derived' },
  { sourceTitle: '主旨题解题思路', targetTitle: '段落主题句', type: 'related' },
  { sourceTitle: '细节题定位法', targetTitle: '快速阅读技巧', type: 'related' },
  { sourceTitle: '细节题定位法', targetTitle: '同义替换类型', type: 'related' },
  { sourceTitle: '推断题逻辑', targetTitle: '批判性阅读', type: 'related' },
  { sourceTitle: '词义猜测技巧', targetTitle: '长难句分析', type: 'related' },
  { sourceTitle: '长难句分析', targetTitle: '英汉思维差异与阅读', type: 'related' },
  { sourceTitle: '快速阅读技巧', targetTitle: '阅读速度训练', type: 'related' },
  { sourceTitle: '逻辑连接词', targetTitle: '考研阅读常见陷阱', type: 'related' },
  { sourceTitle: '段落主题句', targetTitle: '文章体裁特点', type: 'related' },
  { sourceTitle: '态度题解题', targetTitle: '批判性阅读', type: 'related' },
  { sourceTitle: '考研阅读常见陷阱', targetTitle: '考研阅读六大题型', type: 'related' },
  { sourceTitle: '阅读笔记方法', targetTitle: '精听五步法', type: 'related' },
  // Permanent → Fleeting (reading tips)
  { sourceTitle: '考研阅读常见陷阱', targetTitle: '选项排除速查', type: 'related' },
  { sourceTitle: '考研阅读六大题型', targetTitle: '题干信号词速查', type: 'related' },
  { sourceTitle: '细节题定位法', targetTitle: 'but 后面的重点', type: 'related' },
  { sourceTitle: '词义猜测技巧', targetTitle: '猜词必杀技', type: 'related' },
  { sourceTitle: '长难句分析', targetTitle: '长难句主干提取', type: 'related' },
  { sourceTitle: '考研阅读六大题型', targetTitle: '考研阅读时间分配', type: 'related' },
  { sourceTitle: '词义猜测技巧', targetTitle: '构词法猜词应用', type: 'related' },
  { sourceTitle: '快速阅读技巧', targetTitle: '阅读速度目标', type: 'related' },
  { sourceTitle: '段落主题句', targetTitle: '例子与观点的区分', type: 'related' },
  { sourceTitle: '文章体裁特点', targetTitle: '泛指与特指', type: 'related' },
]

const WRITING_EDGES: EdgeDef[] = [
  // Permanent → Permanent
  { sourceTitle: '英语写作结构', targetTitle: '段落展开方法', type: 'prerequisite' },
  { sourceTitle: '英语写作结构', targetTitle: '句子多样化', type: 'related' },
  { sourceTitle: '英语写作结构', targetTitle: '考研作文模板', type: 'related' },
  { sourceTitle: '段落展开方法', targetTitle: '写作连贯性', type: 'related' },
  { sourceTitle: '句子多样化', targetTitle: '英语修辞手法', type: 'related' },
  { sourceTitle: '英译汉技巧', targetTitle: '汉译英技巧', type: 'related' },
  { sourceTitle: '英译汉技巧', targetTitle: '英汉语言差异', type: 'prerequisite' },
  { sourceTitle: '汉译英技巧', targetTitle: '英汉语言差异', type: 'prerequisite' },
  { sourceTitle: '常见写作错误', targetTitle: '学术写作风格', type: 'related' },
  { sourceTitle: '写作开头方式', targetTitle: '写作结尾方式', type: 'related' },
  { sourceTitle: '英语段落类型', targetTitle: '段落展开方法', type: 'related' },
  // Permanent → Fleeting
  { sourceTitle: '考研作文模板', targetTitle: '大作文描写句型', type: 'related' },
  { sourceTitle: '考研作文模板', targetTitle: '大作文分析句型', type: 'related' },
  { sourceTitle: '考研作文模板', targetTitle: '大作文结论句型', type: 'related' },
  { sourceTitle: '考研作文模板', targetTitle: '小作文书信开头', type: 'related' },
  { sourceTitle: '考研作文模板', targetTitle: '小作文书信结尾', type: 'related' },
  { sourceTitle: '句子多样化', targetTitle: '作文加分句型', type: 'related' },
  { sourceTitle: '英译汉技巧', targetTitle: '翻译中的被动处理', type: 'related' },
  { sourceTitle: '汉译英技巧', targetTitle: '避免中式英语', type: 'related' },
  { sourceTitle: '英译汉技巧', targetTitle: '翻译长句断句法', type: 'related' },
  { sourceTitle: '英汉语言差异', targetTitle: '翻译中的定语从句', type: 'related' },
  { sourceTitle: '英语写作结构', targetTitle: '英文写作连接词', type: 'related' },
  { sourceTitle: '英语写作结构', targetTitle: '雅思写作Task 2结构', type: 'related' },
  { sourceTitle: '写作连贯性', targetTitle: '写作中的平行结构', type: 'related' },
  { sourceTitle: '英语段落类型', targetTitle: '书面语 vs 口语', type: 'related' },
  { sourceTitle: '常见写作错误', targetTitle: '作文自查清单', type: 'related' },
]

const SPEAKING_EDGES: EdgeDef[] = [
  // Permanent → Permanent
  { sourceTitle: '英语发音基础', targetTitle: '连读与弱读', type: 'prerequisite' },
  { sourceTitle: '英语发音基础', targetTitle: '英语语调', type: 'prerequisite' },
  { sourceTitle: '英语发音基础', targetTitle: '英语口音差异', type: 'related' },
  { sourceTitle: '连读与弱读', targetTitle: '英语语调', type: 'related' },
  { sourceTitle: '口语常用句型', targetTitle: '英语会话技巧', type: 'related' },
  { sourceTitle: '精听五步法', targetTitle: '听力预测技巧', type: 'related' },
  { sourceTitle: '精听五步法', targetTitle: '听力笔记技巧', type: 'related' },
  { sourceTitle: '英语思维训练', targetTitle: '口语流利度训练', type: 'related' },
  { sourceTitle: '英语会话技巧', targetTitle: '英语演讲技巧', type: 'related' },
  { sourceTitle: '雅思口语Part 1', targetTitle: '雅思口语Part 2', type: 'related' },
  { sourceTitle: '雅思口语Part 2', targetTitle: '雅思口语Part 3', type: 'related' },
  // Permanent → Fleeting
  { sourceTitle: '英语发音基础', targetTitle: 'th 发音技巧', type: 'related' },
  { sourceTitle: '连读与弱读', targetTitle: '听力连读检测', type: 'related' },
  { sourceTitle: '精听五步法', targetTitle: '播客学习法', type: 'related' },
  { sourceTitle: '精听五步法', targetTitle: '美剧学英语', type: 'related' },
  { sourceTitle: '精听五步法', targetTitle: 'TED演讲学习法', type: 'related' },
  { sourceTitle: '英语思维训练', targetTitle: '英语歌曲学英语', type: 'related' },
  { sourceTitle: '英语会话技巧', targetTitle: '英语角交流技巧', type: 'related' },
  { sourceTitle: '英语演讲技巧', targetTitle: '强调语气表达', type: 'related' },
  { sourceTitle: '听力笔记技巧', targetTitle: '托福听力笔记', type: 'related' },
  { sourceTitle: '雅思口语Part 1', targetTitle: '英语面试准备', type: 'related' },
  { sourceTitle: '英语会话技巧', targetTitle: '商务英语口语', type: 'related' },
  { sourceTitle: '雅思听力题型', targetTitle: '听力预测技巧', type: 'related' },
  { sourceTitle: '英语口音差异', targetTitle: '英语笑话理解', type: 'related' },
]

// Cross-cluster edges
const CROSS_EN_EDGES: EdgeDef[] = [
  // Grammar → Reading
  { sourceTitle: '长难句分析', targetTitle: '句子成分与五大句型', type: 'related' },
  { sourceTitle: '词义猜测技巧', targetTitle: '词根词缀记忆法', type: 'related' },
  { sourceTitle: '逻辑连接词', targetTitle: '连词与从句', type: 'related' },
  // Grammar → Writing
  { sourceTitle: '英语写作结构', targetTitle: '连词与从句', type: 'related' },
  { sourceTitle: '句子多样化', targetTitle: '强调句与倒装', type: 'related' },
  { sourceTitle: '考研作文模板', targetTitle: '主谓一致', type: 'related' },
  // Reading → Writing
  { sourceTitle: '逻辑连接词', targetTitle: '英文写作连接词', type: 'related' },
  { sourceTitle: '长难句分析', targetTitle: '翻译长句断句法', type: 'related' },
  { sourceTitle: '英汉思维差异与阅读', targetTitle: '英汉语言差异', type: 'related' },
  // Speaking ↔ Listening ↔ Others
  { sourceTitle: '精听五步法', targetTitle: '英语发音基础', type: 'related' },
  { sourceTitle: '听力连读检测', targetTitle: '连读与弱读', type: 'related' },
  { sourceTitle: '英语配音学习法', targetTitle: '英语语调', type: 'related' },
  { sourceTitle: '口语常用句型', targetTitle: '英语写作结构', type: 'related' },
  { sourceTitle: '英语思维训练', targetTitle: '英汉语言差异', type: 'related' },
]

// Build related-titles map from edges
function buildRelatedMap(): Map<string, string[]> {
  const map = new Map<string, Set<string>>()
  const allEdges = [...GRAMMAR_EDGES, ...READING_EDGES, ...WRITING_EDGES, ...SPEAKING_EDGES, ...CROSS_EN_EDGES]
  for (const e of allEdges) {
    if (!map.has(e.sourceTitle)) map.set(e.sourceTitle, new Set())
    map.get(e.sourceTitle)!.add(e.targetTitle)
  }
  const result = new Map<string, string[]>()
  for (const [k, v] of map) result.set(k, Array.from(v))
  return result
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== English Learning Seed (WikiLink) ===\n')

  let user = await prisma.user.findUnique({ where: { email: 'morewhy.han@gmail.com' } })
  if (!user) {
    user = await prisma.user.create({ data: { email: 'morewhy.han@gmail.com', name: 'han' } })
  }
  console.log(`[1/5] User: ${user.email}`)

  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  })
  if (!existingAccount) {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.email,
        providerId: 'credential',
        password: await hashPassword('demo123456'),
      },
    })
    console.log(`  Account record created (password: demo123456)`)
  }

  const existing = await prisma.vault.findFirst({ where: { userId: user.id, name: '英语学习' } })
  let vault = existing
  if (!vault) {
    vault = await prisma.vault.create({ data: { userId: user.id, name: '英语学习' } })
    console.log(`[2/5] Created vault: 英语学习`)
  } else {
    console.log(`[2/5] Using existing vault: 英语学习`)
  }

  // Clean existing data
  await prisma.edge.deleteMany({ where: { vaultId: vault.id } })
  await prisma.card.deleteMany({ where: { vaultId: vault.id } })
  await prisma.cluster.deleteMany({ where: { vaultId: vault.id } })
  console.log('[3/5] Cleaned existing data')

  console.log('[4/5] Creating clusters and cards with WikiLink content...')
  const clusterMap = new Map<string, string>()
  const cardMap = new Map<string, string>() // title → cardId
  const relatedMap = buildRelatedMap()
  let totalCards = 0

  for (const subject of SUBJECTS) {
    const cluster = await prisma.cluster.create({
      data: { vaultId: vault.id, name: subject.name, color: subject.color, position: SUBJECTS.indexOf(subject) },
    })
    clusterMap.set(subject.name, cluster.id)

    const perms = subject.cards.filter(c => c.type === 'permanent')
    const fleets = subject.cards.filter(c => c.type === 'fleeting')
    const lits = subject.cards.filter(c => c.type === 'literature')
    const all = [...perms, ...fleets, ...lits]

    for (const card of all) {
      // Append WikiLinks to existing content if this card has outgoing edges
      const related = relatedMap.get(card.title)
      let content = card.content
      if (related && related.length > 0) {
        content += '\n\n**See also:** ' + related.map(t => `[[${t}]]`).join(', ')
      }

      const created = await prisma.card.create({
        data: {
          vaultId: vault.id, clusterId: cluster.id,
          path: makePath(subject.name, card.title),
          content, type: card.type, title: card.title,
          tags: JSON.stringify(getTags(subject.name, card.type, card.tags)),
          createdAt: randomPastDate(30),
        },
      })
      cardMap.set(card.title, created.id)
      totalCards++
    }
    console.log(`  ${subject.name}: ${perms.length}P + ${fleets.length}F + ${lits.length}L = ${all.length} cards`)
  }

  console.log('[5/5] Syncing edges from WikiLink content...')

  const allCards = await prisma.card.findMany({
    where: { vaultId: vault.id },
    select: { id: true, vaultId: true, content: true, title: true },
  })
  const cardsWithLinks = allCards.filter(c => c.content.includes('[['))
  console.log(`  Cards with [[WikiLink]]: ${cardsWithLinks.length} / ${allCards.length}`)

  const CONCURRENCY = 10
  let syncedCount = 0
  for (let i = 0; i < cardsWithLinks.length; i += CONCURRENCY) {
    const batch = cardsWithLinks.slice(i, i + CONCURRENCY)
    await Promise.allSettled(
      batch.map(c => syncEdgesFromContent(prisma, c.id, c.vaultId, c.content))
    )
    syncedCount += batch.length
    process.stdout.write(`  ⠋ Syncing: ${syncedCount}/${cardsWithLinks.length}\r`)
  }
  console.log(`\n  Edges: ${syncedCount} cards synced`)

  const dbEdgeCount = await prisma.edge.count({ where: { vaultId: vault.id } })
  console.log(`\n=== Seed Complete ===`)
  console.log(`  Clusters: ${clusterMap.size}`)
  console.log(`  Cards:    ${totalCards}`)
  console.log(`  Edges:    ${dbEdgeCount} (auto-generated from [[WikiLink]])`)
  const dc = await prisma.card.count({ where: { vaultId: vault.id } })
  const de = await prisma.edge.count({ where: { vaultId: vault.id } })
  console.log(`  (DB verify) Cards: ${dc}, Edges: ${de}`)
}

main().catch(e => { console.error('Failed:', e); process.exit(1) }).finally(() => prisma.$disconnect())
