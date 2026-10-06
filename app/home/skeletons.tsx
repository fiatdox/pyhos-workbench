/**
 * โครงร่างระหว่างรอข้อมูล (skeleton)
 *
 * ใช้แทนวงกลมหมุนในที่ที่ "รู้อยู่แล้วว่าของที่กำลังมามีรูปร่างแบบไหน" — ตาราง
 * ที่รู้จำนวนคอลัมน์ แถวข้อมูลผู้ป่วยที่มีสี่ช่องเสมอ กราฟที่รู้ความสูง
 * ได้สองอย่างที่วงกลมหมุนให้ไม่ได้: บอกว่ากำลังจะได้อะไรมา และจองที่ไว้ล่วงหน้า
 * ไม่ให้ของกระโดดตอนข้อมูลมาถึง
 *
 * ยังเหลือวงกลมหมุนไว้ในที่ที่รูปร่างไม่แน่นอน เช่นเนื้อรายงานผลเพาะเชื้อที่
 * ความยาวต่างกันทุกใบ — โครงร่างที่เดาความยาวผิดรบกวนตามากกว่าช่วย
 *
 * ไม่ใช้ Skeleton ของ antd เพราะต้องคุมความกว้างของแต่ละคอลัมน์ให้ตรงกับตาราง
 * จริงที่อยู่ข้างบน ซึ่งทำกับ div ธรรมดาตรงกว่าการไป override สไตล์ของมัน
 */

/** แท่งเดียว — animate-pulse ของ Tailwind ทำงานกับทั้งธีมสว่างและมืด */
function Bar({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded bg-line ${className}`} style={style} />
}

/**
 * ช่องกรอกหนึ่งช่อง (ป้ายบน + กล่องล่าง)
 *
 * ความสูงตรงกับ ReadonlyField ที่ใช้อยู่ในฟอร์ม เพื่อให้ตอนข้อมูลมาถึงแถวไม่ขยับ
 */
export function FieldSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <Bar className="mb-1.5 h-2.5 w-16" />
      <Bar className="h-8 w-full" />
    </div>
  )
}

/**
 * แถวของตารางระหว่างรอ — วางในช่อง emptyText ของ antd Table
 *
 * วางที่นั้นเพราะหัวตารางจริงยังอยู่ ความกว้างคอลัมน์จึงไม่เปลี่ยนตอนข้อมูลมา
 * ถ้าเอาตารางออกไปทั้งใบแล้วเอาโครงร่างมาแทน หัวตารางจะหายไปด้วยและของ
 * จะกระโดดสองครั้ง (ตอนโครงร่างขึ้น และตอนข้อมูลมา) แย่กว่าไม่ทำอะไรเลย
 */
export function TableRowsSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: columns }, (_, column) => (
            // คอลัมน์แรกมักเป็นลำดับหรือรหัส จึงแคบกว่าคอลัมน์เนื้อหา
            <Bar
              key={column}
              className={column === 0 ? 'h-3.5 w-8 shrink-0' : 'h-3.5 flex-1'}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** กล่องกราฟระหว่างรอ — จองความสูงเท่าของจริงไว้ ไม่ให้หน้าเลื่อนตอนกราฟวาดเสร็จ */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex items-end gap-2 px-2 py-3" style={{ height }}>
      {/* แท่งสูงไม่เท่ากันให้ดูเป็นกราฟ ไม่ใช่กล่องทึบ — ความสูงคงที่ ไม่ได้สุ่ม
          เพื่อให้ทุกครั้งที่ขึ้นมาหน้าตาเหมือนกัน ไม่กะพริบเป็นคนละรูปทุกรอบ */}
      {[45, 70, 35, 85, 55, 75, 40, 65, 50, 80, 60, 30].map((percent, index) => (
        <Bar key={index} className="flex-1" style={{ height: `${percent}%` }} />
      ))}
    </div>
  )
}

/**
 * ตารางปฏิทินหนึ่งเดือนระหว่างรอ
 *
 * ปฏิทินเป็นรูปร่างที่เดาได้แน่นอนที่สุดในระบบ — เจ็ดคอลัมน์ หกสัปดาห์ เท่ากัน
 * ทุกเดือน จึงเป็นที่ที่โครงร่างได้เปรียบวงกลมหมุนมากที่สุด
 */
export function CalendarSkeleton() {
  return (
    <div className="space-y-2 p-2">
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }, (_, day) => (
          <Bar key={day} className="h-3" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, week) => (
        <div key={week} className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, day) => (
            <Bar key={day} className="h-16" />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * การ์ดตัวเลขสรุปหนึ่งแถว — ใช้กับหัวรายงาน RDU และหน้าภาพรวม
 *
 * ความสูงตรงกับการ์ดจริง (ป้าย + ตัวเลขใหญ่ + คำอธิบายใต้) เพื่อให้หน้าไม่เลื่อน
 * ตอนตัวเลขมาถึง รายงานพวกนี้ใช้เวลาคิวรีหลายวินาที ถ้าของกระโดดตอนเสร็จ
 * คนที่เลื่อนหน้าลงไปอ่านตารางอยู่จะถูกดีดกลับ
 */
export function StatCardsSkeleton({
  count = 4,
  className = 'mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4',
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, card) => (
        <div key={card} className="rounded-xl border border-line bg-panel px-4 py-3 backdrop-blur">
          <Bar className="h-2.5 w-24" />
          <Bar className="mt-2 h-6 w-20" />
          <Bar className="mt-2 h-2.5 w-32" />
        </div>
      ))}
    </div>
  )
}

/** แถวป้าย-ค่า เช่นใน Descriptions ของ antd */
export function DescriptionsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row}>
          <Bar className="h-2.5 w-20" />
          <Bar className="mt-1.5 h-3.5 w-full" />
        </div>
      ))}
    </div>
  )
}

/** กล่องเนื้อหาทึบหนึ่งใบ ใช้จองที่ของส่วนที่รูปร่างภายในไม่สำคัญ */
export function BlockSkeleton({
  height = 120,
  className = '',
}: {
  height?: number
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-line bg-panel p-4 backdrop-blur ${className}`}>
      <Bar className="h-3 w-40" />
      <Bar className="mt-3 w-full" style={{ height }} />
    </div>
  )
}

/**
 * โครงร่างของรายงาน RDU ทั้งเจ็ดใบ — การ์ดตัวเลข กราฟ แล้วตาราง
 *
 * ทั้งเจ็ดใบใช้แม่แบบเดียวกันจริง ๆ (การ์ดสรุปบน กราฟกลาง ตารางเคสล่าง)
 * จึงรวมเป็นชิ้นเดียว ถ้าแยกเขียนในแต่ละหน้าจะกลายเป็นโค้ดซ้ำเจ็ดชุดที่
 * วันหนึ่งจะเพี้ยนไปคนละแบบ
 */
export function ReportSkeleton({
  cards = 4,
  cardsClassName,
}: {
  cards?: number
  cardsClassName?: string
}) {
  return (
    <>
      {cardsClassName ? (
        <StatCardsSkeleton count={cards} className={cardsClassName} />
      ) : (
        <StatCardsSkeleton count={cards} />
      )}
      <BlockSkeleton height={220} className="mb-4" />
      <div className="rounded-2xl border border-line bg-panel p-4 backdrop-blur">
        <Bar className="h-3 w-32" />
        <TableRowsSkeleton columns={6} rows={6} />
      </div>
    </>
  )
}

/**
 * สองแผงของ Transfer ระหว่างรอ — รายการทั้งหมดทางซ้าย ที่เลือกไว้ทางขวา
 *
 * ใช้เฉพาะตอนโหลดครั้งแรกที่ยังไม่มีรายการเลย ไม่ใช้ตอนกดบันทึก — ตอนบันทึก
 * รายการที่เลือกไว้อยู่บนจอแล้ว เอาโครงร่างไปทับคือลบสิ่งที่ผู้ใช้เพิ่งจัดทิ้ง
 * ตอนนั้นต้องเป็นวงกลมหมุนคลุมของเดิมไว้
 */
export function TransferSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1].map(pane => (
        <div key={pane} className="rounded-lg border border-line p-3">
          <Bar className="h-3 w-28" />
          <Bar className="mt-3 h-7 w-full" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex items-center gap-2">
                <Bar className="h-3.5 w-3.5 shrink-0" />
                <Bar className="h-3 flex-1" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
