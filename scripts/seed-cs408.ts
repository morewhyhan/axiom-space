import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { syncEdgesFromContent } from '../lib/wiki-links'

const prisma = new PrismaClient()

// 鈹€鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function randomPastDate(daysBack: number): Date { const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * daysBack)); d.setHours(Math.floor(Math.random() * 24), 0, 0, 0); return d; }

function slugify(text: string): string {
  return text.replace(/[銆娿€?)锛堬級,锛岋細銆乗s]+/g, '').trim()
}

function makePath(clusterName: string, cardTitle: string): string {
  return `${clusterName}/${slugify(cardTitle)}.md`
}

function getTags(subject: string, cardType: string, extra?: string[]): string[] {
  const base: string[] = [subject]
  if (cardType === 'permanent') base.push('core')
  else if (cardType === 'fleeting') base.push('idea')
  else if (cardType === 'literature') base.push('reference')
  if (extra) base.push(...extra)
  return base
}

// 鈹€鈹€鈹€ Card & Subject Type Definitions 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface CardDef {
  title: string
  tags?: string[]
}

interface SubjectDef {
  name: string
  color: string
  permanent: CardDef[]
  fleeting: CardDef[]
  literature: CardDef[]
}

interface EdgeDef {
  sourceSubject: string
  sourceTitle: string
  targetSubject: string
  targetTitle: string
  type: 'related' | 'prerequisite' | 'derived' | 'counter'
}

// 鈹€鈹€鈹€ 鏁版嵁缁撴瀯 (Data Structures) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const subjectDS: SubjectDef = {
  name: '鏁版嵁缁撴瀯',
  color: '#a855f7',
  permanent: [
    { title: '绾挎€ц〃', tags: ['linear-list'] },
    { title: '鏍?, tags: ['stack'] },
    { title: '闃熷垪', tags: ['queue'] },
    { title: '鏍?, tags: ['tree'] },
    { title: '浜屽弶鏍?, tags: ['binary-tree'] },
    { title: '鍥?, tags: ['graph'] },
    { title: '鎺掑簭绠楁硶', tags: ['sorting'] },
    { title: '鏌ユ壘绠楁硶', tags: ['searching'] },
    { title: '鍝堝笇琛?, tags: ['hash-table'] },
    { title: '鍫?, tags: ['heap'] },
    { title: '骞舵煡闆?, tags: ['union-find'] },
    { title: '骞宠　浜屽弶鏍?, tags: ['balanced-tree', 'avl'] },
    { title: 'B鏍?, tags: ['b-tree'] },
    { title: '鍏抽敭璺緞', tags: ['critical-path'] },
    { title: '鏈€鐭矾寰?, tags: ['shortest-path'] },
  ],
  fleeting: [
    { title: '鏍堜笌閫掑綊鐨勫叧绯? },
    { title: '寰幆闃熷垪瀹炵幇' },
    { title: '浜屽弶鏍戠殑閬嶅巻椤哄簭' },
    { title: '鍥剧殑閭绘帴鐭╅樀vs閭绘帴琛? },
    { title: '蹇€熸帓搴忔渶鍧忔儏鍐? },
    { title: '鍝堝笇鍐茬獊瑙ｅ喅' },
    { title: 'B鏍戜笌B+鏍戝尯鍒? },
    { title: 'KMP绠楁硶鎬濇兂' },
    { title: 'Prim绠楁硶涓嶬ruskal绠楁硶瀵规瘮' },
    { title: '鍔ㄦ€佽鍒抳s璐績绠楁硶' },
    { title: '鏍堢殑搴旂敤鍦烘櫙' },
    { title: '闃熷垪鐨勫簲鐢ㄥ満鏅? },
    { title: '閾捐〃鐨勬彃鍏ュ垹闄ゆ搷浣? },
    { title: '鍙屽悜閾捐〃涓庡惊鐜摼琛? },
    { title: '绋€鐤忕煩闃靛瓨鍌? },
    { title: '骞夸箟琛ㄧ粨鏋? },
    { title: '浜屽弶鏍戜笌妫灄杞崲' },
    { title: 'Huffman缂栫爜' },
    { title: 'AVL鏍戞棆杞搷浣? },
    { title: '绾㈤粦鏍戞€ц川' },
    { title: '鍥剧殑娣卞害浼樺厛涓庡箍搴︿紭鍏? },
    { title: '鎷撴墤鎺掑簭瀹炵幇' },
    { title: '鏈€灏忕敓鎴愭爲绠楁硶瀵规瘮' },
    { title: 'Dijkstra绠楁硶鍘熺悊' },
    { title: 'Floyd绠楁硶鍘熺悊' },
    { title: '褰掑苟鎺掑簭杩囩▼' },
    { title: '鍩烘暟鎺掑簭鎬濇兂' },
    { title: '澶栭儴鎺掑簭涓庡璺綊骞? },
    { title: '浜屽垎鏌ユ壘鍐崇瓥鏍? },
    { title: '鏁ｅ垪鍑芥暟璁捐' },
    { title: '瀛楃涓插尮閰嶇畻娉? },
    { title: '澶ф暟鎹甌opK闂' },
    { title: '鎺掑簭绠楁硶绋冲畾鎬у姣? },
    { title: '鏃堕棿澶嶆潅搴︾殑娓愯繘鍒嗘瀽' },
    { title: '閫掑綊绠楁硶鐨勮绠楁ā鍨? },
  ],
  literature: [
    { title: '涓ヨ敋鏁忋€婃暟鎹粨鏋勩€?, tags: ['textbook'] },
    { title: '閭撲繆杈夈€婃暟鎹粨鏋勪笌绠楁硶銆?, tags: ['textbook'] },
    { title: '銆婄畻娉曞璁恒€?, tags: ['textbook'] },
    { title: '銆婂ぇ璇濇暟鎹粨鏋勩€?, tags: ['textbook'] },
    { title: '鐜嬮亾408鏁版嵁缁撴瀯绡?, tags: ['exam-guide'] },
    { title: '澶╁嫟鏁版嵁缁撴瀯楂樺垎绗旇', tags: ['exam-guide'] },
    { title: 'LeetCode HOT100', tags: ['practice'] },
    { title: '銆婃暟鎹粨鏋勪笌绠楁硶鍒嗘瀽銆?, tags: ['textbook'] },
  ],
}

// 鈹€鈹€鈹€ 璁＄畻鏈虹粍鎴愬師鐞?(Computer Organization) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const subjectCO: SubjectDef = {
  name: '璁＄畻鏈虹粍鎴愬師鐞?,
  color: '#22d3ee',
  permanent: [
    { title: '鍐渚濇浖缁撴瀯', tags: ['von-neumann'] },
    { title: '鏁版嵁琛ㄧず', tags: ['data-representation'] },
    { title: '杩愮畻鏂规硶涓嶢LU', tags: ['alu'] },
    { title: '瀛樺偍鍣ㄥ眰娆?, tags: ['memory-hierarchy'] },
    { title: 'Cache', tags: ['cache'] },
    { title: '鎸囦护绯荤粺', tags: ['instruction-set'] },
    { title: 'CPU娴佹按绾?, tags: ['pipeline'] },
    { title: '鎺у埗鍗曞厓', tags: ['control-unit'] },
    { title: '鎬荤嚎绯荤粺', tags: ['bus'] },
    { title: '杈撳叆杈撳嚭绯荤粺', tags: ['io-system'] },
    { title: '涓柇绯荤粺', tags: ['interrupt'] },
    { title: 'DMA', tags: ['dma'] },
    { title: '铏氭嫙瀛樺偍鍣?, tags: ['virtual-memory'] },
    { title: '娴偣杩愮畻', tags: ['floating-point'] },
    { title: '鎸囦护娴佹按绾垮啋闄?, tags: ['pipeline-hazard'] },
  ],
  fleeting: [
    { title: '鍘熺爜鍙嶇爜琛ョ爜杞崲' },
    { title: 'IEEE754娴偣鏍囧噯' },
    { title: 'Cache鏄犲皠鏂瑰紡' },
    { title: '娴佹按绾垮啿绐佺被鍨? },
    { title: '涓柇澶勭悊娴佺▼' },
    { title: 'DMA涓庣▼搴忎腑鏂姣? },
    { title: '鎬荤嚎浠茶鏂瑰紡' },
    { title: 'RAID绛夌骇鍖哄埆' },
    { title: '姹夋槑鐮佹閿? },
    { title: '椤靛紡铏氭嫙瀛樺偍鍣ㄥ湴鍧€杞崲' },
    { title: '寰▼搴忔帶鍒朵笌纭竷绾挎帶鍒? },
    { title: '鎸囦护鍛ㄦ湡涓庢満鍣ㄥ懆鏈? },
    { title: '鏁版嵁瀵诲潃鏂瑰紡' },
    { title: 'CISC涓嶳ISC瀵规瘮' },
    { title: 'MIPS鎸囦护鏍煎紡' },
    { title: '涔樻硶杩愮畻鐨勭‖浠跺疄鐜? },
    { title: 'Booth绠楁硶' },
    { title: '娴偣鍔犲噺杩愮畻姝ラ' },
    { title: '瀛樺偍鍣ㄧ殑鎵╁睍鎶€鏈? },
    { title: 'Cache鍐欑瓥鐣? },
    { title: '澶氫綋浜ゅ弶瀛樺偍鍣? },
    { title: '娴佹按绾挎€ц兘鎸囨爣' },
    { title: '鏁版嵁鍐掗櫓涓庤浆鍙戞妧鏈? },
    { title: '鎺у埗鍐掗櫓涓庡垎鏀娴? },
    { title: '寮傚父涓庝腑鏂殑鍖哄埆' },
    { title: '涓柇浼樺厛绾т笌灞忚斀' },
    { title: '閫氶亾鎺у埗鏂瑰紡' },
    { title: 'IO鎺ュ彛鐨勫姛鑳戒笌缁撴瀯' },
    { title: '鎬荤嚎鏍囧噯涓庢帴鍙? },
    { title: 'USB鍗忚姒傝堪' },
    { title: 'PCIe鎬荤嚎' },
    { title: '纾佺洏瀛樺偍鍣ㄧ粨鏋? },
    { title: '鍥烘€佺‖鐩楽SD鎶€鏈? },
    { title: '璁＄畻鏈烘€ц兘璇勪环鎸囨爣' },
    { title: 'Amdahl瀹氬緥' },
  ],
  literature: [
    { title: '鍞愭湐椋炪€婅绠楁満缁勬垚鍘熺悊銆?, tags: ['textbook'] },
    { title: '琚佹槬椋庛€婅绠楁満缁勬垚涓庤璁°€?, tags: ['textbook'] },
    { title: 'Patterson銆婅绠楁満缁勬垚涓庤璁°€?, tags: ['textbook'] },
    { title: '鐜嬮亾408璁＄粍绡?, tags: ['exam-guide'] },
    { title: '澶╁嫟璁＄粍楂樺垎绗旇', tags: ['exam-guide'] },
    { title: 'Stallings銆婅绠楁満缁勬垚涓庝綋绯荤粨鏋勩€?, tags: ['textbook'] },
    { title: '銆婃暟瀛楄璁″拰璁＄畻鏈轰綋绯荤粨鏋勩€?, tags: ['textbook'] },
    { title: '銆婅绠楁満浣撶郴缁撴瀯閲忓寲鏂规硶銆?, tags: ['textbook'] },
  ],
}

// 鈹€鈹€鈹€ 鎿嶄綔绯荤粺 (Operating Systems) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const subjectOS: SubjectDef = {
  name: '鎿嶄綔绯荤粺',
  color: '#f472b6',
  permanent: [
    { title: '杩涚▼涓庣嚎绋?, tags: ['process-thread'] },
    { title: '杩涚▼璋冨害', tags: ['scheduling'] },
    { title: '鍚屾涓庝簰鏂?, tags: ['synchronization'] },
    { title: '姝婚攣', tags: ['deadlock'] },
    { title: '鍐呭瓨绠＄悊', tags: ['memory-management'] },
    { title: '鍒嗛〉涓庡垎娈?, tags: ['paging-segmentation'] },
    { title: '铏氭嫙鍐呭瓨', tags: ['virtual-memory'] },
    { title: '鏂囦欢绯荤粺', tags: ['file-system'] },
    { title: '璁惧绠＄悊', tags: ['device-management'] },
    { title: '纾佺洏璋冨害', tags: ['disk-scheduling'] },
    { title: 'IO绠＄悊', tags: ['io-management'] },
    { title: '杩涚▼閫氫俊', tags: ['ipc'] },
    { title: '淇″彿閲忔満鍒?, tags: ['semaphore'] },
    { title: '绠＄▼', tags: ['monitor'] },
    { title: '椤甸潰缃崲绠楁硶', tags: ['page-replacement'] },
  ],
  fleeting: [
    { title: 'PCB涓嶵CB鍖哄埆' },
    { title: '璋冨害绠楁硶姣旇緝' },
    { title: '鐢熶骇鑰呮秷璐硅€呴棶棰? },
    { title: '璇昏€呭啓鑰呴棶棰? },
    { title: '鍝插瀹跺氨椁愰棶棰? },
    { title: '姝婚攣蹇呰鏉′欢' },
    { title: '閾惰瀹剁畻娉? },
    { title: '娈甸〉寮忓瓨鍌? },
    { title: 'LRU涓嶭FU鍖哄埆' },
    { title: '纾佺洏璋冨害绠楁硶姣旇緝' },
    { title: '鐢ㄦ埛鎬佷笌鏍稿績鎬佸垏鎹? },
    { title: '绯荤粺璋冪敤瀹炵幇' },
    { title: '杩涚▼鐘舵€佽浆鎹? },
    { title: '绾跨▼鐨勫疄鐜版ā鍨? },
    { title: '鍗忕▼涓庣嚎绋嬪姣? },
    { title: '浜掓枼閿佷笌鑷棆閿? },
    { title: '璇诲啓閿佸疄鐜? },
    { title: '鏉′欢鍙橀噺涓庝俊鍙烽噺' },
    { title: '姝婚攣妫€娴嬩笌鎭㈠' },
    { title: '鍐呭瓨鍒嗛厤绠楁硶瀵规瘮' },
    { title: '蹇〃TLB鍘熺悊' },
    { title: '澶氱骇椤佃〃' },
    { title: '缂洪〉涓柇澶勭悊' },
    { title: '椤甸潰鍒嗛厤绛栫暐' },
    { title: '鏂囦欢鍒嗛厤鏂瑰紡瀵规瘮' },
    { title: '鐩綍缁撴瀯瀹炵幇' },
    { title: '绌洪棽绌洪棿绠＄悊' },
    { title: '纾佺洏璋冨害FCFS涓嶴CAN' },
    { title: 'SPOOLing绯荤粺' },
    { title: '缂撳啿鎶€鏈? },
    { title: '璁惧椹卞姩绋嬪簭鎺ュ彛' },
    { title: '鍏变韩鏂囦欢涓庨摼鎺? },
    { title: '鏂囦欢淇濇姢鏈哄埗' },
    { title: '鏃ュ織鏂囦欢绯荤粺' },
    { title: '瀹炴椂鎿嶄綔绯荤粺鐗圭偣' },
  ],
  literature: [
    { title: '姹ゅ瓙鐎涖€婅绠楁満鎿嶄綔绯荤粺銆?, tags: ['textbook'] },
    { title: '鐜嬮亾408鎿嶄綔绯荤粺绡?, tags: ['exam-guide'] },
    { title: '澶╁嫟鎿嶄綔绯荤粺楂樺垎绗旇', tags: ['exam-guide'] },
    { title: '銆婄幇浠ｆ搷浣滅郴缁熴€?, tags: ['textbook'] },
    { title: '銆婃繁鍏ョ悊瑙inux鍐呮牳銆?, tags: ['textbook'] },
    { title: '銆婃搷浣滅郴缁熸蹇点€?, tags: ['textbook'] },
    { title: '銆奓inux鍐呮牳璁捐涓庡疄鐜般€?, tags: ['textbook'] },
    { title: '銆婃搷浣滅郴缁熺湡璞¤繕鍘熴€?, tags: ['textbook'] },
  ],
}

// 鈹€鈹€鈹€ 璁＄畻鏈虹綉缁?(Computer Networks) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const subjectCN: SubjectDef = {
  name: '璁＄畻鏈虹綉缁?,
  color: '#818cf8',
  permanent: [
    { title: 'OSI涓冨眰妯″瀷', tags: ['osi'] },
    { title: 'TCP/IP鍗忚鏍?, tags: ['tcp-ip'] },
    { title: '鐗╃悊灞?, tags: ['physical-layer'] },
    { title: '鏁版嵁閾捐矾灞?, tags: ['data-link-layer'] },
    { title: '缃戠粶灞?, tags: ['network-layer'] },
    { title: '浼犺緭灞?, tags: ['transport-layer'] },
    { title: '搴旂敤灞?, tags: ['application-layer'] },
    { title: 'TCP鍙潬浼犺緭', tags: ['tcp-reliability'] },
    { title: 'IP鍗忚', tags: ['ip-protocol'] },
    { title: '璺敱绠楁硶', tags: ['routing'] },
    { title: '灞€鍩熺綉鎶€鏈?, tags: ['lan'] },
    { title: '缃戠粶瀹夊叏', tags: ['security'] },
    { title: 'HTTP鍗忚', tags: ['http'] },
    { title: 'DNS绯荤粺', tags: ['dns'] },
    { title: '鎷ュ鎺у埗', tags: ['congestion-control'] },
  ],
  fleeting: [
    { title: '涓夋鎻℃墜鍥涙鎸ユ墜' },
    { title: 'TCP涓嶶DP鍖哄埆' },
    { title: '婊戝姩绐楀彛鏈哄埗' },
    { title: '鎷ュ鎺у埗绠楁硶' },
    { title: 'ARP鍗忚宸ヤ綔娴佺▼' },
    { title: 'DHCP鍘熺悊' },
    { title: '瀛愮綉鍒掑垎' },
    { title: 'CIDR琛ㄧず娉? },
    { title: 'NAT杞崲' },
    { title: '璺敱閫夋嫨鍗忚瀵规瘮' },
    { title: '淇￠亾澶嶇敤鎶€鏈? },
    { title: '缂栫爜涓庤皟鍒? },
    { title: '浼犺緭浠嬭川鍒嗙被' },
    { title: 'CSMA/CD鍗忚' },
    { title: '浠ュお缃戝抚缁撴瀯' },
    { title: '浜ゆ崲鏈轰笌闆嗙嚎鍣ㄥ尯鍒? },
    { title: 'VLAN鎶€鏈? },
    { title: '鐢熸垚鏍戝崗璁? },
    { title: 'IP鏁版嵁鎶ユ牸寮? },
    { title: '鍒嗙墖涓庨噸缁? },
    { title: 'IPv6鍗忚' },
    { title: 'ICMP鍗忚搴旂敤' },
    { title: '闅ч亾鎶€鏈? },
    { title: '绔彛鍙峰垎閰? },
    { title: '娴侀噺鎺у埗涓庢嫢濉炴帶鍒跺尯鍒? },
    { title: '瓒呮椂閲嶄紶涓庡揩閫熼噸浼? },
    { title: '閫夋嫨鎬х‘璁ACK' },
    { title: '杩炴帴绠＄悊鐘舵€佽浆鎹? },
    { title: 'WebSocket鍗忚' },
    { title: '鐢靛瓙閭欢鍗忚' },
    { title: 'FTP鍗忚宸ヤ綔鍘熺悊' },
    { title: '鍩熷悕瑙ｆ瀽杩囩▼' },
    { title: 'CDN鎶€鏈師鐞? },
    { title: 'VPN鎶€鏈? },
    { title: '缃戠粶瀹夊叏鏀诲嚮绫诲瀷' },
  ],
  literature: [
    { title: '璋㈠笇浠併€婅绠楁満缃戠粶銆?, tags: ['textbook'] },
    { title: '鐜嬮亾408璁＄綉绡?, tags: ['exam-guide'] },
    { title: '澶╁嫟璁＄綉楂樺垎绗旇', tags: ['exam-guide'] },
    { title: 'Kurose銆婅绠楁満缃戠粶鑷《鍚戜笅銆?, tags: ['textbook'] },
    { title: '銆奣CP/IP璇﹁В銆?, tags: ['textbook'] },
    { title: '璁＄畻鏈虹綉缁?Andrew Tanenbaum)', tags: ['textbook'] },
    { title: '銆婂浘瑙TTP銆?, tags: ['textbook'] },
    { title: '銆婄綉缁滄槸鎬庢牱杩炴帴鐨勩€?, tags: ['textbook'] },
  ],
}

// 鈹€鈹€鈹€ Edges Definition 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const withinDSEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: '绾挎€ц〃', targetTitle: '鏍?, type: 'prerequisite' },
  { sourceTitle: '绾挎€ц〃', targetTitle: '闃熷垪', type: 'prerequisite' },
  { sourceTitle: '鏍?, targetTitle: '浜屽弶鏍?, type: 'related' },
  { sourceTitle: '鏍?, targetTitle: '浜屽弶鏍?, type: 'derived' },
  { sourceTitle: '浜屽弶鏍?, targetTitle: '骞宠　浜屽弶鏍?, type: 'derived' },
  { sourceTitle: '浜屽弶鏍?, targetTitle: '鍫?, type: 'related' },
  { sourceTitle: '鏍?, targetTitle: '鍥?, type: 'related' },
  { sourceTitle: '鍥?, targetTitle: '鏈€鐭矾寰?, type: 'prerequisite' },
  { sourceTitle: '鍥?, targetTitle: '鍏抽敭璺緞', type: 'prerequisite' },
  { sourceTitle: '鎺掑簭绠楁硶', targetTitle: '鏌ユ壘绠楁硶', type: 'related' },
  { sourceTitle: '鍝堝笇琛?, targetTitle: '鏌ユ壘绠楁硶', type: 'related' },
  { sourceTitle: '鎺掑簭绠楁硶', targetTitle: '鍫?, type: 'related' },
  { sourceTitle: '浜屽弶鏍?, targetTitle: 'B鏍?, type: 'derived' },
  { sourceTitle: '鏍?, targetTitle: '鎺掑簭绠楁硶', type: 'related' },
  { sourceTitle: '闃熷垪', targetTitle: '鍥?, type: 'related' },
  { sourceTitle: '鏍?, targetTitle: '鍥?, type: 'related' },
  { sourceTitle: '鏌ユ壘绠楁硶', targetTitle: '鍝堝笇琛?, type: 'related' },
  { sourceTitle: '浜屽弶鏍?, targetTitle: '鏌ユ壘绠楁硶', type: 'related' },
  { sourceTitle: '骞舵煡闆?, targetTitle: '鍥?, type: 'related' },
  { sourceTitle: '鍏抽敭璺緞', targetTitle: '鏈€鐭矾寰?, type: 'related' },
  { sourceTitle: 'B鏍?, targetTitle: '鏌ユ壘绠楁硶', type: 'related' },
  { sourceTitle: '鎺掑簭绠楁硶', targetTitle: '鍏抽敭璺緞', type: 'related' },
  { sourceTitle: '骞宠　浜屽弶鏍?, targetTitle: '鏌ユ壘绠楁硶', type: 'related' },
  { sourceTitle: '绾挎€ц〃', targetTitle: '鎺掑簭绠楁硶', type: 'prerequisite' },
  { sourceTitle: '鍫?, targetTitle: '鎺掑簭绠楁硶', type: 'related' },
  { sourceTitle: '绾挎€ц〃', targetTitle: '鏌ユ壘绠楁硶', type: 'prerequisite' },
  { sourceTitle: '鏍?, targetTitle: '骞舵煡闆?, type: 'related' },
  { sourceTitle: '鍝堝笇琛?, targetTitle: '鏍?, type: 'related' },
  { sourceTitle: '浜屽弶鏍?, targetTitle: '鍏抽敭璺緞', type: 'related' },
  { sourceTitle: '鍥?, targetTitle: '鎺掑簭绠楁硶', type: 'related' },
  { sourceTitle: '闃熷垪', targetTitle: '鎺掑簭绠楁硶', type: 'related' },
  { sourceTitle: '鏍?, targetTitle: '闃熷垪', type: 'related' },
  { sourceTitle: '鏍?, targetTitle: '鍝堝笇琛?, type: 'related' },
  { sourceTitle: '绾挎€ц〃', targetTitle: '鍝堝笇琛?, type: 'related' },
  { sourceTitle: '鍫?, targetTitle: '闃熷垪', type: 'related' },
  { sourceTitle: '浜屽弶鏍?, targetTitle: '鍥?, type: 'related' },
  { sourceTitle: '骞宠　浜屽弶鏍?, targetTitle: 'B鏍?, type: 'related' },
  { sourceTitle: '鏈€鐭矾寰?, targetTitle: '鎺掑簭绠楁硶', type: 'related' },
  { sourceTitle: '骞舵煡闆?, targetTitle: '鏈€鐭矾寰?, type: 'related' },
  { sourceTitle: '鍝堝笇琛?, targetTitle: '闃熷垪', type: 'related' },
  { sourceTitle: '绾挎€ц〃', targetTitle: '鏍?, type: 'prerequisite' },
  { sourceTitle: '鏍?, targetTitle: '鍏抽敭璺緞', type: 'related' },
  { sourceTitle: '闃熷垪', targetTitle: '鏈€鐭矾寰?, type: 'related' },
  { sourceTitle: 'B鏍?, targetTitle: '骞宠　浜屽弶鏍?, type: 'related' },
  { sourceTitle: '鍝堝笇琛?, targetTitle: '骞舵煡闆?, type: 'related' },
  { sourceTitle: '鍫?, targetTitle: '鍥?, type: 'related' },
  { sourceTitle: '鏍?, targetTitle: '骞宠　浜屽弶鏍?, type: 'related' },
  { sourceTitle: '鏍?, targetTitle: '鎺掑簭绠楁硶', type: 'related' },
  { sourceTitle: '闃熷垪', targetTitle: '鍝堝笇琛?, type: 'related' },
  { sourceTitle: '绾挎€ц〃', targetTitle: '鍥?, type: 'prerequisite' },
]

const withinCOEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: '鍐渚濇浖缁撴瀯', targetTitle: '鏁版嵁琛ㄧず', type: 'prerequisite' },
  { sourceTitle: '鍐渚濇浖缁撴瀯', targetTitle: '鎸囦护绯荤粺', type: 'prerequisite' },
  { sourceTitle: '鏁版嵁琛ㄧず', targetTitle: '杩愮畻鏂规硶涓嶢LU', type: 'prerequisite' },
  { sourceTitle: '杩愮畻鏂规硶涓嶢LU', targetTitle: '娴偣杩愮畻', type: 'related' },
  { sourceTitle: '瀛樺偍鍣ㄥ眰娆?, targetTitle: 'Cache', type: 'derived' },
  { sourceTitle: '瀛樺偍鍣ㄥ眰娆?, targetTitle: '铏氭嫙瀛樺偍鍣?, type: 'derived' },
  { sourceTitle: 'Cache', targetTitle: '铏氭嫙瀛樺偍鍣?, type: 'related' },
  { sourceTitle: '鎸囦护绯荤粺', targetTitle: 'CPU娴佹按绾?, type: 'prerequisite' },
  { sourceTitle: 'CPU娴佹按绾?, targetTitle: '鎸囦护娴佹按绾垮啋闄?, type: 'related' },
  { sourceTitle: '鎺у埗鍗曞厓', targetTitle: 'CPU娴佹按绾?, type: 'related' },
  { sourceTitle: '鎬荤嚎绯荤粺', targetTitle: '杈撳叆杈撳嚭绯荤粺', type: 'prerequisite' },
  { sourceTitle: '杈撳叆杈撳嚭绯荤粺', targetTitle: '涓柇绯荤粺', type: 'related' },
  { sourceTitle: '杈撳叆杈撳嚭绯荤粺', targetTitle: 'DMA', type: 'related' },
  { sourceTitle: '涓柇绯荤粺', targetTitle: 'DMA', type: 'related' },
  { sourceTitle: '鎬荤嚎绯荤粺', targetTitle: '涓柇绯荤粺', type: 'related' },
  { sourceTitle: '杩愮畻鏂规硶涓嶢LU', targetTitle: '鏁版嵁琛ㄧず', type: 'prerequisite' }, // reverse direction for "derived"
  { sourceTitle: '娴偣杩愮畻', targetTitle: '鏁版嵁琛ㄧず', type: 'related' },
  { sourceTitle: 'CPU娴佹按绾?, targetTitle: '鎺у埗鍗曞厓', type: 'related' },
  { sourceTitle: '鎸囦护娴佹按绾垮啋闄?, targetTitle: 'CPU娴佹按绾?, type: 'derived' },
  { sourceTitle: '鎸囦护绯荤粺', targetTitle: '鎺у埗鍗曞厓', type: 'prerequisite' },
  { sourceTitle: '鍐渚濇浖缁撴瀯', targetTitle: '瀛樺偍鍣ㄥ眰娆?, type: 'prerequisite' },
  { sourceTitle: '鍐渚濇浖缁撴瀯', targetTitle: '鎬荤嚎绯荤粺', type: 'prerequisite' },
  { sourceTitle: 'Cache', targetTitle: '瀛樺偍鍣ㄥ眰娆?, type: 'derived' },
  { sourceTitle: '铏氭嫙瀛樺偍鍣?, targetTitle: '瀛樺偍鍣ㄥ眰娆?, type: 'derived' },
  { sourceTitle: 'Cache', targetTitle: '杩愮畻鏂规硶涓嶢LU', type: 'related' },
  { sourceTitle: 'DMA', targetTitle: '鎬荤嚎绯荤粺', type: 'related' },
  { sourceTitle: '涓柇绯荤粺', targetTitle: 'CPU娴佹按绾?, type: 'related' },
  { sourceTitle: '鎸囦护绯荤粺', targetTitle: '杩愮畻鏂规硶涓嶢LU', type: 'related' },
  { sourceTitle: '鏁版嵁琛ㄧず', targetTitle: 'Cache', type: 'related' },
  { sourceTitle: '鎬荤嚎绯荤粺', targetTitle: 'CPU娴佹按绾?, type: 'related' },
  { sourceTitle: '鍐渚濇浖缁撴瀯', targetTitle: '鎺у埗鍗曞厓', type: 'prerequisite' },
  { sourceTitle: '杈撳叆杈撳嚭绯荤粺', targetTitle: '鎬荤嚎绯荤粺', type: 'prerequisite' },
  { sourceTitle: '铏氭嫙瀛樺偍鍣?, targetTitle: '鎸囦护绯荤粺', type: 'related' },
  { sourceTitle: '娴偣杩愮畻', targetTitle: '杩愮畻鏂规硶涓嶢LU', type: 'derived' },
  { sourceTitle: 'Cache', targetTitle: '鎸囦护绯荤粺', type: 'related' },
  { sourceTitle: '涓柇绯荤粺', targetTitle: '杈撳叆杈撳嚭绯荤粺', type: 'derived' },
  { sourceTitle: 'DMA', targetTitle: '杈撳叆杈撳嚭绯荤粺', type: 'derived' },
  { sourceTitle: '鎸囦护娴佹按绾垮啋闄?, targetTitle: '鎺у埗鍗曞厓', type: 'related' },
  { sourceTitle: '娴偣杩愮畻', targetTitle: '鎸囦护绯荤粺', type: 'related' },
  { sourceTitle: '鏁版嵁琛ㄧず', targetTitle: '鎬荤嚎绯荤粺', type: 'related' },
  { sourceTitle: '鍐渚濇浖缁撴瀯', targetTitle: '杈撳叆杈撳嚭绯荤粺', type: 'prerequisite' },
  { sourceTitle: '瀛樺偍鍣ㄥ眰娆?, targetTitle: '鎬荤嚎绯荤粺', type: 'related' },
  { sourceTitle: 'Cache', targetTitle: '鎬荤嚎绯荤粺', type: 'related' },
  { sourceTitle: '铏氭嫙瀛樺偍鍣?, targetTitle: 'Cache', type: 'related' },
  { sourceTitle: '鎺у埗鍗曞厓', targetTitle: '鎸囦护绯荤粺', type: 'prerequisite' },
  { sourceTitle: 'CPU娴佹按绾?, targetTitle: '鎸囦护绯荤粺', type: 'derived' },
  { sourceTitle: '杩愮畻鏂规硶涓嶢LU', targetTitle: 'CPU娴佹按绾?, type: 'related' },
  { sourceTitle: '娴偣杩愮畻', targetTitle: 'Cache', type: 'related' },
  { sourceTitle: 'DMA', targetTitle: 'CPU娴佹按绾?, type: 'related' },
  { sourceTitle: '涓柇绯荤粺', targetTitle: '瀛樺偍鍣ㄥ眰娆?, type: 'related' },
]

const withinOSEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: '杩涚▼涓庣嚎绋?, targetTitle: '杩涚▼璋冨害', type: 'prerequisite' },
  { sourceTitle: '杩涚▼涓庣嚎绋?, targetTitle: '鍚屾涓庝簰鏂?, type: 'prerequisite' },
  { sourceTitle: '杩涚▼涓庣嚎绋?, targetTitle: '杩涚▼閫氫俊', type: 'prerequisite' },
  { sourceTitle: '杩涚▼璋冨害', targetTitle: '鍚屾涓庝簰鏂?, type: 'related' },
  { sourceTitle: '鍚屾涓庝簰鏂?, targetTitle: '淇″彿閲忔満鍒?, type: 'derived' },
  { sourceTitle: '鍚屾涓庝簰鏂?, targetTitle: '绠＄▼', type: 'derived' },
  { sourceTitle: '鍚屾涓庝簰鏂?, targetTitle: '姝婚攣', type: 'related' },
  { sourceTitle: '姝婚攣', targetTitle: '杩涚▼璋冨害', type: 'related' },
  { sourceTitle: '鍐呭瓨绠＄悊', targetTitle: '鍒嗛〉涓庡垎娈?, type: 'derived' },
  { sourceTitle: '鍐呭瓨绠＄悊', targetTitle: '铏氭嫙鍐呭瓨', type: 'derived' },
  { sourceTitle: '鍒嗛〉涓庡垎娈?, targetTitle: '铏氭嫙鍐呭瓨', type: 'related' },
  { sourceTitle: '铏氭嫙鍐呭瓨', targetTitle: '椤甸潰缃崲绠楁硶', type: 'related' },
  { sourceTitle: '鏂囦欢绯荤粺', targetTitle: '璁惧绠＄悊', type: 'related' },
  { sourceTitle: '璁惧绠＄悊', targetTitle: 'IO绠＄悊', type: 'related' },
  { sourceTitle: '璁惧绠＄悊', targetTitle: '纾佺洏璋冨害', type: 'related' },
  { sourceTitle: '纾佺洏璋冨害', targetTitle: 'IO绠＄悊', type: 'related' },
  { sourceTitle: '杩涚▼閫氫俊', targetTitle: '淇″彿閲忔満鍒?, type: 'related' },
  { sourceTitle: '杩涚▼閫氫俊', targetTitle: '鍚屾涓庝簰鏂?, type: 'related' },
  { sourceTitle: '杩涚▼璋冨害', targetTitle: '椤甸潰缃崲绠楁硶', type: 'related' },
  { sourceTitle: '鍐呭瓨绠＄悊', targetTitle: '杩涚▼璋冨害', type: 'related' },
  { sourceTitle: '鏂囦欢绯荤粺', targetTitle: '鍐呭瓨绠＄悊', type: 'related' },
  { sourceTitle: '淇″彿閲忔満鍒?, targetTitle: '绠＄▼', type: 'related' },
  { sourceTitle: '杩涚▼涓庣嚎绋?, targetTitle: '鍐呭瓨绠＄悊', type: 'related' },
  { sourceTitle: '杩涚▼璋冨害', targetTitle: '杩涚▼閫氫俊', type: 'related' },
  { sourceTitle: '姝婚攣', targetTitle: '鍚屾涓庝簰鏂?, type: 'derived' },
  { sourceTitle: '鍒嗛〉涓庡垎娈?, targetTitle: '鍐呭瓨绠＄悊', type: 'derived' },
  { sourceTitle: '铏氭嫙鍐呭瓨', targetTitle: '鍐呭瓨绠＄悊', type: 'derived' },
  { sourceTitle: '椤甸潰缃崲绠楁硶', targetTitle: '铏氭嫙鍐呭瓨', type: 'derived' },
  { sourceTitle: 'IO绠＄悊', targetTitle: '璁惧绠＄悊', type: 'derived' },
  { sourceTitle: '纾佺洏璋冨害', targetTitle: '璁惧绠＄悊', type: 'derived' },
  { sourceTitle: '鏂囦欢绯荤粺', targetTitle: 'IO绠＄悊', type: 'related' },
  { sourceTitle: '淇″彿閲忔満鍒?, targetTitle: '杩涚▼涓庣嚎绋?, type: 'related' },
  { sourceTitle: '绠＄▼', targetTitle: '淇″彿閲忔満鍒?, type: 'related' },
  { sourceTitle: '杩涚▼閫氫俊', targetTitle: '杩涚▼涓庣嚎绋?, type: 'derived' },
  { sourceTitle: '杩涚▼璋冨害', targetTitle: '鍐呭瓨绠＄悊', type: 'related' },
  { sourceTitle: '姝婚攣', targetTitle: '鍐呭瓨绠＄悊', type: 'related' },
  { sourceTitle: '鍒嗛〉涓庡垎娈?, targetTitle: '杩涚▼璋冨害', type: 'related' },
  { sourceTitle: '铏氭嫙鍐呭瓨', targetTitle: '杩涚▼璋冨害', type: 'related' },
  { sourceTitle: '椤甸潰缃崲绠楁硶', targetTitle: '鍐呭瓨绠＄悊', type: 'related' },
  { sourceTitle: '鏂囦欢绯荤粺', targetTitle: '鍒嗛〉涓庡垎娈?, type: 'related' },
  { sourceTitle: 'IO绠＄悊', targetTitle: '鏂囦欢绯荤粺', type: 'related' },
  { sourceTitle: '纾佺洏璋冨害', targetTitle: '鏂囦欢绯荤粺', type: 'related' },
  { sourceTitle: '杩涚▼涓庣嚎绋?, targetTitle: '姝婚攣', type: 'related' },
  { sourceTitle: '鍚屾涓庝簰鏂?, targetTitle: '鍐呭瓨绠＄悊', type: 'related' },
  { sourceTitle: '淇″彿閲忔満鍒?, targetTitle: '姝婚攣', type: 'related' },
  { sourceTitle: '绠＄▼', targetTitle: '鍚屾涓庝簰鏂?, type: 'derived' },
  { sourceTitle: '杩涚▼閫氫俊', targetTitle: '绠＄▼', type: 'related' },
  { sourceTitle: '杩涚▼璋冨害', targetTitle: '绠＄▼', type: 'related' },
  { sourceTitle: '鏂囦欢绯荤粺', targetTitle: '杩涚▼涓庣嚎绋?, type: 'related' },
  { sourceTitle: 'IO绠＄悊', targetTitle: '杩涚▼涓庣嚎绋?, type: 'related' },
]

const withinCNEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: 'OSI涓冨眰妯″瀷', targetTitle: 'TCP/IP鍗忚鏍?, type: 'related' },
  { sourceTitle: '鐗╃悊灞?, targetTitle: '鏁版嵁閾捐矾灞?, type: 'prerequisite' },
  { sourceTitle: '鏁版嵁閾捐矾灞?, targetTitle: '缃戠粶灞?, type: 'prerequisite' },
  { sourceTitle: '缃戠粶灞?, targetTitle: '浼犺緭灞?, type: 'prerequisite' },
  { sourceTitle: '浼犺緭灞?, targetTitle: '搴旂敤灞?, type: 'prerequisite' },
  { sourceTitle: '浼犺緭灞?, targetTitle: 'TCP鍙潬浼犺緭', type: 'derived' },
  { sourceTitle: '浼犺緭灞?, targetTitle: '鎷ュ鎺у埗', type: 'related' },
  { sourceTitle: '缃戠粶灞?, targetTitle: 'IP鍗忚', type: 'derived' },
  { sourceTitle: '缃戠粶灞?, targetTitle: '璺敱绠楁硶', type: 'related' },
  { sourceTitle: '鏁版嵁閾捐矾灞?, targetTitle: '灞€鍩熺綉鎶€鏈?, type: 'related' },
  { sourceTitle: '搴旂敤灞?, targetTitle: 'HTTP鍗忚', type: 'derived' },
  { sourceTitle: '搴旂敤灞?, targetTitle: 'DNS绯荤粺', type: 'derived' },
  { sourceTitle: '鐗╃悊灞?, targetTitle: '灞€鍩熺綉鎶€鏈?, type: 'prerequisite' },
  { sourceTitle: '缃戠粶瀹夊叏', targetTitle: '搴旂敤灞?, type: 'related' },
  { sourceTitle: 'TCP鍙潬浼犺緭', targetTitle: '鎷ュ鎺у埗', type: 'related' },
  { sourceTitle: 'IP鍗忚', targetTitle: '璺敱绠楁硶', type: 'related' },
  { sourceTitle: 'OSI涓冨眰妯″瀷', targetTitle: '鐗╃悊灞?, type: 'prerequisite' },
  { sourceTitle: 'TCP/IP鍗忚鏍?, targetTitle: '缃戠粶灞?, type: 'related' },
  { sourceTitle: 'TCP/IP鍗忚鏍?, targetTitle: '浼犺緭灞?, type: 'related' },
  { sourceTitle: 'OSI涓冨眰妯″瀷', targetTitle: 'TCP/IP鍗忚鏍?, type: 'related' },
  { sourceTitle: '鏁版嵁閾捐矾灞?, targetTitle: '缃戠粶瀹夊叏', type: 'related' },
  { sourceTitle: '缃戠粶灞?, targetTitle: '缃戠粶瀹夊叏', type: 'related' },
  { sourceTitle: '浼犺緭灞?, targetTitle: '缃戠粶瀹夊叏', type: 'related' },
  { sourceTitle: '搴旂敤灞?, targetTitle: 'TCP/IP鍗忚鏍?, type: 'related' },
  { sourceTitle: 'HTTP鍗忚', targetTitle: 'DNS绯荤粺', type: 'related' },
  { sourceTitle: '璺敱绠楁硶', targetTitle: 'IP鍗忚', type: 'related' },
  { sourceTitle: '鎷ュ鎺у埗', targetTitle: 'TCP鍙潬浼犺緭', type: 'derived' },
  { sourceTitle: '灞€鍩熺綉鎶€鏈?, targetTitle: '鏁版嵁閾捐矾灞?, type: 'derived' },
  { sourceTitle: 'OSI涓冨眰妯″瀷', targetTitle: '鏁版嵁閾捐矾灞?, type: 'prerequisite' },
  { sourceTitle: 'TCP/IP鍗忚鏍?, targetTitle: '搴旂敤灞?, type: 'related' },
  { sourceTitle: '鐗╃悊灞?, targetTitle: '缃戠粶瀹夊叏', type: 'related' },
  { sourceTitle: 'DNS绯荤粺', targetTitle: 'HTTP鍗忚', type: 'related' },
  { sourceTitle: 'IP鍗忚', targetTitle: '浼犺緭灞?, type: 'prerequisite' },
  { sourceTitle: '璺敱绠楁硶', targetTitle: '浼犺緭灞?, type: 'related' },
  { sourceTitle: '鎷ュ鎺у埗', targetTitle: '缃戠粶灞?, type: 'related' },
  { sourceTitle: 'TCP鍙潬浼犺緭', targetTitle: '缃戠粶灞?, type: 'related' },
  { sourceTitle: '灞€鍩熺綉鎶€鏈?, targetTitle: '缃戠粶灞?, type: 'related' },
  { sourceTitle: 'OSI涓冨眰妯″瀷', targetTitle: '缃戠粶灞?, type: 'prerequisite' },
  { sourceTitle: 'TCP/IP鍗忚鏍?, targetTitle: '鏁版嵁閾捐矾灞?, type: 'related' },
  { sourceTitle: '鐗╃悊灞?, targetTitle: 'OSI涓冨眰妯″瀷', type: 'prerequisite' },
  { sourceTitle: 'HTTP鍗忚', targetTitle: '浼犺緭灞?, type: 'prerequisite' },
  { sourceTitle: 'DNS绯荤粺', targetTitle: '缃戠粶灞?, type: 'related' },
  { sourceTitle: '缃戠粶瀹夊叏', targetTitle: 'IP鍗忚', type: 'related' },
  { sourceTitle: '璺敱绠楁硶', targetTitle: '鏁版嵁閾捐矾灞?, type: 'related' },
  { sourceTitle: '鎷ュ鎺у埗', targetTitle: '鏁版嵁閾捐矾灞?, type: 'related' },
  { sourceTitle: 'TCP鍙潬浼犺緭', targetTitle: '鏁版嵁閾捐矾灞?, type: 'related' },
  { sourceTitle: '鐗╃悊灞?, targetTitle: '浼犺緭灞?, type: 'related' },
  { sourceTitle: '灞€鍩熺綉鎶€鏈?, targetTitle: '鐗╃悊灞?, type: 'derived' },
  { sourceTitle: 'OSI涓冨眰妯″瀷', targetTitle: '搴旂敤灞?, type: 'prerequisite' },
]

// Cross-cluster edges
const crossEdges: EdgeDef[] = [
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '杩涚▼璋冨害', targetSubject: '璁＄畻鏈虹粍鎴愬師鐞?, targetTitle: 'CPU娴佹按绾?, type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '鍐呭瓨绠＄悊', targetSubject: '璁＄畻鏈虹粍鎴愬師鐞?, targetTitle: '铏氭嫙瀛樺偍鍣?, type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '铏氭嫙鍐呭瓨', targetSubject: '璁＄畻鏈虹粍鎴愬師鐞?, targetTitle: 'Cache', type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '鍚屾涓庝簰鏂?, targetSubject: '璁＄畻鏈虹粍鎴愬師鐞?, targetTitle: '涓柇绯荤粺', type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '璁惧绠＄悊', targetSubject: '璁＄畻鏈虹粍鎴愬師鐞?, targetTitle: 'DMA', type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '杩涚▼閫氫俊', targetSubject: '璁＄畻鏈虹粍鎴愬師鐞?, targetTitle: '鎬荤嚎绯荤粺', type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '鏂囦欢绯荤粺', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鏍?, type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '椤甸潰缃崲绠楁硶', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '闃熷垪', type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '姝婚攣', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鍥?, type: 'related' },
  { sourceSubject: '鎿嶄綔绯荤粺', sourceTitle: '杩涚▼璋冨害', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鎺掑簭绠楁硶', type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: 'TCP鍙潬浼犺緭', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '闃熷垪', type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: '璺敱绠楁硶', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鏈€鐭矾寰?, type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: '璺敱绠楁硶', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鍥?, type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: 'DNS绯荤粺', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鍝堝笇琛?, type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: '缃戠粶瀹夊叏', targetSubject: '鎿嶄綔绯荤粺', targetTitle: '鏂囦欢绯荤粺', type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: '鎷ュ鎺у埗', targetSubject: '鎿嶄綔绯荤粺', targetTitle: '杩涚▼璋冨害', type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: 'TCP/IP鍗忚鏍?, targetSubject: '鎿嶄綔绯荤粺', targetTitle: '杩涚▼閫氫俊', type: 'related' },
  { sourceSubject: '璁＄畻鏈虹綉缁?, sourceTitle: '浼犺緭灞?, targetSubject: '鎿嶄綔绯荤粺', targetTitle: '杩涚▼閫氫俊', type: 'related' },
  { sourceSubject: '璁＄畻鏈虹粍鎴愬師鐞?, sourceTitle: 'Cache', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鍝堝笇琛?, type: 'related' },
  { sourceSubject: '璁＄畻鏈虹粍鎴愬師鐞?, sourceTitle: '鏁版嵁琛ㄧず', targetSubject: '鏁版嵁缁撴瀯', targetTitle: '鏍?, type: 'related' },
]

// 鈹€鈹€鈹€ Helper: Build related-titles map from edge definitions 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function buildRelatedTitlesMap(): Map<string, { prerequisite: string[]; related: string[]; derived: string[] }> {
  const map = new Map<string, { prerequisite: string[]; related: string[]; derived: string[] }>()

  function ensure(title: string) {
    if (!map.has(title)) map.set(title, { prerequisite: [], related: [], derived: [] })
    return map.get(title)!
  }

  function add(sourceTitle: string, targetTitle: string, type: string) {
    ensure(sourceTitle)
    const entry = map.get(sourceTitle)!
    if (type === 'prerequisite') entry.prerequisite.push(targetTitle)
    else if (type === 'derived') entry.derived.push(targetTitle)
    else entry.related.push(targetTitle)

    // 鍙嶅悜閾炬帴锛氬鏋?A prerequisite B锛屽垯 B derived_from A
    // related 鏄绉扮殑锛岀洿鎺ュ弽杞?    const reverseType = type === 'prerequisite' ? 'derived' : type === 'derived' ? 'prerequisite' : 'related'
    ensure(targetTitle)
    const revEntry = map.get(targetTitle)!
    if (reverseType === 'prerequisite') revEntry.prerequisite.push(sourceTitle)
    else if (reverseType === 'derived') revEntry.derived.push(sourceTitle)
    else revEntry.related.push(sourceTitle)
  }

  // Within-subject edges (subject info not needed 鈥?all titles are unique)
  for (const e of withinDSEdges) add(e.sourceTitle, e.targetTitle, e.type)
  for (const e of withinCOEdges) add(e.sourceTitle, e.targetTitle, e.type)
  for (const e of withinOSEdges) add(e.sourceTitle, e.targetTitle, e.type)
  for (const e of withinCNEdges) add(e.sourceTitle, e.targetTitle, e.type)
  // Cross-subject edges
  for (const e of crossEdges) add(e.sourceTitle, e.targetTitle, e.type)

  return map
}

function buildContent(title: string, related: { prerequisite: string[]; related: string[]; derived: string[] }): string {
  const lines: string[] = [`## ${title}`]

  if (related.prerequisite.length > 0) {
    lines.push('', '**Prerequisites:** ' + related.prerequisite.map(t => `[[${t}]]`).join(', '))
  }
  if (related.related.length > 0) {
    lines.push('', '**Related:** ' + related.related.map(t => `[[${t}]]`).join(', '))
  }
  if (related.derived.length > 0) {
    lines.push('', '**Derived from / leads to:** ' + related.derived.map(t => `[[${t}]]`).join(', '))
  }

  lines.push('', '---', '_CS408 Knowledge Graph 鈥?auto-generated seed content_')
  return lines.join('\n')
}

/** Auto-discover WikiLinks for cards that have no manual EdgeDef entries.
 *  Scans all card titles in the same vault and links to any card whose title
 *  appears as a substring of this card's title. This catches cases like
 *  "浜屽弶鏍戠殑閬嶅巻椤哄簭" 鈫?[[浜屽弶鏍慮] and "鏍堜笌閫掑綊鐨勫叧绯? 鈫?[[鏍圿].
 *  Subject-scoped to avoid cross-subject false positives from short names.
 *  Falls back to anchor titles (permanent cards of the subject) so every
 *  card has at least some connections for galaxy visual density. */

/**
 * Manually curated fleeting 鈫?permanent card associations.
 * Every fleeting card below is explicitly linked to 1-3 permanent cards
 * that represent the core concepts it discusses. No automatic matching.
 */
const fleetingToPermanent: Record<string, string[]> = {
  // 鈺愨晲鈺?鏁版嵁缁撴瀯 鈺愨晲鈺?  '蹇€熸帓搴忔渶鍧忔儏鍐?:     ['鎺掑簭绠楁硶'],
  '鍝堝笇鍐茬獊瑙ｅ喅':         ['鍝堝笇琛?],
  'KMP绠楁硶鎬濇兂':          ['鏌ユ壘绠楁硶'],
  '鍔ㄦ€佽鍒抳s璐績绠楁硶':   ['鍥?],
  '绋€鐤忕煩闃靛瓨鍌?:         ['绾挎€ц〃'],
  '骞夸箟琛ㄧ粨鏋?:           ['绾挎€ц〃'],
  '澶栭儴鎺掑簭涓庡璺綊骞?:   ['鎺掑簭绠楁硶'],
  '浜屽垎鏌ユ壘鍐崇瓥鏍?:       ['鏌ユ壘绠楁硶', '浜屽弶鏍?],
  '鏁ｅ垪鍑芥暟璁捐':         ['鍝堝笇琛?],
  '瀛楃涓插尮閰嶇畻娉?:       ['鏌ユ壘绠楁硶'],
  '澶ф暟鎹甌opK闂':       ['鍫?, '鎺掑簭绠楁硶'],
  '鎺掑簭绠楁硶绋冲畾鎬у姣?:   ['鎺掑簭绠楁硶'],
  '鏃堕棿澶嶆潅搴︾殑娓愯繘鍒嗘瀽': ['鎺掑簭绠楁硶', '鏌ユ壘绠楁硶'],
  '閫掑綊绠楁硶鐨勮绠楁ā鍨?:   ['鏍?],
  '鏈€灏忕敓鎴愭爲绠楁硶瀵规瘮':   ['鍥?],
  '閾捐〃鐨勬彃鍏ュ垹闄ゆ搷浣?:   ['绾挎€ц〃'],
  '鍙屽悜閾捐〃涓庡惊鐜摼琛?:   ['绾挎€ц〃'],
  '浜屽弶鏍戜笌妫灄杞崲':     ['浜屽弶鏍?, '鏍?],
  'Huffman缂栫爜':          ['浜屽弶鏍?],
  'AVL鏍戞棆杞搷浣?:        ['骞宠　浜屽弶鏍?],
  '绾㈤粦鏍戞€ц川':           ['骞宠　浜屽弶鏍?],
  '鎷撴墤鎺掑簭瀹炵幇':         ['鍥?],
  'Dijkstra绠楁硶鍘熺悊':     ['鏈€鐭矾寰?, '鍥?],
  'Floyd绠楁硶鍘熺悊':        ['鏈€鐭矾寰?, '鍥?],
  '褰掑苟鎺掑簭杩囩▼':         ['鎺掑簭绠楁硶'],
  '鍩烘暟鎺掑簭鎬濇兂':         ['鎺掑簭绠楁硶'],

  // Remaining 鏁版嵁缁撴瀯 fleeting cards
  'B鏍戜笌B+鏍戝尯鍒?:       ['B鏍?],
  'Prim绠楁硶涓嶬ruskal绠楁硶瀵规瘮': ['鍥?],
  '浜屽弶鏍戠殑閬嶅巻椤哄簭':     ['浜屽弶鏍?, '鏍?],
  '鍥剧殑娣卞害浼樺厛涓庡箍搴︿紭鍏?: ['鍥?],
  '鍥剧殑閭绘帴鐭╅樀vs閭绘帴琛?: ['鍥?],
  '寰幆闃熷垪瀹炵幇':         ['闃熷垪'],
  '鏍堜笌閫掑綊鐨勫叧绯?:       ['鏍?],
  '鏍堢殑搴旂敤鍦烘櫙':         ['鏍?],
  '闃熷垪鐨勫簲鐢ㄥ満鏅?:       ['闃熷垪'],

  // 鈺愨晲鈺?璁＄畻鏈虹粍鎴愬師鐞?鈺愨晲鈺?  '鍘熺爜鍙嶇爜琛ョ爜杞崲':     ['鏁版嵁琛ㄧず'],
  'IEEE754娴偣鏍囧噯':      ['娴偣杩愮畻', '鏁版嵁琛ㄧず'],
  'Cache鏄犲皠鏂瑰紡':        ['Cache'],
  '娴佹按绾垮啿绐佺被鍨?:       ['鎸囦护娴佹按绾垮啋闄?, 'CPU娴佹按绾?],
  '涓柇澶勭悊娴佺▼':         ['涓柇绯荤粺'],
  'DMA涓庣▼搴忎腑鏂姣?:    ['DMA', '涓柇绯荤粺'],
  '鎬荤嚎浠茶鏂瑰紡':         ['鎬荤嚎绯荤粺'],
  'RAID绛夌骇鍖哄埆':         ['杈撳叆杈撳嚭绯荤粺'],
  '姹夋槑鐮佹閿?:           ['鏁版嵁琛ㄧず'],
  '椤靛紡铏氭嫙瀛樺偍鍣ㄥ湴鍧€杞崲': ['铏氭嫙瀛樺偍鍣?],
  '寰▼搴忔帶鍒朵笌纭竷绾挎帶鍒?: ['鎺у埗鍗曞厓'],
  '鎸囦护鍛ㄦ湡涓庢満鍣ㄥ懆鏈?:   ['鎺у埗鍗曞厓', 'CPU娴佹按绾?],
  '鏁版嵁瀵诲潃鏂瑰紡':         ['鎸囦护绯荤粺'],
  'CISC涓嶳ISC瀵规瘮':      ['鎸囦护绯荤粺'],
  'MIPS鎸囦护鏍煎紡':        ['鎸囦护绯荤粺'],
  '涔樻硶杩愮畻鐨勭‖浠跺疄鐜?:   ['杩愮畻鏂规硶涓嶢LU'],
  'Booth绠楁硶':            ['杩愮畻鏂规硶涓嶢LU'],
  '娴偣鍔犲噺杩愮畻姝ラ':     ['娴偣杩愮畻'],
  '瀛樺偍鍣ㄧ殑鎵╁睍鎶€鏈?:     ['瀛樺偍鍣ㄥ眰娆?],
  'Cache鍐欑瓥鐣?:          ['Cache'],
  '澶氫綋浜ゅ弶瀛樺偍鍣?:       ['瀛樺偍鍣ㄥ眰娆?],
  '娴佹按绾挎€ц兘鎸囨爣':       ['CPU娴佹按绾?],
  '鏁版嵁鍐掗櫓涓庤浆鍙戞妧鏈?:   ['鎸囦护娴佹按绾垮啋闄?],
  '鎺у埗鍐掗櫓涓庡垎鏀娴?:   ['鎸囦护娴佹按绾垮啋闄?],
  '寮傚父涓庝腑鏂殑鍖哄埆':     ['涓柇绯荤粺'],
  '涓柇浼樺厛绾т笌灞忚斀':     ['涓柇绯荤粺'],
  '閫氶亾鎺у埗鏂瑰紡':         ['杈撳叆杈撳嚭绯荤粺'],
  'IO鎺ュ彛鐨勫姛鑳戒笌缁撴瀯':   ['杈撳叆杈撳嚭绯荤粺'],
  '鎬荤嚎鏍囧噯涓庢帴鍙?:       ['鎬荤嚎绯荤粺'],
  'USB鍗忚姒傝堪':          ['鎬荤嚎绯荤粺', '杈撳叆杈撳嚭绯荤粺'],
  'PCIe鎬荤嚎':             ['鎬荤嚎绯荤粺'],
  '纾佺洏瀛樺偍鍣ㄧ粨鏋?:       ['杈撳叆杈撳嚭绯荤粺'],
  '鍥烘€佺‖鐩楽SD鎶€鏈?:      ['杈撳叆杈撳嚭绯荤粺'],
  '璁＄畻鏈烘€ц兘璇勪环鎸囨爣':   ['CPU娴佹按绾?],
  'Amdahl瀹氬緥':           ['CPU娴佹按绾?],

  // 鈺愨晲鈺?鎿嶄綔绯荤粺 鈺愨晲鈺?  'PCB涓嶵CB鍖哄埆':         ['杩涚▼涓庣嚎绋?],
  '璋冨害绠楁硶姣旇緝':         ['杩涚▼璋冨害'],
  '鐢熶骇鑰呮秷璐硅€呴棶棰?:     ['鍚屾涓庝簰鏂?, '淇″彿閲忔満鍒?],
  '璇昏€呭啓鑰呴棶棰?:         ['鍚屾涓庝簰鏂?],
  '鍝插瀹跺氨椁愰棶棰?:       ['鍚屾涓庝簰鏂?, '淇″彿閲忔満鍒?],
  '姝婚攣蹇呰鏉′欢':         ['姝婚攣'],
  '閾惰瀹剁畻娉?:           ['姝婚攣'],
  '娈甸〉寮忓瓨鍌?:           ['鍒嗛〉涓庡垎娈?, '鍐呭瓨绠＄悊'],
  'LRU涓嶭FU鍖哄埆':        ['椤甸潰缃崲绠楁硶'],
  '纾佺洏璋冨害绠楁硶姣旇緝':     ['纾佺洏璋冨害'],
  '鐢ㄦ埛鎬佷笌鏍稿績鎬佸垏鎹?:   ['杩涚▼涓庣嚎绋?],
  '绯荤粺璋冪敤瀹炵幇':         ['杩涚▼涓庣嚎绋?],
  '杩涚▼鐘舵€佽浆鎹?:         ['杩涚▼涓庣嚎绋?],
  '绾跨▼鐨勫疄鐜版ā鍨?:       ['杩涚▼涓庣嚎绋?],
  '鍗忕▼涓庣嚎绋嬪姣?:       ['杩涚▼涓庣嚎绋?],
  '浜掓枼閿佷笌鑷棆閿?:       ['鍚屾涓庝簰鏂?],
  '璇诲啓閿佸疄鐜?:           ['鍚屾涓庝簰鏂?],
  '鏉′欢鍙橀噺涓庝俊鍙烽噺':     ['淇″彿閲忔満鍒?, '鍚屾涓庝簰鏂?],
  '姝婚攣妫€娴嬩笌鎭㈠':       ['姝婚攣'],
  '鍐呭瓨鍒嗛厤绠楁硶瀵规瘮':     ['鍐呭瓨绠＄悊'],
  '蹇〃TLB鍘熺悊':          ['鍒嗛〉涓庡垎娈?, '铏氭嫙鍐呭瓨'],
  '澶氱骇椤佃〃':             ['鍒嗛〉涓庡垎娈?, '鍐呭瓨绠＄悊'],
  '缂洪〉涓柇澶勭悊':         ['铏氭嫙鍐呭瓨', '椤甸潰缃崲绠楁硶'],
  '椤甸潰鍒嗛厤绛栫暐':         ['椤甸潰缃崲绠楁硶', '鍐呭瓨绠＄悊'],
  '鏂囦欢鍒嗛厤鏂瑰紡瀵规瘮':     ['鏂囦欢绯荤粺'],
  '鐩綍缁撴瀯瀹炵幇':         ['鏂囦欢绯荤粺'],
  '绌洪棽绌洪棿绠＄悊':         ['鏂囦欢绯荤粺'],
  '纾佺洏璋冨害FCFS涓嶴CAN':  ['纾佺洏璋冨害'],
  'SPOOLing绯荤粺':         ['璁惧绠＄悊', 'IO绠＄悊'],
  '缂撳啿鎶€鏈?:             ['IO绠＄悊', '璁惧绠＄悊'],
  '璁惧椹卞姩绋嬪簭鎺ュ彛':     ['璁惧绠＄悊'],
  '鍏变韩鏂囦欢涓庨摼鎺?:       ['鏂囦欢绯荤粺'],
  '鏂囦欢淇濇姢鏈哄埗':         ['鏂囦欢绯荤粺'],
  '鏃ュ織鏂囦欢绯荤粺':         ['鏂囦欢绯荤粺'],
  '瀹炴椂鎿嶄綔绯荤粺鐗圭偣':     ['杩涚▼璋冨害'],

  // 鈺愨晲鈺?璁＄畻鏈虹綉缁?鈺愨晲鈺?  '涓夋鎻℃墜鍥涙鎸ユ墜':     ['浼犺緭灞?, 'TCP鍙潬浼犺緭'],
  'TCP涓嶶DP鍖哄埆':        ['浼犺緭灞?],
  '婊戝姩绐楀彛鏈哄埗':         ['TCP鍙潬浼犺緭'],
  '鎷ュ鎺у埗绠楁硶':         ['鎷ュ鎺у埗'],
  'ARP鍗忚宸ヤ綔娴佺▼':      ['缃戠粶灞?, 'IP鍗忚'],
  'DHCP鍘熺悊':             ['搴旂敤灞?, '缃戠粶灞?],
  '瀛愮綉鍒掑垎':             ['缃戠粶灞?, 'IP鍗忚'],
  'CIDR琛ㄧず娉?:           ['缃戠粶灞?, 'IP鍗忚'],
  'NAT杞崲':              ['缃戠粶灞?, 'IP鍗忚'],
  '璺敱閫夋嫨鍗忚瀵规瘮':     ['璺敱绠楁硶', '缃戠粶灞?],
  '淇￠亾澶嶇敤鎶€鏈?:         ['鐗╃悊灞?],
  '缂栫爜涓庤皟鍒?:           ['鐗╃悊灞?],
  '浼犺緭浠嬭川鍒嗙被':         ['鐗╃悊灞?],
  'CSMA/CD鍗忚':          ['鏁版嵁閾捐矾灞?, '灞€鍩熺綉鎶€鏈?],
  '浠ュお缃戝抚缁撴瀯':         ['鏁版嵁閾捐矾灞?],
  '浜ゆ崲鏈轰笌闆嗙嚎鍣ㄥ尯鍒?:   ['鏁版嵁閾捐矾灞?, '灞€鍩熺綉鎶€鏈?],
  'VLAN鎶€鏈?:             ['鏁版嵁閾捐矾灞?, '灞€鍩熺綉鎶€鏈?],
  '鐢熸垚鏍戝崗璁?:           ['鏁版嵁閾捐矾灞?, '灞€鍩熺綉鎶€鏈?],
  'IP鏁版嵁鎶ユ牸寮?:         ['IP鍗忚', '缃戠粶灞?],
  '鍒嗙墖涓庨噸缁?:           ['IP鍗忚', '缃戠粶灞?],
  'IPv6鍗忚':             ['IP鍗忚', '缃戠粶灞?],
  'ICMP鍗忚搴旂敤':         ['IP鍗忚', '缃戠粶灞?],
  '闅ч亾鎶€鏈?:             ['缃戠粶灞?],
  '绔彛鍙峰垎閰?:           ['浼犺緭灞?],
  '娴侀噺鎺у埗涓庢嫢濉炴帶鍒跺尯鍒?: ['鎷ュ鎺у埗', 'TCP鍙潬浼犺緭'],
  '瓒呮椂閲嶄紶涓庡揩閫熼噸浼?:   ['TCP鍙潬浼犺緭'],
  '閫夋嫨鎬х‘璁ACK':       ['TCP鍙潬浼犺緭'],
  '杩炴帴绠＄悊鐘舵€佽浆鎹?:     ['浼犺緭灞?, 'TCP鍙潬浼犺緭'],
  'WebSocket鍗忚':        ['搴旂敤灞?, 'HTTP鍗忚'],
  '鐢靛瓙閭欢鍗忚':         ['搴旂敤灞?],
  'FTP鍗忚宸ヤ綔鍘熺悊':      ['搴旂敤灞?],
  '鍩熷悕瑙ｆ瀽杩囩▼':         ['DNS绯荤粺', '搴旂敤灞?],
  'CDN鎶€鏈師鐞?:          ['搴旂敤灞?, 'DNS绯荤粺'],
  'VPN鎶€鏈?:              ['缃戠粶瀹夊叏', '缃戠粶灞?],
  '缃戠粶瀹夊叏鏀诲嚮绫诲瀷':     ['缃戠粶瀹夊叏'],

  // 鈺愨晲鈺?鏁版嵁缁撴瀯 鈥?鏂囩尞鍗＄墖 鈫?鏍稿績姒傚康 鈺愨晲鈺?  '涓ヨ敋鏁忋€婃暟鎹粨鏋勩€?:     ['绾挎€ц〃', '鏍?, '鏍?, '鍥?, '鎺掑簭绠楁硶'],
  '閭撲繆杈夈€婃暟鎹粨鏋勪笌绠楁硶銆?: ['绾挎€ц〃', '浜屽弶鏍?, '鏌ユ壘绠楁硶', '鎺掑簭绠楁硶', '鍝堝笇琛?],
  '銆婄畻娉曞璁恒€?:           ['鎺掑簭绠楁硶', '鍥?, '鍝堝笇琛?, '鍫?, '鏍?],
  '銆婂ぇ璇濇暟鎹粨鏋勩€?:       ['绾挎€ц〃', '鏍?, '闃熷垪', '鏍?, '鍥?],
  '鐜嬮亾408鏁版嵁缁撴瀯绡?:      ['绾挎€ц〃', '鏍?, '鏍?, '鍥?, '鎺掑簭绠楁硶'],
  '澶╁嫟鏁版嵁缁撴瀯楂樺垎绗旇':   ['绾挎€ц〃', '浜屽弶鏍?, '鎺掑簭绠楁硶', '鏍?, '闃熷垪'],
  'LeetCode HOT100':        ['绾挎€ц〃', '鏍?, '鍝堝笇琛?, '鍫?, '鍥?],
  '銆婃暟鎹粨鏋勪笌绠楁硶鍒嗘瀽銆?: ['鏍?, '鎺掑簭绠楁硶', '鍝堝笇琛?, '鍫?, '浜屽弶鏍?],

  // 鈺愨晲鈺?璁＄畻鏈虹粍鎴愬師鐞?鈥?鏂囩尞鍗＄墖 鈫?鏍稿績姒傚康 鈺愨晲鈺?  '鍞愭湐椋炪€婅绠楁満缁勬垚鍘熺悊銆?:       ['鍐渚濇浖缁撴瀯', 'CPU娴佹按绾?, '瀛樺偍鍣ㄥ眰娆?, 'Cache', '鎸囦护绯荤粺'],
  '琚佹槬椋庛€婅绠楁満缁勬垚涓庤璁°€?:     ['鍐渚濇浖缁撴瀯', 'CPU娴佹按绾?, '鏁版嵁琛ㄧず', '鎺у埗鍗曞厓', '鎬荤嚎绯荤粺'],
  'Patterson銆婅绠楁満缁勬垚涓庤璁°€?:   ['鍐渚濇浖缁撴瀯', 'CPU娴佹按绾?, '瀛樺偍鍣ㄥ眰娆?, 'Cache', '鎸囦护绯荤粺'],
  '鐜嬮亾408璁＄粍绡?:                  ['鍐渚濇浖缁撴瀯', '鏁版嵁琛ㄧず', 'CPU娴佹按绾?, 'Cache', '涓柇绯荤粺'],
  '澶╁嫟璁＄粍楂樺垎绗旇':               ['鍐渚濇浖缁撴瀯', '鏁版嵁琛ㄧず', 'CPU娴佹按绾?, '瀛樺偍鍣ㄥ眰娆?, '杈撳叆杈撳嚭绯荤粺'],
  'Stallings銆婅绠楁満缁勬垚涓庝綋绯荤粨鏋勩€?: ['鍐渚濇浖缁撴瀯', 'CPU娴佹按绾?, 'Cache', '鎸囦护绯荤粺', '鎬荤嚎绯荤粺'],
  '銆婃暟瀛楄璁″拰璁＄畻鏈轰綋绯荤粨鏋勩€?:    ['鍐渚濇浖缁撴瀯', '鏁版嵁琛ㄧず', '鎺у埗鍗曞厓', 'CPU娴佹按绾?, '鎸囦护绯荤粺'],
  '銆婅绠楁満浣撶郴缁撴瀯閲忓寲鏂规硶銆?:      ['CPU娴佹按绾?, 'Cache', '铏氭嫙瀛樺偍鍣?, '鎸囦护娴佹按绾垮啋闄?, '瀛樺偍鍣ㄥ眰娆?],

  // 鈺愨晲鈺?鎿嶄綔绯荤粺 鈥?鏂囩尞鍗＄墖 鈫?鏍稿績姒傚康 鈺愨晲鈺?  '姹ゅ瓙鐎涖€婅绠楁満鎿嶄綔绯荤粺銆?:   ['杩涚▼涓庣嚎绋?, '鍐呭瓨绠＄悊', '鏂囦欢绯荤粺', '姝婚攣', '鍚屾涓庝簰鏂?],
  '鐜嬮亾408鎿嶄綔绯荤粺绡?:          ['杩涚▼涓庣嚎绋?, '鍐呭瓨绠＄悊', '鏂囦欢绯荤粺', '姝婚攣', '杩涚▼璋冨害'],
  '澶╁嫟鎿嶄綔绯荤粺楂樺垎绗旇':       ['杩涚▼涓庣嚎绋?, '鍐呭瓨绠＄悊', '杩涚▼璋冨害', '鍚屾涓庝簰鏂?, '淇″彿閲忔満鍒?],
  '銆婄幇浠ｆ搷浣滅郴缁熴€?:           ['杩涚▼涓庣嚎绋?, '鍐呭瓨绠＄悊', '鏂囦欢绯荤粺', '姝婚攣', '铏氭嫙鍐呭瓨'],
  '銆婃繁鍏ョ悊瑙inux鍐呮牳銆?:      ['杩涚▼涓庣嚎绋?, '杩涚▼璋冨害', '鍐呭瓨绠＄悊', '鏂囦欢绯荤粺', '璁惧绠＄悊'],
  '銆婃搷浣滅郴缁熸蹇点€?:           ['杩涚▼涓庣嚎绋?, '鍐呭瓨绠＄悊', '鏂囦欢绯荤粺', '姝婚攣', '鍚屾涓庝簰鏂?],
  '銆奓inux鍐呮牳璁捐涓庡疄鐜般€?:    ['杩涚▼涓庣嚎绋?, '杩涚▼璋冨害', '铏氭嫙鍐呭瓨', '杩涚▼閫氫俊', '鏂囦欢绯荤粺'],
  '銆婃搷浣滅郴缁熺湡璞¤繕鍘熴€?:       ['杩涚▼涓庣嚎绋?, '鍐呭瓨绠＄悊', '鏂囦欢绯荤粺', '鍒嗛〉涓庡垎娈?, '璁惧绠＄悊'],

  // 鈺愨晲鈺?璁＄畻鏈虹綉缁?鈥?鏂囩尞鍗＄墖 鈫?鏍稿績姒傚康 鈺愨晲鈺?  '璋㈠笇浠併€婅绠楁満缃戠粶銆?:                ['TCP/IP鍗忚鏍?, '浼犺緭灞?, '缃戠粶灞?, '搴旂敤灞?, '鏁版嵁閾捐矾灞?],
  '鐜嬮亾408璁＄綉绡?:                       ['TCP/IP鍗忚鏍?, '浼犺緭灞?, '缃戠粶灞?, '鏁版嵁閾捐矾灞?, '搴旂敤灞?],
  '澶╁嫟璁＄綉楂樺垎绗旇':                    ['TCP/IP鍗忚鏍?, '浼犺緭灞?, '缃戠粶灞?, '鐗╃悊灞?, '搴旂敤灞?],
  'Kurose銆婅绠楁満缃戠粶鑷《鍚戜笅銆?:         ['搴旂敤灞?, '浼犺緭灞?, '缃戠粶灞?, '鏁版嵁閾捐矾灞?, 'TCP鍙潬浼犺緭'],
  '銆奣CP/IP璇﹁В銆?:                      ['TCP/IP鍗忚鏍?, '浼犺緭灞?, 'TCP鍙潬浼犺緭', 'IP鍗忚', '鎷ュ鎺у埗'],
  '璁＄畻鏈虹綉缁?Andrew Tanenbaum)':        ['鐗╃悊灞?, '鏁版嵁閾捐矾灞?, '缃戠粶灞?, '浼犺緭灞?, '缃戠粶瀹夊叏'],
  '銆婂浘瑙TTP銆?:                        ['搴旂敤灞?, 'HTTP鍗忚', '浼犺緭灞?, 'DNS绯荤粺', '缃戠粶瀹夊叏'],
  '銆婄綉缁滄槸鎬庢牱杩炴帴鐨勩€?:                ['DNS绯荤粺', 'HTTP鍗忚', 'IP鍗忚', '浼犺緭灞?, 'TCP鍙潬浼犺緭'],

}
function linkContent(title: string): string {
  const targets = fleetingToPermanent[title]
  if (!targets || targets.length === 0) {
    return '## ' + title + '\n\n---\n_CS408 Knowledge Graph 鈥?auto-generated seed content_\n'
  }
  return '## ' + title + '\n\n**Related:** ' + [...new Set(targets)].map(t => '[[' + t + ']]').join(', ') + '\n\n---\n_CS408 Knowledge Graph 鈥?auto-generated seed content_\n'
}

// 鈹€鈹€鈹€ Auto-generate fleeting鈫攆leeting edges 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Two fleeting cards that share a common permanent card target should be
// linked to each other, creating a dense web instead of a star topology.
function buildFleetingToFleeting(): Record<string, string[]> {
  // Invert: for each permanent card, list all fleeting cards that reference it
  const permToFleeting = new Map<string, string[]>()
  for (const [fleeting, targets] of Object.entries(fleetingToPermanent)) {
    for (const perm of targets) {
      if (!permToFleeting.has(perm)) permToFleeting.set(perm, [])
      permToFleeting.get(perm)!.push(fleeting)
    }
  }

  // For each pair of fleeting cards sharing a permanent card, add mutual link
  const result: Record<string, string[]> = {}
  for (const [, fleetingList] of permToFleeting) {
    if (fleetingList.length < 2) continue
    for (let i = 0; i < fleetingList.length; i++) {
      for (let j = i + 1; j < fleetingList.length; j++) {
        const a = fleetingList[i]
        const b = fleetingList[j]
        if (!result[a]) result[a] = []
        if (!result[b]) result[b] = []
        if (!result[a].includes(b)) result[a].push(b)
        if (!result[b].includes(a)) result[b].push(a)
      }
    }
  }

  // Hand-picked cross-cutting connections not covered by shared permanent card
  const manualConnections: [string, string][] = [
    // 鏁版嵁缁撴瀯 鈥?绠楁硶鍒嗘瀽鐩稿叧
    ['鍔ㄦ€佽鍒抳s璐績绠楁硶', '鏃堕棿澶嶆潅搴︾殑娓愯繘鍒嗘瀽'],
    ['鍔ㄦ€佽鍒抳s璐績绠楁硶', '閫掑綊绠楁硶鐨勮绠楁ā鍨?],
    ['绋€鐤忕煩闃靛瓨鍌?, '骞夸箟琛ㄧ粨鏋?],
    ['澶栭儴鎺掑簭涓庡璺綊骞?, '澶ф暟鎹甌opK闂'],
    ['鍩烘暟鎺掑簭鎬濇兂', '澶栭儴鎺掑簭涓庡璺綊骞?],

    // 璁＄畻鏈虹粍鎴愬師鐞?鈥?鎬ц兘涓庡苟琛?    ['娴佹按绾挎€ц兘鎸囨爣', '璁＄畻鏈烘€ц兘璇勪环鎸囨爣'],
    ['Amdahl瀹氬緥', '璁＄畻鏈烘€ц兘璇勪环鎸囨爣'],
    ['澶氫綋浜ゅ弶瀛樺偍鍣?, '瀛樺偍鍣ㄧ殑鎵╁睍鎶€鏈?],
    ['纾佺洏瀛樺偍鍣ㄧ粨鏋?, '鍥烘€佺‖鐩楽SD鎶€鏈?],
    ['RAID绛夌骇鍖哄埆', '纾佺洏瀛樺偍鍣ㄧ粨鏋?],

    // 鎿嶄綔绯荤粺 鈥?鍐呭瓨涓庡苟鍙?    ['鏉′欢鍙橀噺涓庝俊鍙烽噺', '浜掓枼閿佷笌鑷棆閿?],
    ['鐢ㄦ埛鎬佷笌鏍稿績鎬佸垏鎹?, '绯荤粺璋冪敤瀹炵幇'],
    ['缂洪〉涓柇澶勭悊', '椤甸潰鍒嗛厤绛栫暐'],
    ['鏂囦欢鍒嗛厤鏂瑰紡瀵规瘮', '绌洪棽绌洪棿绠＄悊'],
    ['鏃ュ織鏂囦欢绯荤粺', '鏂囦欢淇濇姢鏈哄埗'],
    ['SPOOLing绯荤粺', '缂撳啿鎶€鏈?],

    // 璁＄畻鏈虹綉缁?鈥?鍗忚涓庡畨鍏?    ['闅ч亾鎶€鏈?, 'VPN鎶€鏈?],
    ['缃戠粶瀹夊叏鏀诲嚮绫诲瀷', 'VPN鎶€鏈?],
    ['WebSocket鍗忚', 'TCP涓嶶DP鍖哄埆'],
    ['鐢靛瓙閭欢鍗忚', 'FTP鍗忚宸ヤ綔鍘熺悊'],
    ['NAT杞崲', '闅ч亾鎶€鏈?],
    ['CDN鎶€鏈師鐞?, '鍩熷悕瑙ｆ瀽杩囩▼'],
    ['CSMA/CD鍗忚', '浠ュお缃戝抚缁撴瀯'],

    // 璺ㄥ煙 鈥?鏁版嵁缁撴瀯鍦∣S/缃戠粶涓殑搴旂敤
    ['椤靛紡铏氭嫙瀛樺偍鍣ㄥ湴鍧€杞崲', '蹇〃TLB鍘熺悊'],
    ['澶氱骇椤佃〃', '椤靛紡铏氭嫙瀛樺偍鍣ㄥ湴鍧€杞崲'],
    ['鎷ュ鎺у埗绠楁硶', '娴侀噺鎺у埗涓庢嫢濉炴帶鍒跺尯鍒?],
  ]

  for (const [a, b] of manualConnections) {
    if (!result[a]) result[a] = []
    if (!result[b]) result[b] = []
    if (!result[a].includes(b)) result[a].push(b)
    if (!result[b].includes(a)) result[b].push(a)
  }

  return result
}

const fleetingToFleeting = buildFleetingToFleeting()

// Update linkContent to include fleeting鈫攆leeting links
function linkContentV2(title: string): string {
  const permLinks = fleetingToPermanent[title] || []
  const fleetingLinks = fleetingToFleeting[title] || []
  const lines: string[] = ['## ' + title]
  if (permLinks.length > 0) {
    lines.push('', '**Core Concepts:** ' + [...new Set(permLinks)].map(t => '[[' + t + ']]').join(', '))
  }
  if (fleetingLinks.length > 0) {
    lines.push('', '**Related Ideas:** ' + [...new Set(fleetingLinks)].map(t => '[[' + t + ']]').join(', '))
  }
  lines.push('', '---', '_CS408 Knowledge Graph 鈥?auto-generated seed content_')
  return lines.join('\n')
}
// 鈹€鈹€鈹€ End fleeting鈫攆leeting auto-linking 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function randomRecentDate(daysBack: number, minHour = 8, maxHour = 22): Date {
  const d = randomPastDate(daysBack)
  const hour = Math.floor(Math.random() * (maxHour - minHour + 1)) + minHour
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0)
  return d
}

function uniqueByTitle<T extends { title: string | null }>(cards: T[]): T[] {
  const seen = new Set<string>()
  return cards.filter((card) => {
    const key = card.title || ''
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function seedSupportingUiData(userId: string, vaultId: string) {
  const allCards = await prisma.card.findMany({
    where: { vaultId },
    select: { id: true, title: true, type: true },
    orderBy: { createdAt: 'asc' },
  })

  if (allCards.length === 0) return

  const permanentCards = uniqueByTitle(allCards.filter((card) => card.type === 'permanent'))
  const fleetingCards = uniqueByTitle(allCards.filter((card) => card.type === 'fleeting'))
  const literatureCards = uniqueByTitle(allCards.filter((card) => card.type === 'literature'))
  const titleToCard = new Map(allCards.map((card) => [card.title || '', card]))

  await prisma.([
    prisma.learningSession.deleteMany({ where: { userId } }),
    prisma.learningPath.deleteMany({ where: { vaultId } }),
    prisma.vaultCapability.deleteMany({ where: { vaultId } }),
    prisma.agentSession.deleteMany({ where: { vaultId } }),
    prisma.educationProfileHistory.deleteMany({ where: { vaultId } }),
    prisma.pushRecord.deleteMany({ where: { userId } }),
    prisma.vaultMemory.deleteMany({ where: { vaultId, category: 'observation' } }),
  ])

  const capabilitySeeds = [
    { concept: 'Arrays and Lists', masteryLevel: 84, status: 'mastered', strongAreas: ['implementation', 'time complexity'], weakAreas: [] },
    { concept: 'Graphs', masteryLevel: 58, status: 'learning', strongAreas: ['traversal'], weakAreas: ['shortest path', 'topological sort'] },
    { concept: 'CPU Pipeline', masteryLevel: 66, status: 'learning', strongAreas: ['core model'], weakAreas: ['hazard handling'] },
    { concept: 'Virtual Memory', masteryLevel: 47, status: 'learning', strongAreas: ['page replacement'], weakAreas: ['address translation'] },
    { concept: 'TCP Reliability', masteryLevel: 73, status: 'known', strongAreas: ['handshake'], weakAreas: ['congestion control'] },
    { concept: 'DNS', masteryLevel: 41, status: 'learning', strongAreas: ['lookup flow'], weakAreas: ['caching', 'recursive resolution'] },
  ]

  for (const seed of capabilitySeeds) {
    await prisma.vaultCapability.create({
      data: {
        vaultId,
        concept: seed.concept,
        masteryLevel: seed.masteryLevel,
        status: seed.status,
        accessCount: 3 + Math.floor(Math.random() * 8),
        lastAccessed: randomRecentDate(6),
        weakAreas: JSON.stringify(seed.weakAreas),
        strongAreas: JSON.stringify(seed.strongAreas),
      },
    })
  }

  const learningSessions = [
    { domain: 'Data Structures', concept: 'Graph representations', status: 'completed', phase: 'reflect', outcome: 'understood', minutes: 48 },
    { domain: 'Operating Systems', concept: 'Virtual Memory', status: 'completed', phase: 'practice', outcome: 'needs_review', minutes: 36 },
    { domain: 'Computer Networks', concept: 'TCP Reliability', status: 'active', phase: 'explore', outcome: null, minutes: 22 },
  ]

  for (const session of learningSessions) {
    const createdAt = randomRecentDate(9)
    const updatedAt = new Date(createdAt.getTime() + session.minutes * 60 * 1000)
    await prisma.learningSession.create({
      data: {
        userId,
        domain: session.domain,
        concept: session.concept,
        status: session.status,
        phase: session.phase,
        outcome: session.outcome,
        metadata: JSON.stringify({ durationMinutes: session.minutes, source: 'seed-cs408-ui' }),
        createdAt,
        updatedAt,
      },
    })
  }

  const pathSeeds = [
    {
      name: 'CS408 Core Graph',
      topic: 'CS408',
      description: 'Primary demo path for Learn with mixed step states and graph-backed cards.',
      difficulty: 'intermediate',
      source: 'graph',
      steps: [
        { title: 'linked-list', status: 'mastered', mastery: 96, chapter: 'DS Foundations', estimatedMinutes: 20 },
        { title: 'stack', status: 'completed', mastery: 82, chapter: 'DS Foundations', estimatedMinutes: 18 },
        { title: 'graph', status: 'learning', mastery: 54, chapter: 'Graph Focus', estimatedMinutes: 32 },
        { title: 'shortest-path', status: 'available', mastery: 12, chapter: 'Graph Focus', estimatedMinutes: 28 },
        { title: 'topological-sort', status: 'locked', mastery: 0, chapter: 'Graph Focus', estimatedMinutes: 24 },
      ],
    },
    {
      name: 'Systems Review Track',
      topic: 'Systems Review',
      description: 'Cross-domain path spanning architecture, OS, and networking for UI demos.',
      difficulty: 'advanced',
      source: 'ai',
      steps: [
        { title: 'pipeline', status: 'completed', mastery: 78, chapter: 'Architecture', estimatedMinutes: 25 },
        { title: 'virtual-memory', status: 'available', mastery: 38, chapter: 'Operating Systems', estimatedMinutes: 26 },
        { title: 'tcp-reliability', status: 'learning', mastery: 61, chapter: 'Networking', estimatedMinutes: 30 },
        { title: 'dns', status: 'locked', mastery: 0, chapter: 'Networking', estimatedMinutes: 18 },
      ],
    },
  ]

  const createdPaths: { id: string; name: string }[] = []
  for (const pathSeed of pathSeeds) {
    const doneSteps = pathSeed.steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
    const path = await prisma.learningPath.create({
      data: {
        userId,
        vaultId,
        name: pathSeed.name,
        topic: pathSeed.topic,
        description: pathSeed.description,
        difficulty: pathSeed.difficulty,
        source: pathSeed.source,
        status: 'active',
        totalSteps: pathSeed.steps.length,
        doneSteps,
      },
    })
    createdPaths.push({ id: path.id, name: path.name })

    let previousStepId: string | null = null
    for (let index = 0; index < pathSeed.steps.length; index++) {
      const stepSeed = pathSeed.steps[index]
      const linkedCard = titleToCard.get(stepSeed.title)
      const step = await prisma.learningPathStep.create({
        data: {
          pathId: path.id,
          cardId: linkedCard?.id || null,
          order: index + 1,
          title: stepSeed.title,
          description: ${stepSeed.chapter} / ,
          concept: stepSeed.title,
          chapter: stepSeed.chapter,
          status: stepSeed.status,
          mastery: stepSeed.mastery,
          estimatedMinutes: stepSeed.estimatedMinutes,
          prerequisites: previousStepId ? JSON.stringify([previousStepId]) : JSON.stringify([]),
        },
      })
      previousStepId = step.id
    }
  }

  if (createdPaths[0]) {
    const adjustmentHistory = [
      {
        trigger: 'assessment_failed',
        adjustment: {
          type: 'add_review',
          concept: 'Graphs',
          description: 'Insert a focused review step after weak performance on shortest-path comparisons.',
        },
        assessmentRef: { toolName: 'Feynman Test', score: 58, threshold: 60 },
        feedbackText: 'Need one more pass on shortest path tradeoffs.',
      },
      {
        trigger: 'assessment_excellent',
        adjustment: {
          type: 'skip_ahead',
          concept: 'Arrays and Lists',
          description: 'Skip repetitive foundation content and move directly into graph topics.',
        },
        assessmentRef: { toolName: 'MCQ', score: 97, threshold: 95 },
        feedbackText: 'Foundations feel stable, so the path can move faster.',
      },
    ]

    for (const item of adjustmentHistory) {
      await prisma.pathAdjustmentHistory.create({
        data: {
          pathId: createdPaths[0].id,
          trigger: item.trigger,
          adjustment: JSON.stringify(item.adjustment),
          feedback: JSON.stringify({
            feedbackText: item.feedbackText,
            assessmentRef: item.assessmentRef,
          }),
          appliedAt: randomRecentDate(7),
        },
      })
    }
  }

  const profileSnapshot = {
    userId,
    dimensions: {
      depth: { score: 76, confidence: 0.82, evidence: ['High permanent-card ratio', 'Can explain shortest-path tradeoffs in Forge'] },
      breadth: { score: 68, confidence: 0.77, evidence: ['Coverage spans 4 core topics', 'Cross-cluster links are already present'] },
      connection: { score: 71, confidence: 0.79, evidence: ['Galaxy shows multi-cluster edges', 'Links memory management to architecture naturally'] },
      expression: { score: 74, confidence: 0.7, evidence: ['Observation stream mentions clear explanations', 'Recent sessions include concrete examples'] },
      application: { score: 62, confidence: 0.66, evidence: ['Practice is improving but still uneven', 'Push records still target reinforcement'] },
      learning_pace: { score: 69, confidence: 0.74, evidence: ['Recent activity exists across the week', 'Cadence is steady with small dips'] },
    },
    updateHistory: [
      {
        timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000,
        trigger: 'manual',
        dimensionsUpdated: ['depth', 'expression'],
        changes: { depth: { before: 69, after: 73 }, expression: { before: 67, after: 71 } },
      },
      {
        timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
        trigger: 'assessment',
        dimensionsUpdated: ['application', 'connection'],
        changes: { application: { before: 56, after: 62 }, connection: { before: 66, after: 71 } },
      },
      {
        timestamp: Date.now() - 8 * 60 * 60 * 1000,
        trigger: 'session_end',
        dimensionsUpdated: ['learning_pace'],
        changes: { learning_pace: { before: 64, after: 69 } },
      },
    ],
    sessionCount: learningSessions.length,
    totalLearningMinutes: learningSessions.reduce((sum, session) => sum + session.minutes, 0),
    createdAt: Date.now() - 21 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 8 * 60 * 60 * 1000,
  }

  await prisma.educationProfileHistory.create({
    data: {
      vaultId,
      profile: JSON.stringify(profileSnapshot),
      snapshot: JSON.stringify({
        averageScore: 70,
        strongest: ['depth', 'expression'],
        weakest: ['application'],
      }),
      createdAt: randomRecentDate(2),
    },
  })

  const pushRecords = [
    {
      trigger: 'assessment_failed',
      reason: 'Weak shortest-path performance triggered extra review resources.',
      viewedAt: null,
      engagedCount: 0,
      feedback: null,
      resources: [
        { resourceId: 'push-review-graph', type: 'quiz', title: 'Shortest Path Drill Set', content: 'Compare Dijkstra, Floyd, and Bellman-Ford across common scenarios.' },
        { resourceId: 'push-review-note', type: 'document', title: 'Graph Algorithms Quick Notes', content: 'A compact review sheet for prerequisites, use cases, and common mistakes.' },
      ],
    },
    {
      trigger: 'stage_completion',
      reason: 'Strong fundamentals unlocked a more integrated systems practice bundle.',
      viewedAt: randomRecentDate(1),
      engagedCount: 2,
      feedback: {
        engagedResourceIds: ['push-advance-systems'],
        feedbackText: 'Integrated systems tasks were useful and connected multiple areas well.',
      },
      resources: [
        { resourceId: 'push-advance-systems', type: 'code', title: 'OS / Memory / Cache Mixed Practice', content: 'A more engineering-flavored exercise bundle for Forge sessions.' },
        { resourceId: 'push-advance-diagram', type: 'diagram', title: 'Virtual-to-Physical Address Flow', content: 'Pairs nicely with Galaxy and Cognition for a cross-domain demo.' },
      ],
    },
  ]

  for (const record of pushRecords) {
    await prisma.pushRecord.create({
      data: {
        userId,
        resources: JSON.stringify(record.resources),
        trigger: record.trigger,
        reason: record.reason,
        sentAt: randomRecentDate(5),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        viewedAt: record.viewedAt,
        engagedCount: record.engagedCount,
        feedback: record.feedback ? JSON.stringify(record.feedback) : null,
      },
    })
  }

  const observations = [
    'The user is strongest when comparing related concepts rather than recalling isolated facts.',
    'Recent sessions show growing interest in systems topics, especially memory and cache behavior.',
    'Graph ideas are mostly in place, but shortest-path tradeoffs still benefit from repetition.',
    'Learn mode works better when the path exposes explicit next steps instead of broad suggestions.',
    'The study cadence is steady enough to make the dashboard and cognition surfaces feel active.',
    'Recent practice has been good, but post-task reflection is still thinner than the raw activity volume.',
  ]

  for (const text of observations) {
    await prisma.vaultMemory.create({
      data: {
        vaultId,
        key: seed_obs_,
        value: JSON.stringify({ text, category: 'general' }),
        category: 'observation',
        createdAt: randomRecentDate(12),
      },
    })
  }

  const primaryCards = [permanentCards[0], permanentCards[1], fleetingCards[0], literatureCards[0]].filter(Boolean)

  await prisma.agentSession.create({
    data: {
      id: seed-agent-,
      vaultId,
      name: 'CS408 Review Thread',
      messages: JSON.stringify([
        {
          id: 'm1',
          role: 'system',
          content: 'You are helping the user review CS408 topics inside the current vault.',
          timestamp: randomRecentDate(2).toISOString(),
        },
        {
          id: 'm2',
          role: 'user',
          content: 'Help me connect OS memory management with cache behavior and address translation.',
          timestamp: randomRecentDate(2).toISOString(),
        },
        {
          id: 'm3',
          role: 'assistant',
          content: 'We can look at it in four layers: translation, cache locality, page replacement, and process access patterns.',
          timestamp: randomRecentDate(2).toISOString(),
          references: primaryCards.map((card) => ({ title: card?.title, id: card?.id })),
        },
      ]),
      createdAt: randomRecentDate(2),
      updatedAt: randomRecentDate(1),
    },
  })

  console.log(  UI data:  learning paths,  sessions,  pushes)
}
main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

async function seedUser(email: string, name: string) {
  console.log(`\n鈹佲攣鈹?Seeding: ${email} 鈹佲攣鈹乗n`)

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, emailVerified: true },
  })
  console.log(`  User: "${user.name}" <${user.email}> (id: ${user.id})`)

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
    console.log('  Account record created (password: demo123456)')
  }

  let vault = await prisma.vault.findFirst({ where: { userId: user.id } })
  if (vault) {
    vault = await prisma.vault.update({
      where: { id: vault.id },
      data: { name: 'CS408 Knowledge Graph' },
    })
  } else {
    vault = await prisma.vault.create({
      data: { userId: user.id, name: 'CS408 Knowledge Graph' },
    })
  }
  console.log('  Vault: "' + vault.name + '" (id: ' + vault.id + ')')

  const subjects: SubjectDef[] = [subjectDS, subjectCO, subjectOS, subjectCN]
  const clusterMap = new Map<string, string>()

  for (const subject of subjects) {
    let cluster = await prisma.cluster.findFirst({
      where: { vaultId: vault.id, name: subject.name },
    })
    if (!cluster) {
      cluster = await prisma.cluster.create({
        data: { vaultId: vault.id, name: subject.name, color: subject.color },
      })
      console.log('  + Created cluster: "' + subject.name + '" (' + subject.color + ')')
    } else {
      console.log('  鉁?Found cluster: "' + subject.name + '"')
    }
    clusterMap.set(subject.name, cluster.id)
  }

  const relatedMap = buildRelatedTitlesMap()
  const pathSet = new Set<string>()
  let totalCardCount = 0

  for (const subject of subjects) {
    const clusterId = clusterMap.get(subject.name)!
    const allCardDefs: { title: string; type: 'permanent' | 'fleeting' | 'literature'; tags: string[] }[] = [
      ...subject.permanent.map((c) => ({ title: c.title, type: 'permanent' as const, tags: getTags(subject.name, 'permanent', c.tags) })),
      ...subject.fleeting.map((c) => ({ title: c.title, type: 'fleeting' as const, tags: getTags(subject.name, 'fleeting', c.tags) })),
      ...subject.literature.map((c) => ({ title: c.title, type: 'literature' as const, tags: getTags(subject.name, 'literature', c.tags) })),
    ]

    for (const card of allCardDefs) {
      const path = makePath(subject.name, card.title)
      if (pathSet.has(path)) {
        console.warn('  鈿?Duplicate path: "' + path + '" 鈥?skipping')
        continue
      }
      pathSet.add(path)

      const related = relatedMap.get(card.title)
      const content = related
        ? buildContent(card.title, related)
        : linkContentV2(card.title)

      await prisma.card.upsert({
        where: { vaultId_path: { vaultId: vault.id, path } },
        update: { title: card.title, type: card.type, tags: JSON.stringify(card.tags), createdAt: randomPastDate(30), clusterId, content },
        create: { vaultId: vault.id, clusterId, path, title: card.title, content, type: card.type, tags: JSON.stringify(card.tags), createdAt: randomPastDate(30) },
      })
    }
    totalCardCount += allCardDefs.length
    console.log('  ' + subject.name + ': ' + allCardDefs.length + ' cards')
  }

  await prisma.edge.deleteMany({ where: { vaultId: vault.id } })

  const allCards = await prisma.card.findMany({
    where: { vaultId: vault.id },
    select: { id: true, vaultId: true, content: true, title: true },
  })
  const cardsWithLinks = allCards.filter(c => c.content.includes('[['))
  console.log('  Cards with [[WikiLink]]: ' + cardsWithLinks.length + ' / ' + allCards.length)

  const CONCURRENCY = 10
  let syncedCount = 0
  for (let i = 0; i < cardsWithLinks.length; i += CONCURRENCY) {
    const batch = cardsWithLinks.slice(i, i + CONCURRENCY)
    await Promise.allSettled(batch.map(c => syncEdgesFromContent(prisma, c.id, c.vaultId, c.content)))
    syncedCount += batch.length
    process.stdout.write('  \rSyncing: ' + syncedCount + '/' + cardsWithLinks.length + '   ')
  }
  console.log('\r  Syncing: ' + syncedCount + '/' + cardsWithLinks.length + ' done')

  await prisma.vault.update({ where: { id: vault.id }, data: { profileCache: null } })

  const dbEdgeCount = await prisma.edge.count({ where: { vaultId: vault.id } })
  console.log('  Edges: ' + dbEdgeCount + ' (auto-generated from [[WikiLink]])')
  await seedSupportingUiData(user.id, vault.id)

  // 鈹€鈹€ Seed AI observations 鈹€鈹€
  const obsCount = await prisma.vaultMemory.count({ where: { vaultId: vault.id, category: 'observation' } })
  if (obsCount === 0) {
    const observations = [
      '鐢ㄦ埛鍦ㄦ暟鎹粨鏋勬柟闈㈣繘灞曡緝蹇紝鎺掑簭绠楁硶鐨勭悊瑙ｅ拰琛ㄨ揪鑳藉姏绐佸嚭',
      '鍦ㄩ€掑綊闂涓婄粡甯哥姽璞紝寤鸿鍔犲己鍑芥暟璋冪敤鏍堢殑缁冧範',
      '鐢ㄦ埛鍋忓ソ閫氳繃浠ｇ爜绀轰緥鐞嗚В姒傚康锛屾娊璞″畾涔夊悗閰嶅悎鍏蜂綋渚嬪瓙鏁堟灉鏇村ソ',
      '鏈€杩戝涔犲己搴︽湁鎵€涓嬮檷锛屼笂鍛ㄥ钩鍧囨瘡澶?2.5 灏忔椂锛屾湰鍛ㄩ檷鑷?1.2 灏忔椂',
      '鐢ㄦ埛鐨勫叧鑱旇兘鍔涘緢寮猴紝缁忓父鑷彂鍦版妸鏂版蹇靛拰宸叉湁鐭ヨ瘑绫绘瘮',
      '鍦ㄨ绠楁満缃戠粶 OSI 妯″瀷鐨勭悊瑙ｄ笂杩樹笉澶熺郴缁熷寲锛屽缓璁粠鐗╃悊灞傚紑濮嬮€愬眰娣卞叆',
      '鐢ㄦ埛瀵圭紪璇戝師鐞嗚〃鐜板嚭娴撳帤鍏磋叮锛屽彲浠ユ帹鑽愮浉鍏冲涔犺矾寰?,
      '浠ｇ爜涔﹀啓瑙勮寖锛屾敞閲婃竻鏅帮紝琛ㄨ揪鑳藉姏寮猴紝浣嗛」鐩疄鎴樼粡楠屼笉瓒?,
    ]
    for (const text of observations) {
      await prisma.vaultMemory.create({
        data: {
          vaultId: vault.id,
          key: `seed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          value: JSON.stringify({ text, category: 'general' }),
          category: 'observation',
          createdAt: randomPastDate(14),
        },
      })
    }
    console.log('  Observations: ' + observations.length + ' seeded')
  }
}

async function main() {
  console.log('=== CS408 Knowledge Graph Seed (WikiLink) ===')
  await seedUser('morewhy.han@gmail.com', 'More Why')
  await seedUser('demo@axiom.space', 'Demo User')
  console.log()
  console.log('=== Seed Complete ===')
}

