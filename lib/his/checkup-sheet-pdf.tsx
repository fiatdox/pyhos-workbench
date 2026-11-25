import 'server-only'
import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as fontkit from 'fontkit'
import dayjs from 'dayjs'
import 'dayjs/locale/th'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type TextProps,
} from '@react-pdf/renderer'
import {
  REPORT,
  bmiLabel,
  bpLabel,
  findings,
  formatValue,
  hasData,
  isNormalLabel,
  refForSex,
  sectionNotes,
  valueOf,
  waistLabel,
  type CheckupPrintout,
  type LabSection as LabSectionDef,
  type LabValue,
  type PrintLine,
  type ReportSection,
} from '@/lib/his/checkup-sheet'

/**
 * ใบรายงานผลการตรวจสุขภาพ (PDF, A4, 2–3 หน้าตามรายการที่ตรวจ) — สร้างที่เซิร์ฟเวอร์
 *
 * หน้าตาตามต้นแบบของ pyhosweb (lib/checkup-results/pdf.tsx): หัว/ท้ายกระดาษซ้ำทุกหน้า,
 * การ์ดข้อมูลผู้รับบริการ, ช่องสัญญาณชีพพร้อมป้ายแปลผล, ผลแล็บแยกหมวดพร้อมกล่อง
 * การแปลผลจากแบบบันทึก, หมวดที่ไม่ได้ตรวจไม่แสดง, ปิดท้ายด้วยสรุปผลและคำแนะนำ
 *
 * ## ทำไมสร้างที่เซิร์ฟเวอร์ ไม่ใช่ในเบราว์เซอร์เหมือนใบเดิม
 *
 * ข้อความไทยยาว ๆ ไม่มีเว้นวรรค ตัวตัดบรรทัดของ @react-pdf ตัดเองไม่ได้ (รู้จักแต่
 * ช่องว่าง) ต้นแบบจึงวัดความกว้างตัวอักษรจริงด้วย fontkit แล้วตัดบรรทัดเองตามรอยต่อคำ
 * (Intl.Segmenter) ซึ่งต้องอ่านไฟล์ฟอนต์จากดิสก์ — ทำได้ที่เซิร์ฟเวอร์เท่านั้น
 */

dayjs.extend(buddhistEra)
const thaiDate = (d: string, format = 'D MMMM BBBB') => dayjs(d).locale('th').format(format)

const PUBLIC_DIR = path.join(process.cwd(), 'public')
// อ่านเป็น buffer — ถ้าส่ง path ตรง ๆ react-pdf ตีความ "D:\..." เป็น URL แล้วโหลดไม่ขึ้น
const LOGO = {
  data: readFileSync(path.join(PUBLIC_DIR, 'images', 'logo-moph.png')),
  format: 'png' as const,
}
const FONT_REGULAR = path.join(PUBLIC_DIR, 'fonts', 'Sarabun-Regular.ttf')
const FONT_BOLD = path.join(PUBLIC_DIR, 'fonts', 'Sarabun-Bold.ttf')
Font.register({
  family: 'Sarabun',
  fonts: [{ src: FONT_REGULAR }, { src: FONT_BOLD, fontWeight: 'bold' }],
})

// ---------- ขนาดและสี ----------

const BASE_SIZE = 9
const LINE_HEIGHT = 1.3
const SMALL = 8
/** A4 กว้าง 595.28pt — ความกว้างช่องคำนวณจากค่าเหล่านี้ ใช้ตัดบรรทัดภาษาไทยเอง */
const PAD_X = 34
const PAGE_H = 841.89
const CONTENT_W = 595.28 - PAD_X * 2
/** ตารางผลแล็บ: รายการ | ผลตรวจ | หน่วย | ค่าอ้างอิง */
const COL = { name: 200, result: 128, unit: 70 }
const COL_REF = CONTENT_W - COL.name - COL.result - COL.unit
const CELL_PAD = 4
/** เผื่อการปัดเศษตอน react-pdf วางตัวอักษร */
const SAFETY = 2

const C = {
  brand: '#0b6b37',
  brandDark: '#143d26',
  brandLight: '#eefaf2',
  ink: '#1d2420',
  muted: '#5f6b66',
  line: '#cfdad3',
  lineSoft: '#e4ebe6',
  headBg: '#f1f6f2',
  red: '#c0261d',
  okBg: '#e3f3e8',
  okInk: '#0b6b37',
  warnBg: '#fff1db',
  warnInk: '#9a5800',
}

// ---------- ภาษาไทยใน react-pdf ----------

// react-pdf ตัดคำแบบใส่ขีด "-" เมื่อขึ้นบรรทัดกลางคำ และรู้จักแต่ช่องว่างเป็นจุดตัด — ปิดการตัดคำของมัน
// ข้อความไทยยาว ๆ (ไม่มีเว้นวรรค) ตัดบรรทัดเองด้วย wrapText() ตามความกว้างช่องที่รู้แน่นอน
//
// หมายเหตุ: ค่านี้เป็นค่าระดับโมดูลของ @react-pdf — ใบอื่นที่สร้างในเบราว์เซอร์
// (reconcile-pdf.tsx) ลงทะเบียนของตัวเองในอีกโปรเซสหนึ่ง จึงไม่ชนกัน
Font.registerHyphenationCallback(word => [word])

/**
 * สระอำ (U+0E33) → นิคหิต + สระอา — ฟอนต์แยกสระอำเป็นสองรูปตอนวาด ทำให้ react-pdf นับตัวอักษร
 * ไม่ตรงแล้วตัวท้ายข้อความหาย ("น้ำหนัก" เหลือ "น้ำหนั") ถ้ามีวรรณยุกต์ให้นิคหิตมาก่อนวรรณยุกต์
 */
const prepThai = (text: string) => text.replace(/([่-๋]?)ำ/g, 'ํ$1า')

const measureFonts = {
  regular: fontkit.openSync(FONT_REGULAR),
  bold: fontkit.openSync(FONT_BOLD),
}
const segmenter = new Intl.Segmenter('th', { granularity: 'word' })

/** ความกว้าง (pt) ของข้อความเมื่อวาดด้วย Sarabun ขนาด size */
function textWidth(text: string, size: number, bold = false) {
  const f = bold ? measureFonts.bold : measureFonts.regular
  return (f.layout(prepThai(text)).advanceWidth * size) / f.unitsPerEm
}

/**
 * ตัดบรรทัดเองตามความกว้าง (pt) — แบ่งที่รอยต่อคำไทย (Intl.Segmenter) และช่องว่าง
 * คืนข้อความที่คั่นบรรทัดด้วย "\n" ซึ่ง react-pdf ขึ้นบรรทัดใหม่ตามนั้นโดยไม่ตัดซ้ำ
 */
function wrapText(text: string, width: number, size = BASE_SIZE, bold = false) {
  width -= SAFETY
  return text
    .split('\n')
    .map(paragraph => {
      const lines: string[] = []
      let line = ''
      for (const { segment } of segmenter.segment(paragraph)) {
        const next = line + segment
        if (line.trim() && textWidth(next.trimEnd(), size, bold) > width) {
          lines.push(line.trimEnd())
          line = segment.trimStart()
        } else line = next
      }
      lines.push(line.trimEnd())
      return lines.join('\n')
    })
    .join('\n')
}

type TextStyle = TextProps['style']

/**
 * Text ที่ผ่าน prepThai() แล้ว — ใช้กับข้อความทุกช่องในเอกสาร
 * w = ความกว้างช่อง (pt) เพื่อตัดบรรทัดเอง (ต้องส่ง size/bold ให้ตรงกับ style)
 */
function T({
  style,
  children,
  w,
  size = BASE_SIZE,
  bold = false,
}: {
  style?: TextStyle
  children?: string | number | false | null
  w?: number
  size?: number
  bold?: boolean
}) {
  const text = children == null || children === false ? '' : String(children)
  return <Text style={style}>{prepThai(w ? wrapText(text, w, size, bold) : text)}</Text>
}

// ---------- รูปแบบ ----------

const s = StyleSheet.create({
  page: {
    paddingTop: 104,
    paddingBottom: 54,
    paddingHorizontal: PAD_X,
    fontFamily: 'Sarabun',
    fontSize: BASE_SIZE,
    color: C.ink,
    lineHeight: LINE_HEIGHT,
  },
  header: { position: 'absolute', top: 24, left: PAD_X, right: PAD_X },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderColor: C.brand,
  },
  logo: { width: 40, height: 40, marginRight: 9 },
  hospital: { fontSize: 14, fontWeight: 'bold', color: C.brand, lineHeight: 1.25, marginBottom: 1 },
  headerMuted: { fontSize: SMALL, color: C.muted, lineHeight: 1.45 },
  docTitle: { fontSize: 12.5, fontWeight: 'bold', color: C.brandDark, textAlign: 'right', marginBottom: 3 },
  docTitleEn: { fontSize: 7.5, color: C.muted, textAlign: 'right', letterSpacing: 1 },
  pageInfo: { fontSize: SMALL, color: C.muted, marginTop: 4 },
  // ยึดด้วย top ไม่ใช่ bottom — ใช้ bottom ร่วมกับ lineHeight ของหน้าแล้ว react-pdf 4.9 ไม่วาดท้ายกระดาษเลย
  footer: {
    position: 'absolute',
    top: PAGE_H - 46,
    left: PAD_X,
    right: PAD_X,
    flexDirection: 'row',
    borderTopWidth: 0.6,
    borderColor: C.line,
    paddingTop: 4,
    fontSize: 7.5,
    color: C.muted,
  },
  card: { borderWidth: 0.8, borderColor: C.line, borderRadius: 4 },
  cardHead: {
    backgroundColor: C.brandLight,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderBottomWidth: 0.8,
    borderColor: C.line,
  },
  cardTitle: { fontWeight: 'bold', color: C.brandDark },
  infoRow: { flexDirection: 'row', paddingVertical: 0.8 },
  infoLabel: { color: C.muted },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginTop: 9, marginBottom: 3 },
  accent: { width: 3, height: 13, backgroundColor: C.brand, marginRight: 6, borderRadius: 1 },
  sectionTitle: { fontSize: 11, fontWeight: 'bold', color: C.brandDark },
  sectionEn: { fontSize: SMALL, color: C.muted, marginLeft: 6 },
  tHead: {
    flexDirection: 'row',
    backgroundColor: C.headBg,
    borderTopWidth: 0.8,
    borderBottomWidth: 0.8,
    borderColor: C.line,
    paddingVertical: 2.5,
    fontSize: SMALL,
    fontWeight: 'bold',
    color: C.muted,
  },
  tRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.4,
    borderColor: C.lineSoft,
    paddingVertical: 1.2,
  },
  tGroup: {
    paddingTop: 4,
    paddingBottom: 1.5,
    paddingHorizontal: CELL_PAD,
    fontSize: SMALL + 0.5,
    fontWeight: 'bold',
    color: C.brand,
  },
  cName: { width: COL.name, paddingHorizontal: CELL_PAD },
  cResult: { width: COL.result, paddingHorizontal: CELL_PAD, textAlign: 'center' },
  cUnit: { width: COL.unit, paddingHorizontal: CELL_PAD, textAlign: 'center', color: C.muted },
  cRef: { width: COL_REF, paddingHorizontal: CELL_PAD, textAlign: 'center', color: C.muted },
  hint: { fontSize: 7.5, color: C.muted },
  abnormal: { color: C.red, fontWeight: 'bold' },
  note: {
    marginTop: 3,
    backgroundColor: '#f6faf7',
    borderLeftWidth: 2.5,
    borderColor: C.brand,
    paddingVertical: 2.5,
    paddingHorizontal: 7,
  },
  noteLabel: { fontSize: SMALL, fontWeight: 'bold', color: C.brand, marginBottom: 1 },
  noteInline: { fontWeight: 'bold', color: C.brand },
  chip: { fontSize: 7.5, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6 },
})

const chipStyle = (label: string) =>
  isNormalLabel(label)
    ? { backgroundColor: C.okBg, color: C.okInk }
    : { backgroundColor: C.warnBg, color: C.warnInk }

const SEX: Record<string, string> = { '1': 'ชาย', '2': 'หญิง' }
const n2 = (v?: number) => (v == null ? undefined : String(Math.round(v * 100) / 100))

// ---------- ส่วนประกอบ ----------

function Header({ d }: { d: CheckupPrintout }) {
  const line = `${d.patient.name}  ·  HN ${d.patient.hn}  ·  วันที่ตรวจ ${thaiDate(d.visitDate)}`
  return (
    <View style={s.header} fixed>
      <View style={s.headerRow}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- Image ของ react-pdf ไม่มี alt */}
        <Image src={LOGO} style={s.logo} />
        <View style={{ flexGrow: 1 }}>
          <T style={s.hospital}>โรงพยาบาลพะเยา</T>
          <T style={s.headerMuted}>Phayao Hospital · สำนักงานปลัดกระทรวงสาธารณสุข</T>
          <T style={s.headerMuted}>269 หมู่ 11 ต.บ้านต๋อม อ.เมืองพะเยา จ.พะเยา 56000 · โทร 054-409-300</T>
        </View>
        <View>
          <T style={s.docTitle}>ใบรายงานผลการตรวจสุขภาพ</T>
          <T style={s.docTitleEn}>HEALTH CHECK-UP REPORT</T>
        </View>
      </View>
      {/* หน้า 2 เป็นต้นไป: บอกว่าเป็นของใคร เผื่อหน้าแยกจากกัน */}
      <Text style={s.pageInfo} render={({ pageNumber }) => (pageNumber > 1 ? prepThai(line) : ' ')} />
    </View>
  )
}

function Footer({ printedAt, printedBy }: { printedAt: string; printedBy: string }) {
  return (
    <View style={s.footer} fixed>
      <View style={{ width: CONTENT_W - 70 }}>
        <Text>
          {prepThai('เอกสารพิมพ์จากระบบ PYHOS Workbench โรงพยาบาลพะเยา · เป็นข้อมูลส่วนบุคคล · ไม่ใช่ใบรับรองแพทย์')}
        </Text>
        <Text>{prepThai(`พิมพ์โดย ${printedBy} · ${printedAt}`)}</Text>
      </View>
      <Text
        style={{ width: 70, textAlign: 'right' }}
        render={({ pageNumber, totalPages }) => prepThai(`หน้า ${pageNumber} / ${totalPages}`)}
      />
    </View>
  )
}

function SectionHead({ no, title, en }: { no: number; title: string; en: string }) {
  return (
    <View style={s.sectionHead}>
      <View style={s.accent} />
      <T style={s.sectionTitle}>{`${no}. ${title}`}</T>
      <T style={s.sectionEn}>{en}</T>
    </View>
  )
}

const INFO_LABEL_W = 74

/** หนึ่งบรรทัดในข้อมูลผู้รับบริการ: ป้าย + ค่า (ตัวหนา ตัดบรรทัดตามความกว้าง) */
function InfoRow({ label, value, width }: { label: string; value?: string; width: number }) {
  return (
    <View style={[s.infoRow, { width }]}>
      <T style={[s.infoLabel, { width: INFO_LABEL_W }]}>{label}</T>
      <T style={{ width: width - INFO_LABEL_W, fontWeight: 'bold' }} w={width - INFO_LABEL_W} bold>
        {value || '-'}
      </T>
    </View>
  )
}

/** "นพ.ชื่อ นามสกุล (ว.12345)" */
const doctorLine = (d: CheckupPrintout) =>
  d.doctor && (d.doctor.license ? `${d.doctor.name} (${d.doctor.license})` : d.doctor.name)

/**
 * ข้อมูลผู้รับบริการ — สองคอลัมน์ + แพทย์ผู้ตรวจเต็มความกว้าง
 * (ต้นแบบมีแถวที่อยู่และโทรศัพท์ด้วย — ตัดออก ดูเหตุผลที่หัว lib/his/checkup-sheet.ts)
 */
function PatientCard({ d }: { d: CheckupPrintout }) {
  const p = d.patient
  const inner = CONTENT_W - 16
  const colW = inner / 2
  const ageSex = [p.age != null ? `${p.age} ปี` : '', p.sex ? SEX[p.sex] : '']
    .filter(Boolean)
    .join(' / ')
  return (
    <View style={s.card} wrap={false}>
      <View style={s.cardHead}>
        <T style={s.cardTitle}>ข้อมูลผู้รับบริการ</T>
      </View>
      <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: colW }}>
            <InfoRow label="ชื่อ - นามสกุล" value={p.name} width={colW} />
            <InfoRow label="HN" value={p.hn} width={colW} />
            <InfoRow label="อายุ / เพศ" value={ageSex} width={colW} />
            <InfoRow label="วันที่ตรวจ" value={thaiDate(d.visitDate)} width={colW} />
          </View>
          <View style={{ width: colW }}>
            <InfoRow label="ประเภทการตรวจ" value={d.program} width={colW} />
            <InfoRow label="หน่วยงาน" value={p.unit} width={colW} />
            <InfoRow label="ตำแหน่ง" value={p.position} width={colW} />
            <InfoRow label="วัตถุประสงค์" value={p.purpose} width={colW} />
          </View>
        </View>
        <InfoRow label="แพทย์ผู้ตรวจ" value={doctorLine(d)} width={inner} />
      </View>
    </View>
  )
}

/** ค่าที่วัดได้หนึ่งช่อง: ป้าย, ค่า + หน่วย, ป้ายแปลผลสี */
function VitalCard({
  label,
  value,
  unit,
  assess,
  width,
}: {
  label: string
  value?: string
  unit: string
  assess?: string
  width: number
}) {
  return (
    <View
      style={{
        width,
        borderWidth: 0.6,
        borderColor: C.line,
        borderRadius: 4,
        paddingHorizontal: 7,
        paddingVertical: 4,
        marginBottom: 6,
      }}
    >
      <T style={{ fontSize: SMALL, color: C.muted }}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <T style={{ fontSize: 13, fontWeight: 'bold' }}>{value ?? '-'}</T>
          {value && <T style={{ fontSize: SMALL, color: C.muted, marginLeft: 3, marginBottom: 2 }}>{unit}</T>}
        </View>
        {assess && <T style={[s.chip, chipStyle(assess), { marginBottom: 2 }]}>{assess}</T>}
      </View>
    </View>
  )
}

function Vitals({ d }: { d: CheckupPrintout }) {
  const v = d.vitals
  const gap = 6
  const w = (CONTENT_W - gap * 2) / 3
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }} wrap={false}>
      <VitalCard label="น้ำหนัก" value={n2(v.weight)} unit="กก." width={w} />
      <VitalCard label="ส่วนสูง" value={n2(v.height)} unit="ซม." width={w} />
      <VitalCard label="ดัชนีมวลกาย (BMI)" value={v.bmi?.toFixed(1)} unit="กก./ม²" assess={bmiLabel(v.bmi)} width={w} />
      <VitalCard
        label="ความดันโลหิต"
        value={v.bps && v.bpd ? `${v.bps}/${v.bpd}` : undefined}
        unit="มม.ปรอท"
        assess={bpLabel(v.bps, v.bpd)}
        width={w}
      />
      <VitalCard label="ชีพจร" value={n2(v.pulse)} unit="ครั้ง/นาที" width={w} />
      <VitalCard label="รอบเอว" value={n2(v.waist)} unit="ซม." assess={waistLabel(v.waist, d.patient.sex)} width={w} />
    </View>
  )
}

/** กล่องการแปลผล (ข้อความจากแบบบันทึก / เกณฑ์ระดับน้ำตาล) */
function NoteBox({ d, sec }: { d: CheckupPrintout; sec: ReportSection }) {
  const notes = sectionNotes(d, sec)
  if (notes.length === 0) return null
  const LABEL = 'การแปลผล: '
  // ป้ายตัวหนากว้างกว่าที่วัดด้วยตัวปกติเล็กน้อย — เผื่อไว้ 6pt
  const w = CONTENT_W - 2.5 - 14 - 6
  const body = notes.map(n => (n.label ? `${n.label}: ${n.text}` : n.text)).join('\n')
  // ตัดบรรทัดทั้งข้อความรวมป้าย แล้วแยกป้ายออกมาเป็นตัวหนา
  const wrapped = wrapText(LABEL + body, w).slice(LABEL.length)
  return (
    <View style={s.note} wrap={false}>
      <Text>
        <Text style={s.noteInline}>{prepThai(LABEL)}</Text>
        {prepThai(wrapped)}
      </Text>
    </View>
  )
}

/** หนึ่งแถวผลแล็บ — ชื่ออังกฤษตามด้วยคำอธิบายภาษาไทยตัวเล็กในบรรทัดเดียวกัน */
function LabRow({ d, line, v }: { d: CheckupPrintout; line: PrintLine; v: LabValue }) {
  return (
    <View style={s.tRow}>
      <Text style={s.cName}>
        {prepThai(line.label)}
        {line.hint && <Text style={s.hint}>{prepThai(`  ${line.hint}`)}</Text>}
      </Text>
      {/* ติดดาวกำกับด้วย ไม่พึ่งแต่สีแดง — ใบนี้ถ่ายเอกสารขาวดำกันเป็นปกติ */}
      <T style={[s.cResult, v.abnormal ? s.abnormal : {}]} w={COL.result - CELL_PAD * 2} bold={v.abnormal}>
        {`${formatValue(v.value)}${v.abnormal ? ' *' : ''}`}
      </T>
      <T style={s.cUnit} w={COL.unit - CELL_PAD * 2}>
        {v.unit ?? ''}
      </T>
      <T style={s.cRef} w={COL_REF - CELL_PAD * 2}>
        {refForSex(v.normal, d.patient.sex) ?? ''}
      </T>
    </View>
  )
}

/**
 * ตารางผลแล็บของหมวด — ไม่ให้ส่วนใดค้างท้ายหน้าลำพัง:
 * หัวข้อหมวด (before) + หัวตาราง + แถวแรก อยู่ด้วยกัน, แถวสุดท้าย + กล่องการแปลผล (after) อยู่ด้วยกัน
 */
function LabTable({
  d,
  sec,
  before,
  after,
}: {
  d: CheckupPrintout
  sec: LabSectionDef
  before?: ReactNode
  after?: ReactNode
}) {
  type Item = { group?: string; line: PrintLine; v: LabValue }
  const items: Item[] = []
  for (const g of sec.groups) {
    const rows = g.lines.map(line => ({ line, v: valueOf(d, line) })).filter(r => r.v)
    rows.forEach((r, i) => items.push({ group: i === 0 ? g.label : undefined, line: r.line, v: r.v! }))
  }
  const render = (it: Item, i: number) => (
    <View key={i} wrap={false}>
      {it.group && <T style={s.tGroup}>{it.group}</T>}
      <LabRow d={d} line={it.line} v={it.v} />
    </View>
  )
  const head = (
    <View style={s.tHead}>
      <T style={s.cName}>รายการตรวจ</T>
      <T style={s.cResult}>ผลตรวจ</T>
      <T style={s.cUnit}>หน่วย</T>
      <T style={s.cRef}>ค่าอ้างอิง</T>
    </View>
  )
  const n = items.length
  // แถวเดียว: ทั้งหมวดเป็นก้อนเดียว
  if (n <= 1)
    return (
      <View wrap={false}>
        {before}
        {head}
        {n === 1 && render(items[0], 0)}
        {after}
      </View>
    )
  return (
    <View>
      <View wrap={false}>
        {before}
        {head}
        {render(items[0], 0)}
      </View>
      {items.slice(1, -1).map((it, i) => render(it, i + 1))}
      <View wrap={false}>
        {render(items[n - 1], n - 1)}
        {after}
      </View>
    </View>
  )
}

/** หมวดที่เป็นข้อความล้วน (เอกซเรย์ / ตรวจตามความเสี่ยง) */
function NoteTable({ d, sec }: { d: CheckupPrintout; sec: ReportSection }) {
  const rows = sec.notes.filter(n => n.key !== 'glucose' && d.notes[n.key as keyof typeof d.notes])
  // หมวดเดียวไม่มีชื่อช่อง (เช่น เอกซเรย์) → กล่องข้อความ
  if (rows.length === 1 && !rows[0].label) return <NoteBox d={d} sec={sec} />
  const labelW = 200
  const textW = CONTENT_W - labelW
  return (
    <View>
      {rows.map((n, i) => (
        <View key={i} style={s.tRow} wrap={false}>
          <T style={{ width: labelW, paddingHorizontal: CELL_PAD }}>{n.label}</T>
          <T style={{ width: textW, paddingHorizontal: CELL_PAD, fontWeight: 'bold' }} w={textW - CELL_PAD * 2} bold>
            {d.notes[n.key as keyof typeof d.notes]}
          </T>
        </View>
      ))}
    </View>
  )
}

function Summary({ d, no }: { d: CheckupPrintout; no: number }) {
  const items = findings(d)
  const w = CONTENT_W - 16
  return (
    <View>
      <SectionHead no={no} title="สรุปผลการตรวจ" en="Summary" />
      <View style={s.card} wrap={false}>
        <View style={s.cardHead}>
          <T style={s.cardTitle}>รายการที่อยู่นอกเกณฑ์ / ควรใส่ใจ</T>
        </View>
        <View style={{ paddingHorizontal: 8, paddingVertical: 5 }}>
          {items.length === 0 ? (
            <T style={{ color: C.okInk, fontWeight: 'bold' }}>ไม่พบรายการที่อยู่นอกเกณฑ์</T>
          ) : (
            items.map((t, i) => (
              <T key={i} w={w}>
                {`${i + 1}. ${t}`}
              </T>
            ))
          )}
        </View>
      </View>
      {(d.notes.conclusion || d.notes.advice) && (
        <View style={[s.card, { marginTop: 8 }]} wrap={false}>
          <View style={s.cardHead}>
            <T style={s.cardTitle}>ข้อสรุปและคำแนะนำ</T>
          </View>
          <View style={{ paddingHorizontal: 8, paddingVertical: 5 }}>
            {d.notes.conclusion && (
              <>
                <T style={s.noteLabel}>ข้อสรุป</T>
                <T w={w}>{d.notes.conclusion}</T>
              </>
            )}
            {d.notes.advice && (
              <>
                <T style={[s.noteLabel, { marginTop: d.notes.conclusion ? 4 : 0 }]}>คำแนะนำ</T>
                <T w={w}>{d.notes.advice}</T>
              </>
            )}
          </View>
        </View>
      )}
      {d.doctor && (
        <View style={{ marginTop: 10, alignItems: 'flex-end' }} wrap={false}>
          <View style={{ alignItems: 'center', minWidth: 200 }}>
            <T style={{ color: C.muted }}>แพทย์ผู้ตรวจ</T>
            <T style={{ fontWeight: 'bold', marginTop: 2 }}>{d.doctor.name}</T>
            {d.doctor.license && (
              <T style={{ fontSize: 8, color: C.muted }}>{`ใบอนุญาตประกอบวิชาชีพเวชกรรม ${d.doctor.license}`}</T>
            )}
          </View>
        </View>
      )}
      <View style={{ marginTop: 8 }} wrap={false}>
        <T style={{ fontSize: 7.5, color: C.muted }} w={CONTENT_W} size={7.5}>
          * ค่าอยู่นอกช่วงค่าอ้างอิงของห้องปฏิบัติการ · ค่าอ้างอิงอาจแตกต่างตามเพศ อายุ และวิธีการตรวจ ผลตรวจนี้ใช้ประกอบการดูแลสุขภาพเบื้องต้น ควรปรึกษาแพทย์เพื่อแปลผลร่วมกับประวัติและการตรวจร่างกาย
        </T>
      </View>
    </View>
  )
}

function CheckupPdf({ d, printedAt, printedBy }: { d: CheckupPrintout; printedAt: string; printedBy: string }) {
  const sections = REPORT.filter(sec => hasData(d, sec))
  const hasVitals = Object.values(d.vitals).some(v => v != null)
  const first = hasVitals ? 2 : 1
  return (
    <Document
      title={`ใบรายงานผลการตรวจสุขภาพ ${thaiDate(d.visitDate, 'D MMM BBBB')}`}
      author="โรงพยาบาลพะเยา"
      subject="Health Check-up Report"
      creator="pyhos-workbench"
      language="th"
    >
      <Page size="A4" style={s.page}>
        {/* หัว/ท้ายกระดาษ (fixed) วางไว้ก่อนเนื้อหา ให้ซ้ำทุกหน้า */}
        <Header d={d} />
        <Footer printedAt={printedAt} printedBy={printedBy} />
        <PatientCard d={d} />

        {hasVitals && (
          <>
            <SectionHead no={1} title="การตรวจร่างกายเบื้องต้น" en="Physical Examination" />
            <Vitals d={d} />
          </>
        )}

        {sections.map((sec, i) =>
          sec.kind === 'lab' ? (
            <LabTable
              key={sec.title}
              d={d}
              sec={sec}
              before={<SectionHead no={first + i} title={sec.title} en={sec.en} />}
              after={<NoteBox d={d} sec={sec} />}
            />
          ) : (
            // หมวดข้อความสั้น — หัวข้อกับเนื้อหาอยู่หน้าเดียวกัน
            <View key={sec.title} wrap={false}>
              <SectionHead no={first + i} title={sec.title} en={sec.en} />
              <NoteTable d={d} sec={sec} />
            </View>
          ),
        )}

        <Summary d={d} no={first + sections.length} />
      </Page>
    </Document>
  )
}

export function renderCheckupSheet(d: CheckupPrintout, printedBy: string) {
  const printedAt = `${new Date().toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  })} น.`
  return renderToBuffer(<CheckupPdf d={d} printedAt={printedAt} printedBy={printedBy} />)
}
