'use client'
import { createContext, useContext, type ReactNode } from 'react'

/**
 * ชิ้นส่วนพื้นฐานของ diagram — บังคับกฎการวาดไว้ในตัว
 *
 * ทำเป็นชิ้นส่วนร่วมแทนการวาด SVG สี่ใบด้วยมือ เพราะกฎของชุดออกแบบที่ใช้
 * (cathrynlavery/diagram-design) เป็นกฎที่ "ห้ามละเมิด" หลายข้อ — เส้น 1px
 * ไม่มีเงา มุม rx=6 พิกัดหาร 4 ลงตัว เส้นเชื่อมต้องตั้งฉากเท่านั้น และป้ายบนเส้น
 * ต้องมีแผ่นทึบรองใต้ ถ้าวาดมือทีละใบ กฎพวกนี้จะเพี้ยนไปคนละแบบตั้งแต่ใบที่สอง
 *
 * สามข้อที่ตั้งใจทำต่างจากชุดออกแบบต้นทาง:
 *
 * 1. สีผูกกับธีมของระบบ ไม่ได้ฝังค่า paper #f5f5f5 / accent #eb6c36 ไว้ตรง ๆ
 *    เพราะหน้านี้อยู่ในแอปที่ผู้ใช้สลับสว่าง/มืดได้ diagram ที่พื้นขาวค้างอยู่บน
 *    ธีมมืดจะเป็นแผ่นสว่างโพลงกลางหน้า ความ "เรียบ" ที่ชุดออกแบบต้องการยังอยู่ครบ
 *    (เส้นผม ไม่มีเงา ไม่มีแสงเรือง สีเน้นสีเดียว) เปลี่ยนแค่ว่าเอาค่าสีมาจากไหน
 *
 * 2. ไม่ใช้ Instrument Serif กับหัวเรื่อง เพราะหัวเรื่องของเราเป็นภาษาไทย
 *    ซึ่งฟอนต์นั้นไม่มีสระและวรรณยุกต์ จะตกไปใช้ฟอนต์สำรองอยู่ดี เท่ากับโหลด
 *    ฟอนต์มาเปล่า ๆ — ใช้หัวเรื่องของแอปตามเดิม
 *
 * 3. ป้ายภาษาไทยใช้ฟอนต์ sans ส่วน mono สงวนไว้ให้ชื่อตารางและชื่อเทคโนโลยี
 *    ตามเจตนาเดิมของชุดออกแบบ (mono = เนื้อหาทางเทคนิค) และเพราะ Geist Mono
 *    ไม่มีอักขระไทย
 *
 * Geist Sans กับ Geist Mono ที่ชุดออกแบบกำหนด โปรเจกต์โหลดไว้แล้วทั้งคู่
 */

/** พิกัดทุกค่าต้องหาร 4 ลงตัว — ชุดออกแบบกำหนดเป็นกริดโครงสร้าง */
export const GRID = 4

/** รัศมีมุมของกล่อง — ชุดออกแบบห้ามเกิน 6-10px */
const NODE_RADIUS = 6

/** รัศมีมุมของข้องอในเส้นเชื่อม */
const ELBOW_RADIUS = 8

export type Point = { x: number; y: number }

/**
 * โทนของกล่อง — คุมสีพื้นและสีเส้น
 *
 * accent ใช้ได้ไม่เกินสองกล่องต่อหนึ่ง diagram ตามกฎของชุดออกแบบ
 * ("ใช้สีเน้นกับห้ากล่องเท่ากับลบสัญญาณทิ้ง") ตัวนับอยู่ที่ DiagramFrame
 */
export type Tone = 'plain' | 'accent' | 'store' | 'external' | 'user'

const TONE: Record<Tone, { fill: string; stroke: string; ink: string; dash?: string }> = {
  plain: { fill: 'var(--diagram-node)', stroke: 'var(--line-soft)', ink: 'var(--ink)' },
  accent: { fill: 'var(--accent-soft)', stroke: 'var(--accent)', ink: 'var(--ink)' },
  store: { fill: 'var(--diagram-node)', stroke: 'var(--line-soft)', ink: 'var(--ink)' },
  external: {
    fill: 'var(--diagram-paper)',
    stroke: 'var(--line-soft)',
    ink: 'var(--ink-2)',
    dash: '4,3',
  },
  user: { fill: 'var(--diagram-paper)', stroke: 'var(--line-soft)', ink: 'var(--ink-2)' },
}

/** ระยะเว้นระหว่างป้ายกับเส้น — ชุดออกแบบกำหนด 6-10px */
const LABEL_GAP = 8

/**
 * ความกว้างของป้ายโดยประมาณ ใช้กำหนดขนาดแผ่นทึบรองใต้
 *
 * นับสระบน สระล่าง และวรรณยุกต์ของไทยเป็นศูนย์ เพราะมันซ้อนอยู่บนตัวอักษรก่อนหน้า
 * ไม่ได้กินความกว้างเพิ่ม ถ้านับรวมด้วย แผ่นทึบของคำอย่าง "อ่าน/เขียน" จะกว้าง
 * เกินจริงจนไปบังเส้นข้างเคียง ส่วนถ้าประมาณแคบไป เส้นจะโผล่ลอดใต้ตัวอักษร
 */
function labelWidth(text: string): number {
  const combining = /[ัิ-ฺ็-๎]/
  let units = 0
  for (const ch of text) if (!combining.test(ch)) units += 1
  return units * 7.4 + 14
}

const SlugContext = createContext('diagram')

/**
 * กรอบของ diagram หนึ่งใบ
 *
 * ทำสัญญาการเข้าถึงให้ครบตามที่ชุดออกแบบกำหนด: role="img", aria-labelledby
 * ชี้ไปที่ title กับ desc, title เป็นลูกตัวแรกและไม่เกิน 60 ตัวอักษร, desc
 * บอกว่า diagram เล่าเรื่องอะไรไม่ใช่บอกว่ารูปทรงวางตรงไหน
 *
 * ครอบด้วยกล่องที่เลื่อนแนวนอนได้เอง ไม่ปล่อยให้ดันหน้าทั้งหน้าให้เลื่อน และ
 * min-width เท่ากับความกว้างของ viewBox เพื่อไม่ให้ตัวอักษรถูกย่อจนอ่านไม่ออก
 * บนจอแคบ — ยอมให้เลื่อนดูแทนการย่อ
 *
 * marker ของหัวลูกศรตั้ง id ตาม slug เพราะ id ใน SVG เป็นของทั้งหน้า
 * ถ้าซ้ำกันสอง diagram หัวลูกศรจะไปอ้างตัวของอีกใบ
 */
export function DiagramFrame({
  slug,
  title,
  desc,
  width,
  height,
  children,
}: {
  slug: string
  title: string
  desc: string
  width: number
  height: number
  children: ReactNode
}) {
  return (
    <SlugContext.Provider value={slug}>
      <div className="overflow-x-auto rounded-xl border border-line">
        <svg
          role="img"
          aria-labelledby={`${slug}-title ${slug}-desc`}
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width, width: '100%', height: 'auto', display: 'block' }}
        >
          <title id={`${slug}-title`}>{title}</title>
          <desc id={`${slug}-desc`}>{desc}</desc>
          <defs>
            <marker
              id={`${slug}-head`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 z" fill="var(--ink-3)" />
            </marker>
            <marker
              id={`${slug}-head-accent`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
            </marker>
          </defs>
          {/* พื้นทึบของ diagram — แผ่นรองป้ายบนเส้นใช้สีเดียวกันนี้ จึงต้องทึบจริง
              ไม่ใช่สีโปร่งที่ทับกันแล้วยังเห็นเส้นลอดผ่าน */}
          <rect x="0" y="0" width={width} height={height} fill="var(--diagram-paper)" />
          {children}
        </svg>
      </div>
    </SlugContext.Provider>
  )
}

/**
 * กล่องหนึ่งใบ
 *
 * เรียงลำดับการวาดตามที่ชุดออกแบบกำหนด: แผ่นทึบรองก่อน แล้วกล่องที่มีสไตล์
 * แล้วชื่อ แล้วป้ายย่อยแบบ mono — แผ่นรองจำเป็นเพราะกล่องโทน accent มีพื้นโปร่ง
 * ถ้าไม่มีแผ่นรอง เส้นที่เดินผ่านด้านหลังจะเห็นลอดผ่านพื้นกล่อง
 */
export function Node({
  x,
  y,
  w,
  h,
  name,
  sub,
  tag,
  tone = 'plain',
}: {
  x: number
  y: number
  w: number
  h: number
  /** ชื่อกล่อง ภาษาไทยได้ ใช้ฟอนต์ sans */
  name: string
  /** ป้ายย่อยทางเทคนิค เช่นชื่อตาราง ใช้ฟอนต์ mono */
  sub?: string
  /** ป้ายประเภทมุมบนซ้าย มุม rx=2 ตามชุดออกแบบ ไม่ใช่แคปซูล */
  tag?: string
  tone?: Tone
}) {
  const t = TONE[tone]
  const hasTag = tag != null
  const nameY = hasTag ? y + h / 2 + 2 : sub ? y + h / 2 - 4 : y + h / 2 + 5
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={NODE_RADIUS} fill="var(--diagram-paper)" />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={NODE_RADIUS}
        fill={t.fill}
        stroke={t.stroke}
        strokeWidth="1"
        strokeDasharray={t.dash}
      />
      {hasTag && (
        <>
          <rect
            x={x + 10}
            y={y + 8}
            width={tag.length * 5.6 + 10}
            height={14}
            rx={2}
            fill="var(--accent-soft)"
          />
          <text
            x={x + 15}
            y={y + 18}
            fill="var(--ink-3)"
            fontFamily="var(--font-geist-mono)"
            fontSize="9"
            letterSpacing="0.4"
          >
            {tag}
          </text>
        </>
      )}
      <text
        x={x + w / 2}
        y={nameY}
        textAnchor="middle"
        fill={t.ink}
        fontFamily="var(--font-app)"
        fontSize="12.5"
        fontWeight="600"
      >
        {name}
      </text>
      {sub && (
        <text
          x={x + w / 2}
          y={nameY + 15}
          textAnchor="middle"
          fill="var(--ink-3)"
          fontFamily="var(--font-geist-mono)"
          fontSize="9.5"
        >
          {sub}
        </text>
      )}
    </g>
  )
}

/**
 * เส้นเชื่อมสองจุด — ตั้งฉากเท่านั้น ห้ามเส้นทแยง
 *
 * ปลายที่ตรงกันทั้งแกน x หรือ y ได้เส้นตรง ที่เหลือได้ข้องอมุมโค้ง r=8 หนึ่งมุม
 * โดย bend บอกว่าจะออกตัวไหนก่อน — 'h' คือวิ่งแนวนอนก่อนแล้วหักลง
 *
 * ป้ายบนเส้นวางบนแผ่นทึบเสมอ และเว้นช่องจากเส้นตามที่ชุดออกแบบกำหนด
 * ป้ายที่แปะทับเส้นตรง ๆ อ่านไม่ออกทั้งป้ายและเส้น
 */
export function Link({
  from,
  to,
  bend = 'h',
  label,
  labelAt,
  tone = 'plain',
  dashed = false,
}: {
  from: Point
  to: Point
  bend?: 'h' | 'v'
  label?: string
  /** ย้ายป้ายเองเมื่อจุดกลางไปทับของอื่น */
  labelAt?: Point
  tone?: 'plain' | 'accent'
  dashed?: boolean
}) {
  const slug = useContext(SlugContext)
  const accent = tone === 'accent'
  const stroke = accent ? 'var(--accent)' : 'var(--ink-3)'
  const marker = accent ? `url(#${slug}-head-accent)` : `url(#${slug}-head)`

  const dx = to.x - from.x
  const dy = to.y - from.y
  let d: string
  if (dx === 0 || dy === 0) {
    d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  } else {
    const r = Math.min(ELBOW_RADIUS, Math.abs(dx) / 2, Math.abs(dy) / 2)
    const sx = Math.sign(dx)
    const sy = Math.sign(dy)
    d =
      bend === 'h'
        ? `M ${from.x} ${from.y} L ${to.x - sx * r} ${from.y} Q ${to.x} ${from.y} ${to.x} ${from.y + sy * r} L ${to.x} ${to.y}`
        : `M ${from.x} ${from.y} L ${from.x} ${to.y - sy * r} Q ${from.x} ${to.y} ${from.x + sx * r} ${to.y} L ${to.x} ${to.y}`
  }

  /**
   * ตำแหน่งป้าย
   *
   * เส้นนอนให้ป้ายคร่อมกลางเส้นได้ เพราะแผ่นทึบตัดเส้นตรงจุดที่ตาไม่ได้ตามอยู่แล้ว
   * แต่เส้นตั้งต้องวางป้ายไว้ "ข้าง" เส้นตามที่ชุดออกแบบกำหนด — ป้ายที่คร่อม
   * เส้นตั้งจะตัดเส้นขาดตรงกลางพอดี กลายเป็นเส้นสองท่อนที่ดูเหมือนคนละเส้น
   *
   * และต้องเป็นจุดกึ่งกลางของช่วง ไม่ใช่ที่ from — ป้ายที่ from จะไปทับขอบ
   * กล่องต้นทางเสมอ ซึ่งเป็นข้อที่เห็นชัดที่สุดเวลาเปิดดูจริง
   */
  const horizontal = dy === 0
  const vertical = dx === 0
  const mid = labelAt ?? {
    x: vertical ? from.x : (from.x + to.x) / 2,
    y: horizontal ? from.y : vertical ? (from.y + to.y) / 2 : bend === 'h' ? from.y : to.y,
  }
  // เว้นข้างเฉพาะเส้นตั้งล้วน ข้องอให้ป้ายไปอยู่บนช่วงนอนซึ่งคร่อมได้
  const beside = vertical

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1"
        strokeDasharray={dashed ? '4,3' : undefined}
        markerEnd={marker}
      />
      {label && <EdgeLabel x={mid.x} y={mid.y} text={label} tone={tone} beside={beside} />}
    </g>
  )
}

/**
 * เส้นเชื่อมแบบสามช่วง — ออกตรง เลี้ยว แล้วเข้าตรง
 *
 * จำเป็นเวลาที่กล่องเดียวแตกเส้นไปหลายกล่องที่อยู่คนละระดับ ถ้าใช้ข้องอเดียว
 * ช่วงสุดท้ายจะกลายเป็นเส้นตั้งวิ่งทาบขอบกล่องปลายทาง ซึ่งอ่านไม่ออกว่าเข้าที่ไหน
 *
 * via คือพิกัดของช่วงกลาง — ให้แต่ละเส้นในชุดเดียวกันใช้ค่าต่างกันอย่างน้อย 12px
 * ตามกฎของชุดออกแบบ เส้นขนานที่ซ้อนกันสนิทจะกลายเป็นเส้นเดียวในสายตาคนอ่าน
 */
export function BusLink({
  from,
  to,
  via,
  label,
  labelAt,
  tone = 'plain',
  dashed = false,
}: {
  from: Point
  to: Point
  /** midX = ออกแนวนอนก่อน · midY = ออกแนวตั้งก่อน */
  via: { midX: number } | { midY: number }
  label?: string
  labelAt?: Point
  tone?: 'plain' | 'accent'
  dashed?: boolean
}) {
  const slug = useContext(SlugContext)
  const accent = tone === 'accent'
  const marker = accent ? `url(#${slug}-head-accent)` : `url(#${slug}-head)`

  let d: string
  if ('midX' in via) {
    const m = via.midX
    const r = Math.min(ELBOW_RADIUS, Math.abs(m - from.x), Math.abs(to.y - from.y) / 2)
    const sy = Math.sign(to.y - from.y)
    const sx2 = Math.sign(to.x - m)
    d =
      `M ${from.x} ${from.y} L ${m - Math.sign(m - from.x) * r} ${from.y}` +
      ` Q ${m} ${from.y} ${m} ${from.y + sy * r}` +
      ` L ${m} ${to.y - sy * r}` +
      ` Q ${m} ${to.y} ${m + sx2 * r} ${to.y}` +
      ` L ${to.x} ${to.y}`
  } else {
    const m = via.midY
    const r = Math.min(ELBOW_RADIUS, Math.abs(m - from.y), Math.abs(to.x - from.x) / 2)
    const sx = Math.sign(to.x - from.x)
    const sy2 = Math.sign(to.y - m)
    d =
      `M ${from.x} ${from.y} L ${from.x} ${m - Math.sign(m - from.y) * r}` +
      ` Q ${from.x} ${m} ${from.x + sx * r} ${m}` +
      ` L ${to.x - sx * r} ${m}` +
      ` Q ${to.x} ${m} ${to.x} ${m + sy2 * r}` +
      ` L ${to.x} ${to.y}`
  }

  /**
   * ป้ายไปอยู่บนช่วงนอน ไม่ใช่บนเลนตั้งตรงกลาง
   *
   * เลนตั้งของเส้นชุดพัดอยู่ห่างกันแค่ 12-16px ป้ายที่คร่อมเลนหนึ่งจะล้นไปบัง
   * เลนข้าง ๆ ทันที — เอาไปไว้บนช่วงนอนซึ่งมีที่ว่างกว่าและตัดเส้นน้อยกว่า
   */
  const mid =
    labelAt ??
    ('midX' in via
      ? { x: (from.x + via.midX) / 2, y: from.y }
      : { x: from.x, y: (from.y + via.midY) / 2 })
  const beside = !('midX' in via)

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={accent ? 'var(--accent)' : 'var(--ink-3)'}
        strokeWidth="1"
        strokeDasharray={dashed ? '4,3' : undefined}
        markerEnd={marker}
      />
      {label && <EdgeLabel x={mid.x} y={mid.y} text={label} tone={tone} beside={beside} />}
    </g>
  )
}

/**
 * ป้ายบนเส้น พร้อมแผ่นทึบรองใต้
 *
 * แยกออกมาเพราะบาง diagram ต้องวางป้ายเองหลังจากวาดเส้นหลายเส้นเสร็จ —
 * ชุดออกแบบกำหนดว่าแผ่นรองต้องไม่ไปทับกล่องที่วาดทีหลัง การวาดป้ายทั้งชุด
 * ก่อนกล่องจึงเป็นลำดับที่ปลอดภัยที่สุด
 */
export function EdgeLabel({
  x,
  y,
  text,
  tone = 'plain',
  beside = false,
}: {
  x: number
  y: number
  text: string
  tone?: 'plain' | 'accent'
  /** true = วางข้างเส้นโดยเว้นช่อง ไม่ใช่คร่อมกลางเส้น */
  beside?: boolean
}) {
  const w = labelWidth(text)
  const left = beside ? x + LABEL_GAP : x - w / 2
  return (
    <g>
      <rect x={left} y={y - 9} width={w} height={18} rx={2} fill="var(--diagram-paper)" />
      <text
        x={left + w / 2}
        y={y + 4}
        textAnchor="middle"
        fill={tone === 'accent' ? 'var(--accent)' : 'var(--ink-2)'}
        fontFamily="var(--font-app)"
        fontSize="10.5"
      >
        {text}
      </text>
    </g>
  )
}

/**
 * หมายเหตุประกอบ — ไม่เกินสองอันต่อหนึ่ง diagram ตามงบของชุดออกแบบ
 *
 * ใช้บอกข้อที่รูปทรงบอกเองไม่ได้ เช่นเส้นนี้เป็นเส้นที่ข้อมูลระบุตัวตนข้ามไม่ได้
 */
export function Callout({
  x,
  y,
  w,
  lines,
}: {
  x: number
  y: number
  w: number
  lines: string[]
}) {
  const h = lines.length * 15 + 16
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={NODE_RADIUS}
        fill="var(--diagram-paper)"
        stroke="var(--accent-line)"
        strokeWidth="1"
      />
      {lines.map((line, index) => (
        <text
          key={index}
          x={x + 10}
          y={y + 20 + index * 15}
          fill="var(--ink-2)"
          fontFamily="var(--font-app)"
          fontSize="10.5"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

/** หัวข้อของโซนในภาพ — ตัวเล็กแบบ mono ตามที่ชุดออกแบบเรียกว่า eyebrow */
export function ZoneLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text
      x={x}
      y={y}
      fill="var(--ink-3)"
      fontFamily="var(--font-geist-mono)"
      fontSize="9.5"
      letterSpacing="0.8"
    >
      {text}
    </text>
  )
}

/** กรอบโซน — เส้นประบาง ๆ ล้อมกลุ่มกล่องที่อยู่เรื่องเดียวกัน */
export function Zone({
  x,
  y,
  w,
  h,
}: {
  x: number
  y: number
  w: number
  h: number
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={NODE_RADIUS}
      fill="none"
      stroke="var(--line-faint)"
      strokeWidth="1"
      strokeDasharray="6,4"
    />
  )
}

/**
 * คำอธิบายสัญลักษณ์ — แถบล่างแนวนอนเท่านั้น
 *
 * ชุดออกแบบห้ามวางลอยอยู่ในพื้นที่ภาพ เพราะมันไปแย่งที่ของเนื้อหาและทำให้
 * คนอ่านเข้าใจว่าเป็นกล่องหนึ่งในระบบ
 */
export function Legend({ items }: { items: { tone: Tone | 'dashed'; label: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-3">
      {items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm border"
            style={
              item.tone === 'dashed'
                ? {
                    background: 'var(--diagram-paper)',
                    borderColor: 'var(--line-soft)',
                    borderStyle: 'dashed',
                  }
                : {
                    background: TONE[item.tone].fill,
                    borderColor: TONE[item.tone].stroke,
                  }
            }
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}
