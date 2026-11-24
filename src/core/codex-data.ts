import type { GameId } from './game-interface';

export interface CodexEntry {
  id: string;
  gameId: GameId;
  title: string;
  category: string;
  realParam: string;
  summary: string;
  inGameLink: string;
  diagramSvg: string;
}

export const CODEX_ENTRIES: CodexEntry[] = [
  // ---- 01 Docking ----
  {
    id: 'docking-inertia',
    gameId: 'docking',
    title: '微重力惯性与脉冲制动',
    category: '轨道动力学',
    realParam: '终近对接相对速度 ≤ 0.2 m/s | 轴向容差 ±5°',
    summary: '在几乎无空气阻力的低地球轨道，牛顿第一定律主导一切：点喷推进器获得速度后飞船不会自动减速，必须向反方向喷气制动才能停稳。',
    inGameLink: '游戏中松开推进键飞船仍会滑行，提前“反向点喷”正是真实航天员手动对接的核心手感。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="28" y="34" width="44" height="22" rx="4" fill="#1e3a5f" stroke="#38bdf8" stroke-width="1.5"/><path d="M12 45 L26 45" stroke="#f59e0b" stroke-width="3" stroke-dasharray="3 2"/><path d="M78 45 L160 45" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5 3"/><polygon points="164,45 154,40 154,50" fill="#38bdf8"/><path d="M190 45 L170 45" stroke="#22c55e" stroke-width="2.5"/><rect x="206" y="26" width="52" height="38" rx="5" fill="#162b4a" stroke="#94a3b8" stroke-width="1.5"/><text x="86" y="34" fill="#7dd3fc" font-size="10" font-family="monospace">v = const (无阻力)</text><text x="166" y="75" fill="#4ade80" font-size="10" font-family="monospace">反向脉冲制动</text></svg>`,
  },
  {
    id: 'docking-coas',
    gameId: 'docking',
    title: 'COAS 光学对接十字瞄准靶',
    category: '交会测量',
    realParam: '对接口异体同构周边式 | 12组捕获锁钩',
    summary: '交会对接最后 30 米，激光雷达与光学瞄准靶（COAS）协同工作。当靶标十字完全重合时，意味着平动偏差与俯仰/偏航角同时归零。',
    inGameLink: '开启“原理剖视”可见靶心误差向量：横向漂移与姿态角必须同时收敛到绿区才能完成刚性锁紧。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><circle cx="140" cy="45" r="32" fill="none" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3"/><circle cx="140" cy="45" r="14" fill="rgba(34,197,94,0.16)" stroke="#22c55e" stroke-width="1.5"/><line x1="95" y1="45" x2="185" y2="45" stroke="#38bdf8" stroke-width="1"/><line x1="140" y1="8" x2="140" y2="82" stroke="#38bdf8" stroke-width="1"/><circle cx="144" cy="42" r="3.5" fill="#f59e0b"/><text x="184" y="25" fill="#94a3b8" font-size="10" font-family="monospace">安全捕获窗</text></svg>`,
  },
  {
    id: 'docking-rcs',
    gameId: 'docking',
    title: 'RCS 姿态控制冷气/小推力发动机',
    category: '推进系统',
    realParam: '神舟平移/姿控发动集群 | 毫秒级脉宽调制',
    summary: '飞船周身对称布置多组小推力喷口，通过成对点火产生纯力偶来旋转姿态，或同向点火实现精准平移，且燃料极为珍贵。',
    inGameLink: '关卡 2/3 限制推进剂余量，用“小脉冲+耐心滑行”替代长时间猛喷可大幅节省 Δv 燃料。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><polygon points="110,30 168,36 168,54 110,60" fill="#1e3a5f" stroke="#cbd5e1" stroke-width="1.5"/><path d="M120 30 L120 12" stroke="#38bdf8" stroke-width="2.5"/><path d="M158 60 L158 78" stroke="#38bdf8" stroke-width="2.5"/><path d="M180 28 A26 26 0 0 1 180 62" fill="none" stroke="#fbbf24" stroke-width="2"/><polygon points="180,64 175,55 185,56" fill="#fbbf24"/><text x="195" y="48" fill="#fbbf24" font-size="10" font-family="monospace">力偶旋转 τ</text></svg>`,
  },

  // ---- 02 Solar ----
  {
    id: 'solar-eclipse',
    gameId: 'solar',
    title: '90分钟轨道周期与地影期供电',
    category: '空间能源',
    realParam: '绕地周期 ~92 min | 阳照 ~55 min / 地影 ~37 min',
    summary: '空间站每天经历 16 次日出日落。进入地球本影区后太阳翼瞬间零发电，全站依靠锂离子蓄电池组撑过长达 35 分钟的黑夜。',
    inGameLink: '游戏中每次轨道昼夜轮转都会考验你在阳照期蓄满电池、在阴影期合理限流保核心载荷的能力。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><circle cx="34" cy="45" r="16" fill="#f59e0b"/><circle cx="145" cy="45" r="22" fill="#0ea5e9" opacity="0.85"/><path d="M145 23 L265 18 L265 72 L145 67 Z" fill="rgba(2,6,23,0.75)"/><ellipse cx="145" cy="45" rx="68" ry="34" fill="none" stroke="#38bdf8" stroke-dasharray="4 3" stroke-width="1.5"/><circle cx="204" cy="36" r="4" fill="#ef4444"/><text x="198" y="82" fill="#94a3b8" font-size="10" font-family="monospace">地影区 (仅靠电池)</text></svg>`,
  },
  {
    id: 'solar-cosine',
    gameId: 'solar',
    title: '双自由度追日与余弦发电定律',
    category: '光伏机构',
    realParam: '问天/梦天柔性三结砷化镓翼 | 单翼展开 55 m',
    summary: '太阳能电池帆板接收到的太阳辐照强度与法线夹角 θ 的余弦成正比（P = Pmax · cos θ），空间站配备对日定向机构实时追踪太阳。',
    inGameLink: '旋转太阳翼对准入射光线向量时，余弦效率指针飙升至 100%；角度偏差越大发电衰减越剧烈。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><line x1="40" y1="22" x2="115" y2="48" stroke="#fbbf24" stroke-width="2"/><line x1="48" y1="12" x2="123" y2="38" stroke="#fbbf24" stroke-width="2"/><rect x="125" y="18" width="10" height="56" transform="rotate(-18 130 46)" fill="#f59e0b" stroke="#fef3c7"/><line x1="130" y1="46" x2="88" y2="60" stroke="#38bdf8" stroke-dasharray="3 2"/><text x="165" y="42" fill="#fde68a" font-size="11" font-family="monospace">P = Pmax·cos(θ)</text><text x="165" y="60" fill="#94a3b8" font-size="10">对日夹角越小效率越高</text></svg>`,
  },
  {
    id: 'solar-flare',
    gameId: 'solar',
    title: '负载分级配电与太阳耀斑防护',
    category: '供配电母线',
    realParam: '天宫全站峰值发电 > 100 kW | 100V 高压直流母线',
    summary: '空间站配电系统按优先级分为关键生命保障母线、测控通信母线与可中断科学实验母线；遭遇强烈空间天气时需实施负载卸载保护。',
    inGameLink: '地影缺电或耀斑来袭时，优先保障“环控生保”不断电，临时切掉高功耗实验柜即可稳住母线电压。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="32" width="54" height="26" rx="4" fill="#1e3a5f" stroke="#f59e0b"/><text x="29" y="49" fill="#fde68a" font-size="10" font-family="monospace">100V BUS</text><path d="M74 45 L125 22 M74 45 L125 45 M74 45 L125 68" stroke="#38bdf8" stroke-width="1.8"/><rect x="128" y="12" width="122" height="18" rx="3" fill="rgba(34,197,94,0.2)" stroke="#22c55e"/><text x="136" y="25" fill="#86efac" font-size="10">P1 环控生保 (不可断)</text><rect x="128" y="36" width="122" height="18" rx="3" fill="rgba(56,189,248,0.16)" stroke="#38bdf8"/><text x="136" y="49" fill="#bae6fd" font-size="10">P2 测控通信</text><rect x="128" y="60" width="122" height="18" rx="3" fill="rgba(245,158,11,0.16)" stroke="#f59e0b"/><text x="136" y="73" fill="#fde68a" font-size="10">P3 科学柜 (可卸载)</text></svg>`,
  },

  // ---- 03 EVA ----
  {
    id: 'eva-tether',
    gameId: 'eva',
    title: '出舱安全系绳与三点固定原则',
    category: '舱外活动',
    realParam: '飞天舱外服质量 ~130 kg | 金属伸缩安全绳',
    summary: '太空中一旦脱手漂离空间站将极难返回，航天员严格遵守“双钩交替挂扣”与安全系绳约束，任何时候至少有一个挂钩锁在舱外扶手上。',
    inGameLink: '出舱维修时既可用机械抓手沿扶手移动，也受物理安全系绳最大长度约束，避免漂入深空。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="68" x2="260" y2="68" stroke="#94a3b8" stroke-width="4"/><circle cx="70" cy="68" r="5" fill="#22c55e"/><path d="M70 68 Q115 24 162 44" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4 2"/><circle cx="166" cy="42" r="11" fill="#e2e8f0" stroke="#38bdf8" stroke-width="2"/><text x="188" y="46" fill="#e2e8f0" font-size="10">安全绳约束半径</text></svg>`,
  },
  {
    id: 'eva-thermal',
    gameId: 'eva',
    title: '向阳 +120 °C 与背阴 -100 °C 热控',
    category: '航天服生保',
    realParam: '液冷服毛细水管总长 > 90 m | 多层真空隔热',
    summary: '真空中没有空气传导散热，阳光直射面会飙升至 +120 °C，而进入阴影面会骤降至 -100 °C。舱外服内置水升华器与液冷服循环控温。',
    inGameLink: '跨越空间站明暗交界线时，必须切换液冷散热/加热档位，维持宇航服内核心温度在绿区。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="18" width="120" height="54" fill="rgba(245,158,11,0.22)"/><rect x="140" y="18" width="120" height="54" fill="rgba(56,189,248,0.18)"/><line x1="140" y1="14" x2="140" y2="76" stroke="#f8fafc" stroke-dasharray="4 3"/><text x="42" y="48" fill="#fbbf24" font-size="13" font-family="monospace">+120 °C 阳照</text><text x="158" y="48" fill="#7dd3fc" font-size="13" font-family="monospace">-100 °C 阴影</text></svg>`,
  },
  {
    id: 'eva-airlock',
    gameId: 'eva',
    title: '气闸舱泄压、吸氧排氮与气密检修',
    category: '气闸舱工程',
    realParam: '问天实验舱主气闸舱 | 舱外服工作气压 ~40 kPa',
    summary: '出舱前航天员需在气闸舱吸纯氧排出体内氮气以防减压病，随后抽空舱内空气至真空再打开舱门开展模块化在轨维修。',
    inGameLink: '在氧气耗尽前抵达受损接口、长按完成模块更换并返回安全节点，体验真实太空高危作业节奏。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="24" y="24" width="84" height="42" rx="6" fill="#1e3a5f" stroke="#22c55e" stroke-width="1.5"/><text x="36" y="49" fill="#86efac" font-size="10">101 kPa 舱内</text><rect x="114" y="24" width="66" height="42" rx="6" fill="#172554" stroke="#f59e0b" stroke-width="1.5"/><text x="125" y="49" fill="#fde68a" font-size="10">气闸泄压</text><text x="194" y="49" fill="#94a3b8" font-size="10">0 kPa 真空</text></svg>`,
  },

  // ---- 04 Robotic Arm ----
  {
    id: 'arm-kinematics',
    gameId: 'robotic-arm',
    title: '七自由度空间机械臂逆运动学',
    category: '空间机器人',
    realParam: '天和核心舱大机械臂长 10.2 m | 最大承载 25 吨',
    summary: '空间机械臂模仿人类手臂拥有肩、肘、腕多组回转关节，能够绕开舱体天线与太阳翼，将末端精准送达三维空间任意位姿。',
    inGameLink: '拖动末端目标点或微调关节时，逆运动学解算器会实时计算各连杆角度并检测舱体防碰撞包络。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><circle cx="48" cy="68" r="7" fill="#f59e0b"/><line x1="48" y1="68" x2="122" y2="26" stroke="#cbd5e1" stroke-width="5"/><circle cx="122" cy="26" r="6" fill="#38bdf8"/><line x1="122" y1="26" x2="210" y2="48" stroke="#cbd5e1" stroke-width="4"/><circle cx="210" cy="48" r="6" fill="#22c55e"/><text x="118" y="76" fill="#7dd3fc" font-size="10" font-family="monospace">肩 θ1 · 肘 θ2 · 腕 θ3</text></svg>`,
  },
  {
    id: 'arm-inchworm',
    gameId: 'robotic-arm',
    title: '“尺蠖式”首尾交替爬行转位',
    category: '在轨运维',
    realParam: '两端对称末端执行器 | 舱壁多点目标适配器',
    summary: '机械臂两端完全对称，都能当作“底座”或“抓取手”。通过交替锁定舱壁适配器，它能像尺蠖一样一步步爬遍整个空间站外表面。',
    inGameLink: '关卡 3 中单个臂展够不到目标舱段，你需要先将前端锚定到中转适配器，再切换基座继续跨舱作业！',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="70" x2="260" y2="70" stroke="#64748b" stroke-width="3"/><circle cx="55" cy="70" r="6" fill="#22c55e"/><circle cx="145" cy="70" r="6" fill="#f59e0b"/><circle cx="230" cy="70" r="6" fill="#38bdf8"/><path d="M55 70 L100 26 L145 70" fill="none" stroke="#e2e8f0" stroke-width="4"/><path d="M145 70 L188 26 L230 70" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="4 3"/></svg>`,
  },
  {
    id: 'arm-flex-inertia',
    gameId: 'robotic-arm',
    title: '微重力大质量载荷柔性振动抑制',
    category: '结构动力学',
    realParam: '低速平移 ≤ 0.15 m/s | 实时力矩与应力限幅',
    summary: '失重不代表无惯性！数十吨级的实验舱或大型载荷若被机械臂猛然急停，巨大的惯性会引发连杆低频柔性晃动甚至损伤关节。',
    inGameLink: '快速甩动机械臂会触发绿色→琥珀→红色应力抖动警告，平滑匀速操纵才能拿满 3 星评价。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><path d="M30 45 Q65 15 100 45 T170 45 T240 45" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="3 2"/><path d="M30 45 Q65 36 100 45 T170 45 T240 45" fill="none" stroke="#22c55e" stroke-width="2.2"/><text x="35" y="78" fill="#86efac" font-size="10">平稳加减速 → 抑制柔性振摆</text></svg>`,
  },

  // ---- 05 ECLSS ----
  {
    id: 'eclss-electrolysis',
    gameId: 'eclss',
    title: '电解水制氧与氧分压控制',
    category: '环控生保',
    realParam: '正常氧分压 19.5–23.5 kPa | 2H₂O → 2H₂ + O₂',
    summary: '把地面氧气瓶运上太空成本极高，空间站采用再生水电解制氧，把水分解为供航天员呼吸的 O₂ 与送往萨巴蒂尔反应器的 H₂。',
    inGameLink: '调高电解槽功率可快速补氧，但会消耗净水储量与电力，需要与水回收环路动态配合。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="98" y="20" width="84" height="48" rx="6" fill="#0f294a" stroke="#38bdf8" stroke-width="1.6"/><text x="114" y="48" fill="#e0f2fe" font-size="11" font-family="monospace">电解制氧</text><path d="M24 44 L96 44" stroke="#38bdf8" stroke-width="2.5"/><text x="30" y="36" fill="#7dd3fc" font-size="10">2H₂O</text><path d="M182 32 L252 32" stroke="#22c55e" stroke-width="2.5"/><text x="202" y="25" fill="#86efac" font-size="10">O₂ → 舱内</text><path d="M182 56 L252 56" stroke="#f59e0b" stroke-width="2"/><text x="202" y="72" fill="#fde68a" font-size="10">2H₂ → 反应釜</text></svg>`,
  },
  {
    id: 'eclss-sabatier',
    gameId: 'eclss',
    title: '萨巴蒂尔反应器：把废气变回净水',
    category: '空间化工',
    realParam: 'CO₂ + 4H₂ → CH₄ + 2H₂O | 氧气再生闭环率 > 90%',
    summary: '呼出的 CO₂ 经分子筛收集后，与电解水副产的 H₂ 在催化剂高温下发生萨巴蒂尔反应，重新生成珍贵的液态水，大幅减少地面补给。',
    inGameLink: '同时开启 CO₂ 捕获与萨巴蒂尔反应釜，能看到废气管里的橙色分子转为蓝色净水流回储水罐！',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="86" y="20" width="108" height="48" rx="8" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5"/><text x="98" y="42" fill="#fde68a" font-size="10" font-family="monospace">CO₂ + 4H₂</text><text x="98" y="58" fill="#7dd3fc" font-size="10" font-family="monospace">→ CH₄ + 2H₂O</text><path d="M20 44 L84 44" stroke="#f59e0b" stroke-width="2"/><path d="M196 44 L260 44" stroke="#38bdf8" stroke-width="2.5"/></svg>`,
  },
  {
    id: 'eclss-water-cycle',
    gameId: 'eclss',
    title: '冷凝水与尿液蒸馏水循环再生',
    category: '资源闭环',
    realParam: '天宫水资源综合回收率 > 95% | 航天员日耗水 ~2.5 L',
    summary: '航天员呼吸与出汗产生的水汽通过冷凝换热器回收，尿液则经真空旋转蒸馏与多级过滤提纯，达到饮用级纯水标准并重新送入电解制氧。',
    inGameLink: '当乘组进行太空健身或 6 人轮换满载时，及时拉高冷凝与水回收功率是维持闭环不枯竭的关键。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="45" rx="90" ry="28" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6 3"/><circle cx="50" cy="45" r="10" fill="#0ea5e9"/><circle cx="140" cy="17" r="10" fill="#22c55e"/><circle cx="230" cy="45" r="10" fill="#f59e0b"/><text x="108" y="50" fill="#e2e8f0" font-size="10">水回收率 &gt; 95%</text></svg>`,
  },

  // ---- 06 Debris ----
  {
    id: 'debris-kinetic',
    gameId: 'debris',
    title: '第一宇宙速度下的毫米级杀伤力',
    category: '空间环境',
    realParam: '相对交会速度可达 10–14 km/s | Ek = ½mv²',
    summary: '近地轨道飞行速度高达 7.67 km/s。动能与速度平方成正比，一颗 1 厘米铝珠以 10 km/s 撞击的动能相当于一辆高速行驶的小轿车。',
    inGameLink: '雷达屏上任何进入红色预警盒（Warning Box）的碎片都不可硬扛，必须提前变轨规避。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><line x1="25" y1="45" x2="210" y2="45" stroke="#ef4444" stroke-width="2" stroke-dasharray="5 3"/><circle cx="212" cy="45" r="5" fill="#f87171"/><circle cx="212" cy="45" r="16" fill="none" stroke="#ef4444" opacity="0.5"/><text x="30" y="32" fill="#fca5a5" font-size="11" font-family="monospace">v ≈ 10 km/s  Ek = ½mv²</text></svg>`,
  },
  {
    id: 'debris-hohmann',
    gameId: 'debris',
    title: '霍曼变轨与 Δv 轨控避碰策略',
    category: '轨道力学',
    realParam: '规避点火仅需 Δv ≈ 0.5–1.5 m/s | 提前半圈点火',
    summary: '空间站无法像战斗机一样急转弯，而是通过主发动机沿切向加速（抬高对侧远地点）或减速（降低轨道），错开与碎片的时空交会窗口。',
    inGameLink: '在碎片到来前适时点击“升轨/降轨 Δv 脉冲”，观察绿色预测轨道如何优雅地绕过红黄危险区。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><path d="M20 62 Q140 58 260 62" fill="none" stroke="#64748b" stroke-width="1.8" stroke-dasharray="4 3"/><path d="M20 62 Q140 16 260 36" fill="none" stroke="#22c55e" stroke-width="2.4"/><rect x="155" y="48" width="28" height="22" fill="rgba(239,68,68,0.28)" stroke="#ef4444"/><text x="45" y="28" fill="#86efac" font-size="10" font-family="monospace">+Δv 切向点火升轨避碰</text></svg>`,
  },
  {
    id: 'debris-drag',
    gameId: 'debris',
    title: '高层大气阻力与轨道维持再抬升',
    category: '轨道维持',
    realParam: '400 km 轨道日均自然衰减 ~50–100 m',
    summary: '400 公里高空仍存在稀薄大气分子，太阳活动剧烈时高层大气受热膨胀，阻力倍增，空间站必须定期点火补高以防坠入稠密大气。',
    inGameLink: '关卡 3 遭遇太阳活动增强，你需要一边规避密集碎片，一边防止轨道高度跌破安全下限。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><path d="M25 22 L120 48 L125 26 L230 58" fill="none" stroke="#38bdf8" stroke-width="2.2"/><line x1="20" y1="68" x2="260" y2="68" stroke="#ef4444" stroke-dasharray="4 3"/><text x="145" y="25" fill="#7dd3fc" font-size="10">定期再抬升 (Reboost)</text><text x="165" y="81" fill="#fca5a5" font-size="10">最低安全轨高线</text></svg>`,
  },

  // ---- 07 Botany ----
  {
    id: 'botany-phototropism',
    gameId: 'botany',
    title: '微重力下以“向光性”替代向地性',
    category: '空间生命科学',
    realParam: '蓝光 450 nm 控株型定向 | 红光 660 nm 促光合开花',
    summary: '在地球上植物靠重力辨别上下，太空失重后根茎容易胡乱生长。实验柜利用红蓝 LED 光谱引导茎叶向光伸展并调控开花结籽。',
    inGameLink: '移动光照方位并搭配红蓝光比例，你将亲眼看到拟南芥与小麦幼苗朝着光源弯曲舒展、顺利抽穗！',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="75" y="10" width="56" height="10" rx="3" fill="#3b82f6"/><rect x="145" y="10" width="56" height="10" rx="3" fill="#ef4444"/><polygon points="85,20 190,20 220,76 60,76" fill="rgba(168,85,247,0.14)"/><path d="M140 76 Q135 50 112 34" fill="none" stroke="#22c55e" stroke-width="3"/><circle cx="110" cy="32" r="5" fill="#4ade80"/></svg>`,
  },
  {
    id: 'botany-capillary',
    gameId: 'botany',
    title: '表面张力主导与多孔基质毛细供水',
    category: '空间农学',
    realParam: '微重力无沉降 | 过量自由水会包裹根系致窒息',
    summary: '太空浇水不会顺着土壤往下漏，而是靠表面张力聚成悬浮水球附着在表面。空间栽培盒采用多孔陶粒毛细吸水，精准维持水气平衡。',
    inGameLink: '一次猛浇会产生漂浮水珠并导致根部缺氧告警，少量多次毛细滴灌才能让根系健康呼吸。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><rect x="55" y="54" width="170" height="22" rx="4" fill="#3b2f2f" stroke="#a8a29e"/><circle cx="110" cy="36" r="10" fill="rgba(56,189,248,0.6)" stroke="#7dd3fc"/><circle cx="155" cy="32" r="7" fill="rgba(56,189,248,0.5)" stroke="#7dd3fc"/><text x="66" y="70" fill="#e7e5e4" font-size="10">多孔基质毛细吸水层</text></svg>`,
  },
  {
    id: 'botany-convection',
    gameId: 'botany',
    title: '无对流边界层与微型强制通风',
    category: '微重力传质',
    realParam: '天宫问天柜首次完成水稻“从种子到种子”全周期',
    summary: '失重下冷热空气不会自然对流，植物叶片呼吸释放的气体会滞留在叶面周围形成“静止边界层”，阻碍 CO₂ 补给，必须依靠微型风扇循环气流。',
    inGameLink: '看到叶片泛起灰白静止气膜时开启循环风机，立刻恢复光合速率并加速结籽。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><circle cx="52" cy="45" r="16" fill="#1e3a5f" stroke="#38bdf8" stroke-width="1.5"/><path d="M78 34 Q130 26 190 38" fill="none" stroke="#7dd3fc" stroke-width="2" stroke-dasharray="5 3"/><path d="M78 56 Q130 64 190 52" fill="none" stroke="#7dd3fc" stroke-width="2" stroke-dasharray="5 3"/><ellipse cx="210" cy="45" rx="22" ry="11" fill="#22c55e" opacity="0.8"/><text x="38" y="49" fill="#e0f2fe" font-size="9">FAN</text></svg>`,
  },

  // ---- 08 Zero-G Lab ----
  {
    id: 'zerog-water-lens',
    gameId: 'zero-g-lab',
    title: '天宫课堂：水球光学“一正一反”双成像',
    category: '微重力流体光学',
    realParam: '水球充当凸透镜 | 中心气泡构成凹透镜组合',
    summary: '微重力下水在表面张力作用下缩成完美球体，相当于一枚强凸透镜（成倒立实像）；往水球中心注入空气泡后，中心区形成两个凹透镜串联，折射出正立缩小的虚像！',
    inGameLink: '实验 1 中亲手吹大悬浮水球并向球心注入气泡，调节焦距即可亲眼复现震撼的“一正一反”双像！',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><circle cx="140" cy="45" r="30" fill="rgba(56,189,248,0.28)" stroke="#7dd3fc" stroke-width="2"/><circle cx="140" cy="45" r="11" fill="rgba(5,10,20,0.8)" stroke="#e0f2fe" stroke-width="1.2"/><path d="M35 30 L115 30 L165 56 L245 56" fill="none" stroke="#fbbf24" stroke-width="1.4"/><path d="M35 45 L129 45 L151 45 L245 45" fill="none" stroke="#4ade80" stroke-width="1.4"/><text x="182" y="25" fill="#bae6fd" font-size="10">外倒像 + 内正像</text></svg>`,
  },
  {
    id: 'zerog-spherical-flame',
    gameId: 'zero-g-lab',
    title: '微重力球形冷焰：没有浮力的燃烧',
    category: '微重力燃烧科学',
    realParam: '梦天燃烧科学实验柜 | 扩散主导淡蓝色球形火焰',
    summary: '地面火焰呈泪滴状是因为热空气变轻上升形成浮力对流；太空中失去浮力，火焰向四周均匀扩散呈淡蓝色球体，若无微量气流吹走废气很快就会自我窒息熄灭。',
    inGameLink: '实验 2 中精准调节供氧浓度与微气流速率，既不能吹灭火焰，又要防止 CO₂ 废气壳裹灭球形蓝焰！',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><circle cx="140" cy="45" r="24" fill="rgba(56,189,248,0.3)" stroke="#38bdf8" stroke-width="2"/><circle cx="140" cy="45" r="11" fill="rgba(191,219,254,0.85)"/><line x1="140" y1="68" x2="140" y2="84" stroke="#94a3b8" stroke-width="3"/><text x="176" y="48" fill="#93c5fd" font-size="10">各向同性蓝焰球</text></svg>`,
  },
  {
    id: 'zerog-gyroscope',
    gameId: 'zero-g-lab',
    title: '太空陀螺定轴性与无推进剂姿控（CMG）',
    category: '角动量守恒',
    realParam: '天宫核心舱 6 台控制力矩陀螺 (CMG) | 不耗燃料调姿',
    summary: '高速旋转的陀螺具有极强的定轴性；偏转其转轴会产生反作用控制力矩。真实空间站正是依靠大型控制力矩陀螺群，在不消耗一滴燃料的情况下维持全站姿态稳定！',
    inGameLink: '实验 3 中给飞轮提速并微调陀螺进动角，就能靠纯角动量稳住不断受扰动冲击的悬浮激光平台。',
    diagramSvg: `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg"><ellipse cx="140" cy="45" rx="34" ry="12" fill="rgba(245,158,11,0.24)" stroke="#fbbf24" stroke-width="2"/><line x1="140" y1="14" x2="140" y2="76" stroke="#38bdf8" stroke-width="2.5"/><polygon points="140,10 135,20 145,20" fill="#38bdf8"/><text x="184" y="48" fill="#fde68a" font-size="10" font-family="monospace">角动量 L = Iω</text></svg>`,
  },
];

export function getCodexById(id: string): CodexEntry | undefined {
  return CODEX_ENTRIES.find((c) => c.id === id);
}
