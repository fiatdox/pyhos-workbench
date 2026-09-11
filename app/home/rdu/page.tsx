'use client'
// antd v6 และ @ant-design/icons ใช้ createContext จึงต้องเป็น Client Component
// (การตรวจสิทธิ์ยังทำที่ app/home/rdu/layout.tsx ซึ่งเป็น Server Component)
import Link from 'next/link'
import { Alert, Card, Tag, Typography } from 'antd'
import {
  AlertOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  HeartOutlined,
  MedicineBoxOutlined,
  MonitorOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'

const { Paragraph, Text, Title } = Typography

/**
 * RDU — หน้ารวมตัวชี้วัดการใช้ยาอย่างสมเหตุผล
 *
 * ตัวชี้วัดแบ่งเป็นสามกลุ่มตามที่คณะกรรมการใช้ประชุมกัน: กลุ่มยาปฏิชีวนะ
 * (นับจากการวินิจฉัยต่อครั้งที่มารับบริการ) กลุ่มโรคเรื้อรัง (นับจากทะเบียนผู้ป่วย
 * และรายการยาที่ได้รับ) และกลุ่มผู้ป่วยพิเศษ (จำกัดตามช่วงอายุ) — คนละฐานของ
 * การนับ จึงแยกส่วนกันบนหน้าจอด้วย
 *
 * ทำแล้วสามข้อ (RI, โรคหืด, ผู้ป่วยเด็ก RUA-URI) ที่เหลือเขียนรายการไว้ให้เห็นตรงกัน
 * ก่อนว่าปลายทางคืออะไร — การ์ดที่ยังไม่มีหน้าจอติดป้ายไว้ ไม่ได้ทำเป็นลิงก์ที่กด
 * แล้วไป 404
 */

const ANTIBIOTIC_KPIS = [
  {
    title: 'โรคติดเชื้อทางเดินหายใจส่วนบน (RI)',
    reportHref: '/home/rdu/reports/ri',
    settings: [
      { href: '/home/rdu/settings/ri-icd10', label: 'ตั้งค่ารหัสวินิจฉัย' },
      { href: '/home/rdu/settings/ri-antibiotic', label: 'ตั้งค่ายาปฏิชีวนะ' },
    ],
  },
  {
    title: 'โรคอุจจาระร่วงเฉียบพลัน (AD)',
    desc: 'สัดส่วนครั้งที่ได้รับยาปฏิชีวนะ ในผู้ป่วยที่วินิจฉัยเป็นโรคอุจจาระร่วงเฉียบพลัน',
  },
  {
    title: 'บาดแผลสดจากอุบัติเหตุ (APL)',
    desc: 'สัดส่วนครั้งที่ได้รับยาปฏิชีวนะ ในผู้ป่วยที่มารับบริการด้วยบาดแผลสดจากอุบัติเหตุ',
  },
  {
    title: 'สตรีคลอดปกติครบกำหนดทางช่องคลอด',
    desc: 'สัดส่วนที่ได้รับยาปฏิชีวนะ ในสตรีที่คลอดปกติครบกำหนดทางช่องคลอด',
  },
]

const CHRONIC_KPIS = [
  {
    title: 'ผู้ป่วยโรคหืดที่ได้รับยาสูดพ่นคอร์ติโคสเตียรอยด์',
    // ไม่มีคำอธิบายใต้ชื่อ ต่างจากข้ออื่น — ข้อนี้เปิดหน้ารายงานแล้ว คำนิยามของ
    // ตัวชี้วัดอยู่ในหน้านั้น การเขียนซ้ำบนการ์ดทำให้การ์ดสูงกว่าใบอื่นโดยไม่ได้อะไร
    reportHref: '/home/rdu/reports/asthma',
    /* ชี้ทางเข้าหน้าตั้งค่าไว้บนการ์ดด้วย ไม่ให้ต้องไปหาเองว่าทะเบียนที่ข้อนี้ใช้
       อยู่ที่ไหน — ทุกข้อใช้สองทะเบียน ตัวหารคือรหัสวินิจฉัย ตัวตั้งคือรายการยา */
    settings: [
      { href: '/home/rdu/settings/asthma-icd10', label: 'ตั้งค่ารหัสวินิจฉัย' },
      { href: '/home/rdu/settings/inhaler', label: 'ตั้งค่ารายการยา' },
    ],
  },
  {
    title: 'การใช้ยา NSAIDs ในผู้ป่วยโรคไตเรื้อรัง',
    desc: 'สัดส่วนผู้ป่วยโรคไตเรื้อรังระดับ 3 ขึ้นไปที่ได้รับยากลุ่ม NSAIDs',
  },
  {
    title: 'การใช้ยา glibenclamide ในผู้สูงอายุ',
    desc: 'สัดส่วนผู้ป่วยเบาหวานสูงอายุ หรือผู้ป่วยที่มีการทำงานของไตบกพร่อง ที่ได้รับยา glibenclamide',
  },
  {
    title: 'การได้รับยากลุ่ม RAS blockade ซ้ำซ้อน',
    desc: 'สัดส่วนผู้ป่วยที่ได้รับยาที่ออกฤทธิ์ยับยั้งระบบ renin-angiotensin มากกว่าหนึ่งชนิดพร้อมกัน',
  },
]

/**
 * กลุ่มที่สามตามเอกสารตัวชี้วัด — "การใช้ยาในผู้ป่วยกลุ่มพิเศษ"
 *
 * แยกจากสองกลุ่มแรกเพราะฐานของการนับต่างออกไปอีกแบบ: จำกัดตามช่วงอายุของ
 * ผู้ป่วย ไม่ใช่ตามโรคหรือตามทะเบียนผู้ป่วยเรื้อรัง
 */
const SPECIAL_GROUP_KPIS = [
  {
    title: 'ผู้ป่วยเด็กโรคติดเชื้อทางเดินหายใจที่ได้รับยาต้านฮิสตามีน non-sedating',
    reportHref: '/home/rdu/reports/ruauri-child',
    settings: [
      { href: '/home/rdu/settings/ruauri-icd10', label: 'ตั้งค่ารหัสวินิจฉัย' },
      { href: '/home/rdu/settings/nonsedating-antihist', label: 'ตั้งค่ายาต้านฮิสตามีน' },
    ],
  },
]

function KpiCard({
  title,
  desc,
  reportHref,
  settings,
}: {
  title: string
  /** คำอธิบายใต้ชื่อ — ไม่ใส่สำหรับข้อที่มีหน้ารายงานแล้ว (คำนิยามอยู่ในหน้านั้น) */
  desc?: string
  /** หน้ารายการทำงานของตัวชี้วัดข้อนี้ — ไม่มี = ยังไม่ได้ทำ */
  reportHref?: string
  settings?: { href: string; label: string }[]
}) {
  // ไม่ห่อทั้งการ์ดด้วยลิงก์ ทั้งที่การ์ดอื่นในระบบทำแบบนั้น — การ์ดนี้มีลิงก์ตั้งค่า
  // อยู่ข้างในแล้ว ห่อทับอีกชั้นจะได้ <a> ซ้อน <a> ซึ่งเบราว์เซอร์แยกไม่ออกว่ากดอันไหน
  return (
    <Card variant="borderless" className="h-full border! border-line!">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-ink">{title}</div>
        {!reportHref && <Tag className="mr-0! shrink-0">ยังไม่เปิด</Tag>}
      </div>
      {desc && <p className="text-xs leading-relaxed text-ink-3">{desc}</p>}
      <div className="mt-2.5 flex flex-col gap-1">
        {reportHref && (
          <Link
            href={reportHref}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent"
          >
            <MonitorOutlined /> เปิดรายงาน <RightOutlined className="text-[10px]" />
          </Link>
        )}
        {settings?.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent"
          >
            <SettingOutlined /> {item.label} <RightOutlined className="text-[10px]" />
          </Link>
        ))}
      </div>
    </Card>
  )
}

export default function RduPage() {
  return (
    <>
      <section className="mb-6">
        <Title level={2} style={{ color: 'var(--ink)', marginBottom: 8 }}>
          <SafetyCertificateOutlined /> RDU ติดตามตัวชี้วัดการใช้ยา
        </Title>
        <div className="mb-4 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
        <Paragraph type="secondary" style={{ maxWidth: 760, marginBottom: 0 }}>
          Rational Drug Use — ติดตามตัวชี้วัดการใช้ยาอย่างสมเหตุผลของโรงพยาบาล
          ทั้งกลุ่มยาปฏิชีวนะ กลุ่มโรคเรื้อรัง และกลุ่มผู้ป่วยพิเศษ เพื่อใช้ในการประชุมคณะกรรมการและรายงานตามรอบ
        </Paragraph>
      </section>

      {/* บอกไว้ตั้งแต่ต้นว่าตัวเลขยังไม่มี ไม่ใช่ปล่อยให้ไล่กดการ์ดทีละใบเองจนครบ */}
      <Alert
        type="info"
        showIcon
        className="mb-6"
        title="เปิดแล้วสามข้อ — โรค RI, ผู้ป่วยโรคหืดที่ได้รับยา ICS และผู้ป่วยเด็ก RUA-URI"
        description={
          <div className="text-xs leading-relaxed">
            แต่ละตัวชี้วัดต้องตกลงก่อนว่านับจากรหัสวินิจฉัยและรหัสยาชุดไหนของโรงพยาบาล
            ซึ่งไม่มีคอลัมน์ไหนในฐาน HIS บอกไว้ตรง ๆ — ทะเบียนในส่วนตั้งค่าจึงเป็นของที่ต้องมี
            ก่อนจะคำนวณตัวชี้วัดข้อใดข้อหนึ่งได้ ข้อที่เหลือรอตกลงเกณฑ์
          </div>
        }
      />

      <section className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <ExperimentOutlined className="text-accent" /> กลุ่มยาปฏิชีวนะ
          <Text type="secondary" className="text-xs font-normal">
            นับตามครั้งที่มารับบริการ
          </Text>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ANTIBIOTIC_KPIS.map(kpi => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <HeartOutlined className="text-accent" /> กลุ่มโรคเรื้อรัง
          <Text type="secondary" className="text-xs font-normal">
            นับตามรายผู้ป่วยในทะเบียน
          </Text>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CHRONIC_KPIS.map(kpi => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <TeamOutlined className="text-accent" /> กลุ่มผู้ป่วยพิเศษ
          <Text type="secondary" className="text-xs font-normal">
            นับตามครั้งที่มารับบริการ จำกัดช่วงอายุ
          </Text>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SPECIAL_GROUP_KPIS.map(kpi => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>
      </section>

      {/* แยกออกจากการ์ดตัวชี้วัด เพราะเป็นข้อมูลตั้งต้นที่ตัวชี้วัดหลายข้อใช้ร่วมกัน
          ไม่ใช่ตัวชี้วัดข้อหนึ่ง */}
      <section className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <SettingOutlined className="text-accent" /> ตั้งค่า
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* วางรหัสวินิจฉัยไว้ก่อนรายการยา ตามลำดับของการนับตัวชี้วัด —
              ต้องได้ตัวหาร (ผู้ป่วยที่วินิจฉัยเป็นโรคหืด) ก่อนจึงจะนับตัวตั้งได้ */}
          <Link href="/home/rdu/settings/asthma-icd10">
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  <FileSearchOutlined />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  รหัสวินิจฉัยโรคหอบหืด
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">
                เลือกรหัส ICD-10 ที่นับเป็นโรคหอบหืด ใช้เป็นตัวหารของตัวชี้วัดผู้ป่วยโรคหืด
              </p>
            </Card>
          </Link>

          <Link href="/home/rdu/settings/inhaler">
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  <MedicineBoxOutlined />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  ยากลุ่ม Inhaled corticosteroid
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">
                เลือกรหัสยาของโรงพยาบาลที่นับเป็นยาสูดพ่นคอร์ติโคสเตียรอยด์
                ใช้กับตัวชี้วัดผู้ป่วยโรคหืด
              </p>
            </Card>
          </Link>

          <Link href="/home/rdu/settings/ri-icd10">
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  <FileSearchOutlined />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  รหัสวินิจฉัยโรค RI
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">
                เลือกรหัส ICD-10 ที่นับเป็นโรคติดเชื้อทางเดินหายใจส่วนบนและหลอดลมอักเสบเฉียบพลัน
              </p>
            </Card>
          </Link>

          <Link href="/home/rdu/settings/ri-antibiotic">
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  <MedicineBoxOutlined />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  ยาปฏิชีวนะ (RI)
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">
                เลือกรายการยาที่นับเป็นยาปฏิชีวนะ ใช้เป็นตัวตั้งของตัวชี้วัดโรค RI
              </p>
            </Card>
          </Link>

          <Link href="/home/rdu/settings/ruauri-icd10">
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  <FileSearchOutlined />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  รหัสวินิจฉัย RUA-URI
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">
                เลือกรหัส ICD-10 ตามนิยาม RUA-URI ของโครงการ Antibiotic Smart Use
                (รวมหูชั้นกลางอักเสบ)
              </p>
            </Card>
          </Link>

          <Link href="/home/rdu/settings/nonsedating-antihist">
            <Card hoverable variant="borderless" className="h-full border! border-line!">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                  <MedicineBoxOutlined />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  ยาต้านฮิสตามีน non-sedating
                  <RightOutlined className="shrink-0 text-[10px] text-accent/60" />
                </div>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">
                เลือกรายการยาต้านฮิสตามีนรุ่นที่สอง ใช้เป็นตัวตั้งของตัวชี้วัดผู้ป่วยเด็ก
              </p>
            </Card>
          </Link>

          <Card variant="borderless" className="h-full border! border-line!">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-accent-soft text-base text-accent">
                <AlertOutlined />
              </div>
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                ทะเบียนของตัวชี้วัดข้ออื่น
                <Tag className="mr-0!">ยังไม่เปิด</Tag>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              ทะเบียนยา NSAIDs, RAS blockade, glibenclamide และรหัสวินิจฉัยของตัวชี้วัดที่เหลือ —
              ทำแบบเดียวกับหน้าที่เปิดแล้วเมื่อตกลงเกณฑ์ของแต่ละข้อ
            </p>
          </Card>
        </div>
      </section>
    </>
  )
}
