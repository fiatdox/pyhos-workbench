/**
 * โลโก้ของระบบ — ใช้ทั้งเมนูข้าง แถบบน และหน้าเข้าสู่ระบบ
 *
 * รูปเดียวกับ app/icon.svg (favicon) ทุกจุด: สี่เหลี่ยมมุมมนม่วงทึบ ข้างในเป็นเครื่องหมาย
 * บวกทางการแพทย์คู่กับแท่งกราฟสามแท่ง — "ข้อมูลของโรงพยาบาล" ซึ่งเป็นสิ่งที่ระบบนี้ทำ
 * ถ้าแก้รูปต้องแก้ทั้งสองที่ แล้วสร้าง favicon.ico กับ apple-icon.png ใหม่จาก icon.svg
 *
 * ม่วงเข้มเดียวกันทั้งสองธีม (ไม่ผูกกับ --accent ที่สว่างขึ้นในธีมมืด)
 * รูปขาวบน #6d28d9 ได้ 7.1:1 · เส้นและช่องไฟออกแบบให้ยังแยกออกที่ 16px
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className="shrink-0"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="#6d28d9" />
      <g fill="#ffffff">
        <rect x="9.25" y="5.5" width="2.5" height="10" rx="1.25" />
        <rect x="5.5" y="9.25" width="10" height="2.5" rx="1.25" />
        <rect x="6.5" y="19" width="4.5" height="7" rx="1.5" />
        <rect x="13.75" y="15" width="4.5" height="11" rx="1.5" />
        <rect x="21" y="7" width="4.5" height="19" rx="1.5" />
      </g>
    </svg>
  )
}
