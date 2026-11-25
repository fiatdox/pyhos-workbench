// fontkit ไม่มีไฟล์ชนิดข้อมูล — ประกาศเฉพาะส่วนที่ใช้วัดความกว้างข้อความใน checkup-sheet-pdf.tsx
declare module 'fontkit' {
  export interface Font {
    unitsPerEm: number
    layout(text: string): { advanceWidth: number }
  }
  export function openSync(path: string): Font
}
