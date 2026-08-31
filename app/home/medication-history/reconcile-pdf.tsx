'use client'

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'

/**
 * ใบสรุปรายการยา (Med Reconcile) สำหรับพิมพ์ลงกระดาษ
 *
 * แยกไฟล์จากหน้าจอเพราะ @react-pdf/renderer ทำงานได้เฉพาะฝั่งเบราว์เซอร์
 * หน้า page.tsx จึงโหลดไฟล์นี้แบบ dynamic ssr:false
 */

// ฟอนต์ Sarabun (สัญญาอนุญาต OFL) วางไว้ใน public/fonts — ฟอนต์มาตรฐานของ
// @react-pdf ไม่มีอักขระไทย ถ้าไม่ลงทะเบียนฟอนต์นี้ตัวหนังสือจะหายทั้งหน้า
Font.register({
  family: 'Sarabun',
  fonts: [
    { src: '/fonts/Sarabun-Regular.ttf' },
    { src: '/fonts/Sarabun-Bold.ttf', fontWeight: 'bold' },
  ],
})

/** สระบนล่างและวรรณยุกต์ไทย — ต้องติดไปกับพยัญชนะตัวหน้าเสมอ ห้ามขึ้นบรรทัดใหม่ลำพัง */
const THAI_MARKS = /[ัิ-ฺ็-๎]/
const THAI_CHAR = /[฀-๿]/
/** ความยาวคำที่ยอมให้ตัดกลางคำได้ — ยาวกว่านี้ถ้าไม่ตัดจะล้นออกนอกช่อง */
const MAX_UNBROKEN = 24

/**
 * ตัวตัดบรรทัดของ @react-pdf ใช้พจนานุกรมแยกพยางค์ภาษาอังกฤษเป็นค่าตั้งต้น
 * พอเจอข้อความไทยจึงตัดมั่ว ๆ กลางคำแล้วเติมขีดให้ด้วย เช่น "เวลาปว-ดหรือมีไข้"
 *
 * คืนค่าเป็นคำเต็มไม่ให้ตัดกลางคำ — ข้อความไทยจะขึ้นบรรทัดใหม่ที่ช่องว่างเท่านั้น
 * ยกเว้นคำที่ยาวจนล้นช่องจริง ๆ ถึงยอมตัดเป็นพยางค์ (สระกับวรรณยุกต์ติดไปกับพยัญชนะ)
 */
Font.registerHyphenationCallback(word => {
  if (word.length <= MAX_UNBROKEN || !THAI_CHAR.test(word)) return [word]
  const clusters: string[] = []
  for (const char of word) {
    if (clusters.length > 0 && THAI_MARKS.test(char)) clusters[clusters.length - 1] += char
    else clusters.push(char)
  }
  return clusters
})

export type ReconcilePrintItem = {
  drugName: string
  qty: string
  usage: string
  /** รหัสวิธีใช้ยา พิมพ์นำหน้าข้อความเหมือนใบเดิมของโรงพยาบาล */
  usageCode: string | null
  /** วันที่ได้รับล่าสุด แปลงเป็น พ.ศ. มาจากหน้าจอแล้ว */
  date: string
  /** ชื่อครั้งที่รับยา เช่น OPD/คลินิก */
  label: string
  /** แก้ค่าไปจากที่เคยได้รับจริงหรือไม่ — พิมพ์ดาวกำกับไว้ให้เห็น */
  edited: boolean
}

export type ReconcilePrintData = {
  hn: string
  name: string
  age: string
  /** ย้อนหลังกี่เดือน — ใบของผู้ป่วยนอก ถ้าไม่ส่งต้องส่ง periodLabel มาแทน */
  months?: number
  /** ข้อความช่อง "ช่วงข้อมูล" แบบกำหนดเอง เช่น ใบผู้ป่วยในที่นับเป็นวันนอน ไม่ใช่เดือน */
  periodLabel?: string
  /** AN ของการนอนครั้งนี้ — มีเฉพาะใบของผู้ป่วยใน */
  an?: string
  allergies: string[]
  items: ReconcilePrintItem[]
  printedAt: string
  printedBy: string
}

/** จำนวนยาสูงสุดต่อหนึ่งหน้า */
const DRUGS_PER_PAGE = 15

/**
 * จำนวนบรรทัดสูงสุดต่อหน้า นับรวมบรรทัดหัวข้อวันที่ด้วย
 * ถ้านับแต่ยาอย่างเดียว ผู้ป่วยที่ได้ยาคนละวันทุกตัวจะมีหัวข้อแทรกจนล้นหน้า
 */
const ROWS_PER_PAGE = 20

type PrintRow =
  | { kind: 'group'; text: string }
  | { kind: 'drug'; no: number; item: ReconcilePrintItem }
  | { kind: 'blank' }

/**
 * จัดรายการยาเป็นหน้า ๆ โดยจัดกลุ่มตามวันที่ + สถานที่รับยา แบบใบเดิมของโรงพยาบาล
 * กลุ่มที่ยาวข้ามหน้าจะพิมพ์หัวข้อซ้ำพร้อมคำว่า (ต่อ) ไม่ปล่อยให้ยาลอยไม่มีหัวข้อ
 */
function buildPages(items: ReconcilePrintItem[]): PrintRow[][] {
  const pages: PrintRow[][] = []
  let page: PrintRow[] = []
  let drugsOnPage = 0
  let no = 0

  const flush = () => {
    if (page.length === 0) return
    // เติมบรรทัดว่างให้ตารางเต็มหน้าเท่ากันทุกหน้า เหมือนแบบฟอร์มที่เขียนต่อด้วยมือได้
    while (page.length < ROWS_PER_PAGE) page.push({ kind: 'blank' })
    pages.push(page)
    page = []
    drugsOnPage = 0
  }

  let groupKey = ''
  let groupText = ''
  for (const item of items) {
    const key = `${item.date}|${item.label}`
    const startsGroup = key !== groupKey
    if (startsGroup) {
      groupKey = key
      groupText = `วันที่ ${item.date}    ${item.label}`
    }

    // ต้องมีหัวข้อนำถ้าเป็นกลุ่มใหม่ หรือขึ้นหน้าใหม่กลางกลุ่มเดิม
    const needHeader = startsGroup || page.length === 0
    if (
      page.length > 0 &&
      (drugsOnPage + 1 > DRUGS_PER_PAGE || page.length + (needHeader ? 2 : 1) > ROWS_PER_PAGE)
    ) {
      flush()
    }
    if (startsGroup || page.length === 0) {
      page.push({ kind: 'group', text: startsGroup ? groupText : `${groupText} (ต่อ)` })
    }

    no += 1
    page.push({ kind: 'drug', no, item })
    drugsOnPage += 1
  }

  flush()
  // ไม่มียาเลยก็ยังต้องได้หนึ่งหน้าเปล่าไว้เซ็นชื่อ
  return pages.length > 0 ? pages : [Array.from({ length: ROWS_PER_PAGE }, () => ({ kind: 'blank' }) as PrintRow)]
}

const COLORS = {
  line: '#64748b',
  soft: '#64748b',
  head: '#e2e8f0',
  danger: '#b91c1c',
  // ใบเดิมของโรงพยาบาลพิมพ์ชื่อยาและหัวข้อวันที่ด้วยหมึกน้ำเงิน
  ink: '#1d4ed8',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
    // ขนาดตัวอักษรกับระยะขอบตั้งไว้ให้ยา 15 รายการลงได้ครบหนึ่งหน้าเสมอ
    // แม้วิธีใช้ยาจะยาวจนขึ้นสามบรรทัด
    fontSize: 9,
    paddingTop: 24,
    paddingBottom: 44,
    paddingHorizontal: 32,
    color: '#0f172a',
  },
  hospital: { fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  title: { fontSize: 11, textAlign: 'center', marginTop: 2, marginBottom: 8 },
  patientBox: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderStyle: 'solid',
    padding: 5,
    marginBottom: 6,
  },
  patientRow: { flexDirection: 'row', flexWrap: 'wrap' },
  patientCell: { marginRight: 16, marginBottom: 1 },
  labelText: { color: COLORS.soft },
  allergy: { marginTop: 3, color: COLORS.danger, fontWeight: 'bold' },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: COLORS.head,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderStyle: 'solid',
  },
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: COLORS.line,
    borderStyle: 'solid',
  },
  cell: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderRightColor: COLORS.line,
    borderRightStyle: 'solid',
  },
  lastCell: { paddingVertical: 2, paddingHorizontal: 4 },
  // หัวตารางในใบเดิมเป็นตัวหนาขีดเส้นใต้ ไม่ได้ระบายพื้น
  headText: {
    fontWeight: 'bold',
    color: COLORS.ink,
    textAlign: 'center',
    textDecoration: 'underline',
  },
  /** บรรทัดหัวข้อวันที่ + สถานที่รับยา คร่อมทุกคอลัมน์ */
  groupCell: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    color: COLORS.ink,
    fontWeight: 'bold',
  },
  /** บรรทัดว่างที่เติมให้ตารางเต็มหน้า — ต้องสูงเท่าบรรทัดจริงหนึ่งบรรทัด */
  blankCell: { minHeight: 13 },
  drugName: { color: COLORS.ink },
  no: { width: 20, textAlign: 'center' },
  drug: { flex: 1 },
  qty: { width: 52, textAlign: 'center' },
  usage: { width: 176 },
  continueCol: { width: 44 },
  offCol: { width: 30 },
  signRow: { flexDirection: 'row', marginTop: 14 },
  signBox: { flex: 1, marginRight: 24 },
  signLine: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    borderBottomStyle: 'solid',
    marginBottom: 3,
    height: 20,
  },
  signText: { fontSize: 9, color: COLORS.soft, textAlign: 'center' },
  note: { fontSize: 8, color: COLORS.soft, marginTop: 10 },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: COLORS.soft,
  },
})

export function ReconcileDocument({ data }: { data: ReconcilePrintData }) {
  return (
    <Document
      title={`Med Reconcile HN ${data.hn}`}
      author="โรงพยาบาลพะเยา"
      creator="pyhos-workbench"
    >
      {buildPages(data.items).map((pageRows, pageIndex, allPages) => (
      <Page key={pageIndex} size="A4" style={styles.page}>
        <Text style={styles.hospital}>โรงพยาบาลพะเยา</Text>
        <Text style={styles.title}>ใบทบทวนรายการยา (Medication Reconciliation)</Text>

        <View style={styles.patientBox}>
          <View style={styles.patientRow}>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>HN </Text>
              {data.hn}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>ชื่อ-สกุล </Text>
              {data.name}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>อายุ </Text>
              {data.age}
            </Text>
            {data.an && (
              <Text style={styles.patientCell}>
                <Text style={styles.labelText}>AN </Text>
                {data.an}
              </Text>
            )}
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>ช่วงข้อมูล </Text>
              {data.periodLabel ?? `ย้อนหลัง ${data.months} เดือน`}
            </Text>
          </View>
          <Text style={styles.allergy}>
            การแพ้ยา:{' '}
            {data.allergies.length > 0 ? data.allergies.join(', ') : 'ไม่พบประวัติแพ้ยาในระบบ'}
          </Text>
        </View>

        {/* fixed = พิมพ์หัวตารางซ้ำทุกหน้าเมื่อบรรทัดล้นเกินหน้าที่คำนวณไว้ */}
        <View style={styles.tableHead} fixed>
          <Text style={[styles.cell, styles.no, styles.headText]}> </Text>
          <Text style={[styles.cell, styles.drug, styles.headText]}>รายการยา</Text>
          <Text style={[styles.cell, styles.qty, styles.headText]}>จำนวน</Text>
          <Text style={[styles.cell, styles.usage, styles.headText]}>วิธีใช้ยา</Text>
          <Text style={[styles.cell, styles.continueCol, styles.headText]}>Continue</Text>
          <Text style={[styles.lastCell, styles.offCol, styles.headText]}>off</Text>
        </View>

        {pageRows.map((row, index) => {
          // wrap={false} กันไม่ให้ยาหนึ่งรายการถูกหั่นคาบสองหน้า
          if (row.kind === 'group') {
            return (
              <View key={`g-${index}`} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.no]}> </Text>
                <Text style={styles.groupCell}>{row.text}</Text>
              </View>
            )
          }
          if (row.kind === 'blank') {
            // ช่องว่างท้ายตาราง — คงเส้นคั่นทุกคอลัมน์ไว้ให้เขียนเพิ่มด้วยมือได้
            return (
              <View key={`b-${index}`} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.no, styles.blankCell]}> </Text>
                <Text style={[styles.cell, styles.drug, styles.blankCell]}> </Text>
                <Text style={[styles.cell, styles.qty, styles.blankCell]}> </Text>
                <Text style={[styles.cell, styles.usage, styles.blankCell]}> </Text>
                <Text style={[styles.cell, styles.continueCol, styles.blankCell]}> </Text>
                <Text style={[styles.lastCell, styles.offCol, styles.blankCell]}> </Text>
              </View>
            )
          }
          return (
            <View key={`d-${index}`} style={styles.row} wrap={false}>
              <Text style={[styles.cell, styles.no]}>{row.no}</Text>
              <Text style={[styles.cell, styles.drug, styles.drugName]} hyphenationPenalty={9999}>
                {row.item.drugName}
                {row.item.edited ? ' *' : ''}
              </Text>
              <Text style={[styles.cell, styles.qty]}>{row.item.qty || '-'}</Text>
              {/* รูปแบบเดียวกับใบเดิม: รหัสวิธีใช้ แล้วตามด้วยข้อความในวงเล็บ */}
              <Text style={[styles.cell, styles.usage]} hyphenationPenalty={9999}>
                {row.item.usageCode ? `${row.item.usageCode} ` : ''}
                {row.item.usage ? `( ${row.item.usage} )` : row.item.usageCode ? '' : '-'}
              </Text>
              {/* Continue / off เว้นว่างไว้ให้แพทย์ติ๊กบนกระดาษ */}
              <Text style={[styles.cell, styles.continueCol]}> </Text>
              <Text style={[styles.lastCell, styles.offCol]}> </Text>
            </View>
          )
        })}

        {/* ช่องลงชื่อกับหมายเหตุอยู่เฉพาะหน้าสุดท้าย — เซ็นครั้งเดียวจบทั้งใบ */}
        {pageIndex === allPages.length - 1 && (
          <>
            <View style={styles.signRow}>
              <View style={styles.signBox}>
                <View style={styles.signLine} />
                <Text style={styles.signText}>ผู้ทบทวนรายการยา</Text>
              </View>
              <View style={styles.signBox}>
                <View style={styles.signLine} />
                <Text style={styles.signText}>แพทย์ผู้สั่งใช้ยา</Text>
              </View>
              <View style={styles.signBox}>
                <View style={styles.signLine} />
                <Text style={styles.signText}>วันที่</Text>
              </View>
            </View>

            <Text style={styles.note}>
              * = จำนวนหรือวิธีใช้ถูกแก้จากครั้งล่าสุดที่ผู้ป่วยได้รับ · เอกสารนี้พิมพ์จากระบบทบทวนยา
              ยังไม่ได้บันทึกกลับเข้าระบบ HIS · ใช้ภายในโรงพยาบาลเท่านั้น
            </Text>
          </>
        )}

        <View style={styles.footer} fixed>
          <Text>
            HN {data.hn} · พิมพ์ {data.printedAt} โดย {data.printedBy}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `หน้า ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
      ))}
    </Document>
  )
}
