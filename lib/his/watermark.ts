import 'server-only'
import sharp from 'sharp'

/**
 * ใส่ลายน้ำชื่อโรงพยาบาลลงบนภาพเวชระเบียนก่อนส่งออกไปแสดงผล
 *
 * เผาลายน้ำลงในไฟล์จริง ไม่ใช่วางทับด้วย CSS — ภาพที่ถูกบันทึกหรือเปิด URL ตรง ๆ
 * ก็ยังมีลายน้ำติดไปด้วย
 *
 * ย่อภาพลงก่อนด้วย เพราะต้นฉบับสแกนมาที่ราว 2,500 พิกเซล การเข้ารหัส JPEG ใหม่
 * ที่ขนาดเต็มใช้เวลาราว 4.5 วินาทีต่อภาพ แต่ที่ 1,800 พิกเซลเหลือไม่ถึง 100 มิลลิวินาที
 * และยังอ่านเอกสารได้ชัด (ไฟล์ที่ส่งออกเล็กลงด้วย)
 */

export const WATERMARK_TEXT = 'โรงพยาบาลพะเยา'

/** ด้านยาวสุดของภาพที่ส่งออก */
const MAX_EDGE = 1800

/** ชนิดที่ใส่ลายน้ำได้ — อย่างอื่น (เช่น PDF) ส่งต้นฉบับกลับไปตามเดิม */
const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff'])

function buildSvg(width: number, height: number): Buffer {
  const step = Math.round(Math.max(width, height) / 3.2)
  const size = Math.round(step / 8)
  const stroke = Math.max(1, Math.round(size / 22))

  const texts: string[] = []
  for (let y = 0; y < height + step; y += step) {
    for (let x = -step; x < width + step; x += step) {
      // ขาวทึบบาง ๆ ตัดขอบดำ — อ่านออกทั้งบนพื้นกระดาษขาวและบริเวณที่เข้ม
      texts.push(
        `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif"` +
          ` fill="#ffffff" fill-opacity="0.45" stroke="#111111" stroke-opacity="0.30"` +
          ` stroke-width="${stroke}" transform="rotate(-30 ${x} ${y})">${WATERMARK_TEXT}</text>`,
      )
    }
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${texts.join('')}</svg>`,
  )
}

/**
 * คืนภาพที่ใส่ลายน้ำแล้วเป็น JPEG
 * ถ้าประมวลผลไม่สำเร็จ (ไฟล์เสียหรือไม่ใช่ภาพ) จะคืนต้นฉบับกลับไปแทน
 * ดีกว่าปล่อยให้หน้าจอไม่ขึ้นภาพเลย
 */
export async function watermarkImage(
  data: Buffer,
  mime: string,
): Promise<{ data: Buffer; mime: string }> {
  if (!SUPPORTED.has(mime)) return { data, mime }

  try {
    // rotate() ไม่มีอาร์กิวเมนต์ = หมุนตาม EXIF ของภาพถ่าย
    const resized = await sharp(data)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true })

    const output = await sharp(resized.data)
      .composite([{ input: buildSvg(resized.info.width, resized.info.height), top: 0, left: 0 }])
      .jpeg({ quality: 80 })
      .toBuffer()

    return { data: output, mime: 'image/jpeg' }
  } catch (error) {
    console.error('[watermark] ใส่ลายน้ำไม่สำเร็จ ส่งภาพต้นฉบับแทน:', error)
    return { data, mime }
  }
}
