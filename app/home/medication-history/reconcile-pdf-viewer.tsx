'use client'

import { PDFViewer } from '@react-pdf/renderer'
import { ReconcileDocument, type ReconcilePrintData } from './reconcile-pdf'

/**
 * ห่อ PDFViewer ไว้ในไฟล์แยกเพื่อให้ import แบบ dynamic ssr:false ได้ทั้งก้อน
 * ตัว viewer เป็น iframe ของเบราว์เซอร์ ปุ่มพิมพ์และดาวน์โหลดจึงเป็นของเบราว์เซอร์เอง
 */
export default function ReconcilePdfViewer({ data }: { data: ReconcilePrintData }) {
  return (
    <PDFViewer style={{ width: '100%', height: '100%', border: 'none' }} showToolbar>
      <ReconcileDocument data={data} />
    </PDFViewer>
  )
}
