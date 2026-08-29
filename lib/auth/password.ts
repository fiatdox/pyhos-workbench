import 'server-only'
import { verify } from '@node-rs/argon2'

// แฮชจริงของสตริงสุ่มที่ไม่มีใครใช้ (พารามิเตอร์ m=65536,t=3,p=2 เท่ากับที่ใช้ในฐานข้อมูล)
// ใช้ verify ทิ้งเมื่อไม่พบผู้ใช้ เพื่อให้เวลาตอบกลับใกล้เคียงกรณีพบผู้ใช้
// (กัน username enumeration จากการจับเวลา) — ต้องเป็นแฮชที่ถูกรูปแบบจริง
// ไม่งั้น verify จะ throw ทันทีและไม่ได้เผาเวลาเลย
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=2$zti/MK5PV+EO7OJ0dVRkiQ$dK6swpMnvZDx4cXjskwBeU/M4dMedvNzQpcFxnC+BGM'

/** ตรวจรหัสผ่านกับแฮช argon2id ที่เก็บใน core_kon.users.password */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await verify(hash, plain)
  } catch {
    // แฮชผิดรูปแบบ/อัลกอริทึมที่ไม่รองรับ → ถือว่าไม่ผ่าน
    return false
  }
}

/** เผาเวลาให้พอ ๆ กับการตรวจจริง สำหรับกรณีไม่พบผู้ใช้ */
export async function fakeVerify(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain)
}
