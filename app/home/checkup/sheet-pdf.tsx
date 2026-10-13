'use client'

import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * ใบรายงานผลการตรวจสุขภาพ สำหรับพิมพ์ลงกระดาษ
 *
 * แยกไฟล์จากหน้าจอเพราะ @react-pdf/renderer ทำงานได้เฉพาะฝั่งเบราว์เซอร์
 * หน้า page.tsx จึงโหลดไฟล์นี้แบบ dynamic ssr:false (ผ่าน sheet-pdf-viewer.tsx)
 *
 * ## ทำไมปล่อยให้ขึ้นหน้าใหม่เอง ไม่ได้คำนวณจำนวนบรรทัดต่อหน้า
 *
 * ใบทบทวนรายการยา (reconcile-pdf.tsx) คำนวณจำนวนบรรทัดต่อหน้าไว้ตายตัว เพราะต้อง
 * เติมบรรทัดว่างให้ตารางเต็มหน้าเท่ากันทุกหน้าแบบแบบฟอร์มที่เขียนต่อด้วยมือได้
 * ใบนี้ไม่ต้องการอย่างนั้น และเนื้อหาแต่ละส่วนยาวไม่เท่ากันมาก — วัดจากครั้งที่
 * มาตรวจสุขภาพจริง 12 ครั้ง: สัญญาณชีพมี 1-7 รายการ ผลแล็บมี 0 ถึง 63 รายการ
 * ถ้าคำนวณเองต้องเดาความสูงของส่วนบนให้ถูกทุกกรณี ซึ่งพลาดแล้วจะได้หน้าว่าง
 * หรือเนื้อหาล้นออกนอกขอบ
 *
 * ## ส่วนที่ว่างต้องไม่พิมพ์กรอบเปล่า
 *
 * วัดแล้วแต่ละส่วนมีไม่ครบทุกครั้ง — จาก 12 ครั้งที่สุ่มมา มีสัญญาณชีพ 11 ครั้ง
 * มีผลแล็บ 8 ครั้ง มีการวินิจฉัย 7 ครั้ง และ**มีผลตรวจร่างกายเพียง 2 ครั้ง**
 * ถ้าพิมพ์หัวข้อกับกรอบไว้ทุกส่วนเสมอ ใบส่วนใหญ่จะมีกรอบเปล่าสามกรอบ ซึ่งอ่านแล้ว
 * เหมือนข้อมูลหาย ไม่ใช่เหมือนไม่ได้ตรวจ จึงซ่อนส่วนที่ไม่มีข้อมูลไปเลย
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
 * พอเจอข้อความไทยจึงตัดมั่ว ๆ กลางคำแล้วเติมขีดให้ด้วย เช่น "ตรวจสุข-ภาพ"
 *
 * ลงทะเบียนซ้ำกับ reconcile-pdf.tsx ไม่ได้ทำให้ชนกัน — Font.register กับ
 * registerHyphenationCallback ของ @react-pdf เป็นค่าระดับโมดูล เรียกซ้ำด้วยค่า
 * เดิมจะทับค่าเดิมด้วยของที่เหมือนกัน ที่ต้องแยกไว้เองเพราะใบสองใบไม่ควรต้อง
 * import กันเพียงเพื่อแชร์การตั้งค่าฟอนต์
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

/**
 * ตัวอักษรที่ฟอนต์ไม่มี glyph ให้ — ต้องแทนก่อนพิมพ์ ไม่ปล่อยให้หายเงียบ ๆ
 *
 * ไล่ตัวอักษรทุกตัวที่ขึ้นบนใบนี้ได้จริงเทียบกับ cmap ของ Sarabun (726 codepoint
 * ทั้ง Regular และ Bold) รวม 122.8 ล้านตัวอักษร 185 ชนิด เจอที่ไม่มี glyph 6 ชนิด
 * และทั้งหกเป็นตัวอักษรที่ไม่ควรมีในข้อมูลตั้งแต่ต้น:
 *
 * | ตัว | พบที่ | จำนวน |
 * | --- | --- | --- |
 * | U+FFFD | อาการนำ/ผลตรวจร่างกาย และคำวินิจฉัย | pe/cc 502 จาก 402,241 ครั้งต่อปี · ICD 4 จาก 7,305 รหัส |
 * | U+0015 U+0019 U+001A U+001E U+000C | อาการนำ/ผลตรวจร่างกาย | รวมอยู่ใน 502 ครั้งข้างบน |
 * | U+001E | นามสกุลผู้ป่วย | 1 จาก 628,461 ราย |
 *
 * U+FFFD คือร่องรอยของอักขระที่เสียตอนแปลงรหัสภาษามาก่อนหน้านี้แล้ว เห็นชัดใน
 * คำวินิจฉัยที่เครื่องหมายวรรคตอนหายไป ("Hashimoto&#8239;s thyroiditis" กลายเป็น
 * "Hashimoto�s thyroiditis") ส่วนที่เหลือเป็นอักขระควบคุมที่หลงมาจากการ
 * คัดลอกข้อความ
 *
 * แทนด้วย ? ไม่ได้ลบทิ้งและไม่เดาว่าตัวเดิมคืออะไร — ถ้าลบทิ้ง คนอ่านใบจะไม่รู้
 * ว่าตรงนั้นมีตัวอักษรหายไป และถ้าเดาว่าเป็นเครื่องหมายวรรคตอน (ซึ่งถูกสามในสี่
 * รหัส) ก็เท่ากับเขียนข้อมูลที่ไม่มีในฐานลงบนเอกสารของผู้ป่วย
 *
 * ขึ้นบรรทัด (U+000A) ปัดแคร่ (U+000D) และแท็บ (U+0009) ไม่อยู่ในช่วงที่แทน —
 * ผลตรวจร่างกายเป็นข้อความหลายบรรทัด ถ้าแทนด้วย ? จะกลายเป็นก้อนเดียวอ่านไม่ได้
 */
const UNPRINTABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F�]/g

const printable = (text: string): string => text.replace(UNPRINTABLE, '?')

/** เหมือน printable แต่ยอมรับ null — ช่องที่ไม่มีค่าต้องยังเป็น null ไม่ใช่ '' */
const printableOrNull = (text: string | null): string | null =>
  text == null ? null : printable(text)

export type CheckupSheetVital = { label: string; value: string }

export type CheckupSheetLab = {
  key: string
  /** ใบสั่งตรวจ — ของการตรวจสุขภาพมักเป็นชื่อแพ็กเกจ ใช้เป็นหัวข้อกลุ่ม */
  form: string | null
  name: string
  result: string
  unit: string | null
  normal: string | null
  abnormal: boolean
}

export type CheckupSheetDiagnosis = {
  icd10: string
  name: string | null
  typeName: string | null
}

export type CheckupSheetData = {
  hn: string
  vn: string
  patientName: string
  sex: string
  age: string
  /** สิทธิการรักษา พร้อมรหัสนำหน้า */
  right: string
  /** วันที่ตรวจ แปลงเป็น พ.ศ. มาจากหน้าจอแล้ว */
  date: string
  time: string | null
  department: string | null
  doctor: string | null
  vitals: CheckupSheetVital[]
  diagnoses: CheckupSheetDiagnosis[]
  labs: CheckupSheetLab[]
  /** ผลตรวจร่างกาย/บันทึกแพทย์ (opdscreen.pe) หลายบรรทัด */
  physicalExam: string | null
  printedAt: string
  printedBy: string
}

const COLORS = {
  line: '#64748b',
  soft: '#64748b',
  head: '#e2e8f0',
  danger: '#b91c1c',
  ink: '#1d4ed8',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
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
    marginBottom: 8,
  },
  patientRow: { flexDirection: 'row', flexWrap: 'wrap' },
  patientCell: { marginRight: 16, marginBottom: 1 },
  labelText: { color: COLORS.soft },

  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.ink,
    textDecoration: 'underline',
    marginTop: 6,
    marginBottom: 3,
  },

  /** สัญญาณชีพเรียงเป็นช่อง ๆ ไม่ได้ทำเป็นตาราง — มี 1-7 รายการ ตารางจะโหรงเหรง */
  vitalGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  vitalCell: {
    width: '25%',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderStyle: 'solid',
    padding: 4,
    // ขอบซ้อนกันบาง ๆ แทนการตัดขอบเอง — ช่องสุดท้ายของแถวที่ไม่เต็มจะได้มีกรอบครบ
    marginRight: -1,
    marginBottom: -1,
  },
  vitalLabel: { fontSize: 8, color: COLORS.soft },
  vitalValue: { fontSize: 10, fontWeight: 'bold' },

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
  headText: { fontWeight: 'bold', textAlign: 'center' },

  /** หัวข้อกลุ่มผลแล็บ (ชื่อแพ็กเกจ) คร่อมทุกคอลัมน์ */
  groupCell: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    color: COLORS.ink,
    fontWeight: 'bold',
  },

  labName: { flex: 1 },
  labResult: { width: 96 },
  labUnit: { width: 70 },
  labNormal: { width: 108 },
  abnormalText: { color: COLORS.danger, fontWeight: 'bold' },

  dxCode: { width: 56 },
  dxName: { flex: 1 },
  dxType: { width: 120 },

  peBox: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderStyle: 'solid',
    padding: 5,
  },

  signRow: { flexDirection: 'row', marginTop: 18 },
  signBox: { flex: 1, marginRight: 24 },
  signLine: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    borderBottomStyle: 'solid',
    marginBottom: 3,
    height: 22,
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

/** ผลแล็บเรียงตามใบสั่งตรวจ รักษาลำดับเดิมของแต่ละกลุ่มไว้ */
function groupLabs(labs: CheckupSheetLab[]): { form: string; items: CheckupSheetLab[] }[] {
  const groups: { form: string; items: CheckupSheetLab[] }[] = []
  for (const lab of labs) {
    const form = lab.form ?? 'ผลตรวจทางห้องปฏิบัติการ'
    const last = groups[groups.length - 1]
    if (last != null && last.form === form) last.items.push(lab)
    else groups.push({ form, items: [lab] })
  }
  return groups
}

/**
 * ล้างตัวอักษรที่ฟอนต์ไม่มี glyph ออกจากทุกช่องของใบ
 *
 * ทำที่นี่ ไม่ได้ให้ผู้เรียกล้างมาก่อน — ใบนี้มีช่องข้อความสามสิบกว่าช่อง
 * ถ้าปล่อยให้แต่ละที่ที่สร้างข้อมูลล้างเอง วันหนึ่งจะมีคนเพิ่มช่องใหม่แล้วลืม
 * แล้วไม่มีใครรู้จนกระทั่งเจอใบที่ตัวหนังสือหายไปในมือผู้ป่วย
 */
function cleanData(data: CheckupSheetData): CheckupSheetData {
  return {
    ...data,
    hn: printable(data.hn),
    vn: printable(data.vn),
    patientName: printable(data.patientName),
    sex: printable(data.sex),
    age: printable(data.age),
    right: printable(data.right),
    date: printable(data.date),
    time: printableOrNull(data.time),
    department: printableOrNull(data.department),
    doctor: printableOrNull(data.doctor),
    vitals: data.vitals.map(vital => ({
      label: printable(vital.label),
      value: printable(vital.value),
    })),
    diagnoses: data.diagnoses.map(dx => ({
      icd10: printable(dx.icd10),
      name: printableOrNull(dx.name),
      typeName: printableOrNull(dx.typeName),
    })),
    labs: data.labs.map(lab => ({
      ...lab,
      form: printableOrNull(lab.form),
      name: printable(lab.name),
      result: printable(lab.result),
      unit: printableOrNull(lab.unit),
      normal: printableOrNull(lab.normal),
    })),
    physicalExam: printableOrNull(data.physicalExam),
    printedAt: printable(data.printedAt),
    printedBy: printable(data.printedBy),
  }
}

export function CheckupSheetDocument({ data: raw }: { data: CheckupSheetData }) {
  const data = cleanData(raw)
  const labGroups = groupLabs(data.labs)
  const abnormalCount = data.labs.filter(lab => lab.abnormal).length

  return (
    <Document
      title={`ใบรายงานผลการตรวจสุขภาพ HN ${data.hn}`}
      author="โรงพยาบาลพะเยา"
      creator="pyhos-workbench"
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.hospital}>โรงพยาบาลพะเยา</Text>
        <Text style={styles.title}>ใบรายงานผลการตรวจสุขภาพ</Text>

        <View style={styles.patientBox}>
          <View style={styles.patientRow}>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>HN </Text>
              {data.hn}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>ชื่อ-สกุล </Text>
              {data.patientName}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>เพศ </Text>
              {data.sex}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>อายุ </Text>
              {data.age}
            </Text>
          </View>
          <View style={styles.patientRow}>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>วันที่ตรวจ </Text>
              {data.date}
              {data.time != null && ` ${data.time}`}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>VN </Text>
              {data.vn}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>สิทธิ </Text>
              {data.right}
            </Text>
          </View>
          <View style={styles.patientRow}>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>ห้องตรวจ </Text>
              {data.department ?? '—'}
            </Text>
            <Text style={styles.patientCell}>
              <Text style={styles.labelText}>แพทย์ผู้ตรวจ </Text>
              {data.doctor ?? '—'}
            </Text>
          </View>
        </View>

        {/* ───── สัญญาณชีพ ───── */}
        {data.vitals.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>สัญญาณชีพและการวัดร่างกาย</Text>
            <View style={styles.vitalGrid}>
              {data.vitals.map(vital => (
                <View key={vital.label} style={styles.vitalCell}>
                  <Text style={styles.vitalLabel}>{vital.label}</Text>
                  <Text style={styles.vitalValue}>{vital.value}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ───── ผลแล็บ ───── */}
        {data.labs.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              ผลตรวจทางห้องปฏิบัติการ — {data.labs.length} รายการ
              {abnormalCount > 0 && ` (ผิดปกติ ${abnormalCount} รายการ)`}
            </Text>
            {/* fixed = พิมพ์หัวตารางซ้ำทุกหน้าเมื่อผลแล็บยาวข้ามหน้า (วัดแล้วมีถึง
                63 รายการต่อครั้ง ซึ่งเกินหนึ่งหน้าแน่นอน) */}
            <View style={styles.tableHead} fixed>
              <Text style={[styles.cell, styles.labName, styles.headText]}>รายการตรวจ</Text>
              <Text style={[styles.cell, styles.labResult, styles.headText]}>ผล</Text>
              <Text style={[styles.cell, styles.labUnit, styles.headText]}>หน่วย</Text>
              <Text style={[styles.lastCell, styles.labNormal, styles.headText]}>ค่าอ้างอิง</Text>
            </View>
            {labGroups.map(group => (
              <View key={group.form}>
                {/* wrap=false กับหัวข้อกลุ่มกับบรรทัดแรก — ไม่ให้หัวข้อค้างท้ายหน้า
                    แล้วรายการแรกไปโผล่หน้าถัดไปลำพัง */}
                <View style={styles.row} wrap={false}>
                  <Text style={styles.groupCell}>{group.form}</Text>
                </View>
                {group.items.map(lab => (
                  <View key={lab.key} style={styles.row} wrap={false}>
                    <Text style={[styles.cell, styles.labName]}>{lab.name}</Text>
                    <Text
                      style={
                        lab.abnormal
                          ? [styles.cell, styles.labResult, styles.abnormalText]
                          : [styles.cell, styles.labResult]
                      }
                    >
                      {lab.result}
                      {/* ติดดาวกำกับด้วย ไม่พึ่งแต่สีแดง — ใบนี้ถ่ายเอกสารขาวดำกันเป็นปกติ
                          ถ้าใช้สีอย่างเดียว ผลผิดปกติจะหายไปทั้งใบในสำเนา */}
                      {lab.abnormal && ' *'}
                    </Text>
                    <Text style={[styles.cell, styles.labUnit]}>{lab.unit ?? ''}</Text>
                    <Text style={[styles.lastCell, styles.labNormal]}>{lab.normal ?? ''}</Text>
                  </View>
                ))}
              </View>
            ))}
            {abnormalCount > 0 && (
              <Text style={styles.note}>* ผลที่ห้องปฏิบัติการระบุว่าอยู่นอกช่วงอ้างอิง</Text>
            )}
          </>
        )}

        {/* ───── การวินิจฉัย ───── */}
        {data.diagnoses.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>การวินิจฉัย</Text>
            <View style={styles.tableHead}>
              <Text style={[styles.cell, styles.dxCode, styles.headText]}>รหัส</Text>
              <Text style={[styles.cell, styles.dxName, styles.headText]}>คำวินิจฉัย</Text>
              <Text style={[styles.lastCell, styles.dxType, styles.headText]}>ชนิด</Text>
            </View>
            {data.diagnoses.map(dx => (
              <View key={dx.icd10} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.dxCode]}>{dx.icd10}</Text>
                <Text style={[styles.cell, styles.dxName]}>{dx.name ?? '—'}</Text>
                <Text style={[styles.lastCell, styles.dxType]}>{dx.typeName ?? '—'}</Text>
              </View>
            ))}
          </>
        )}

        {/* ───── ผลตรวจร่างกาย ───── */}
        {data.physicalExam != null && data.physicalExam !== '' && (
          <>
            <Text style={styles.sectionTitle}>ผลการตรวจร่างกาย</Text>
            <View style={styles.peBox}>
              <Text>{data.physicalExam}</Text>
            </View>
          </>
        )}

        <View style={styles.signRow} wrap={false}>
          <View style={styles.signBox}>
            <View style={styles.signLine} />
            <Text style={styles.signText}>แพทย์ผู้ตรวจ</Text>
            <Text style={styles.signText}>({data.doctor ?? '                    '})</Text>
          </View>
          <View style={styles.signBox}>
            <View style={styles.signLine} />
            <Text style={styles.signText}>ผู้รับรายงานผล</Text>
            <Text style={styles.signText}>(                    )</Text>
          </View>
        </View>

        <Text style={styles.note}>
          ข้อมูลในใบนี้ดึงจากฐานข้อมูลโรงพยาบาลตามที่บันทึกไว้ ณ เวลาที่พิมพ์ ·
          ใช้ภายในโรงพยาบาลเท่านั้น
        </Text>

        <View style={styles.footer} fixed>
          <Text>
            พิมพ์โดย {data.printedBy} · {data.printedAt}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `หน้า ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
