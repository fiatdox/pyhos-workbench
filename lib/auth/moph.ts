import 'server-only'

// MOPH Alerting (หมอพร้อม) — ส่งข้อความเข้า Line หมอพร้อมโดยอ้างอิงเลขบัตรประชาชน
const ALERT_URL = `${process.env.MOPH_ALERT_BASE_URL}/alert/v3.1/messages`

function headers(): Record<string, string> {
  const clientKey = process.env.MOPH_ALERT_CLIENT_ID
  const secretKey = process.env.MOPH_ALERT_SECRET_ID
  if (!process.env.MOPH_ALERT_BASE_URL || !clientKey || !secretKey) {
    throw new Error('ไม่พบค่า MOPH_ALERT_BASE_URL / MOPH_ALERT_CLIENT_ID / MOPH_ALERT_SECRET_ID ใน .env')
  }
  return { 'Content-Type': 'application/json', 'client-key': clientKey, 'secret-key': secretKey }
}

export function formatThaiDate(date: Date): { thaiDate: string; thaiTime: string } {
  const months = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  const thaiDate = `${date.getDate()} ${months[date.getMonth() + 1]} ${date.getFullYear() + 543}`
  const thaiTime = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
  return { thaiDate, thaiTime }
}

function buildOtpTemplate(otp: string, ttlSeconds: number): object {
  const { thaiDate, thaiTime } = formatThaiDate(new Date())
  const minutes = Math.max(1, Math.round(ttlSeconds / 60))

  return {
    message_title: 'รหัสยืนยันเข้าสู่ระบบ PYHOS Workbench',
    message_html: `<div><p><strong>รหัสยืนยันเข้าสู่ระบบ</strong></p><p style="font-size:24px;letter-spacing:6px;"><b>${otp}</b></p><ul><li><b>วันที่:</b> ${thaiDate}</li><li><b>เวลา:</b> ${thaiTime} น.</li><li><b>อายุรหัส:</b> ${minutes} นาที</li></ul><p style="color:#cc0000;">หากท่านไม่ได้เป็นผู้เข้าสู่ระบบ กรุณาอย่าให้รหัสนี้แก่ผู้ใด และติดต่อทีม IT ทันที</p></div>`,
    message_text: `รหัสยืนยันเข้าสู่ระบบ PYHOS Workbench: ${otp} (ใช้ได้ ${minutes} นาที) หากท่านไม่ได้ทำรายการ กรุณาอย่าให้รหัสนี้แก่ผู้ใด`,
    message_type: 'HPT',
    messages: [
      {
        type: 'flex',
        altText: `รหัสยืนยันเข้าสู่ระบบ: ${otp}`,
        contents: {
          type: 'bubble',
          header: {
            type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#160c2b',
            contents: [
              { type: 'text', text: '🔐 PYHOS WORKBENCH', weight: 'bold', size: 'lg', color: '#c4b5fd' },
              { type: 'text', text: 'Hospital Data Workspace', size: 'xs', color: '#6b7280', margin: 'xs' },
            ],
          },
          body: {
            type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#0c0716',
            contents: [
              { type: 'text', text: 'รหัสยืนยันเข้าสู่ระบบ', weight: 'bold', size: 'xl', color: '#f8fafc' },
              { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs' },
              { type: 'separator', margin: 'lg', color: '#2a1152' },
              {
                type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#1e123a',
                paddingAll: '16px', cornerRadius: 'md',
                contents: [
                  { type: 'text', text: 'รหัส OTP', size: 'xs', color: '#6b7280', align: 'center' },
                  { type: 'text', text: otp, size: 'xxl', weight: 'bold', color: '#c4b5fd', align: 'center' },
                ],
              },
              {
                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                contents: [
                  {
                    type: 'box', layout: 'baseline',
                    contents: [
                      { type: 'text', text: 'วันที่', size: 'sm', color: '#6b7280', flex: 2 },
                      { type: 'text', text: `${thaiDate} ${thaiTime} น.`, size: 'sm', color: '#e2e8f0', weight: 'bold', flex: 5, wrap: true },
                    ],
                  },
                  {
                    type: 'box', layout: 'baseline',
                    contents: [
                      { type: 'text', text: 'อายุรหัส', size: 'sm', color: '#6b7280', flex: 2 },
                      { type: 'text', text: `${minutes} นาที`, size: 'sm', color: '#e2e8f0', weight: 'bold', flex: 5 },
                    ],
                  },
                ],
              },
              {
                type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#1e0a0a',
                paddingAll: '12px', cornerRadius: 'md',
                contents: [
                  { type: 'text', text: 'หากท่านไม่ได้เป็นผู้เข้าสู่ระบบ กรุณาอย่าให้รหัสนี้แก่ผู้ใด และติดต่อทีม IT ทันที', size: 'sm', color: '#f87171', wrap: true, weight: 'bold' },
                ],
              },
            ],
          },
        },
      },
    ],
  }
}

/** บับเบิลแจ้งเตือนทั่วไป (ใช้ร่วมกันระหว่างแจ้งเข้าระบบ / ออกจากระบบ) */
function buildNoticeTemplate(params: {
  title: string
  headline: string
  emoji: string
  accent: string
  rows: { label: string; value: string }[]
  warning?: string
}): object {
  const { title, headline, emoji, accent, rows, warning } = params
  const plain = rows.map(r => `${r.label}: ${r.value}`).join(' | ')

  return {
    message_title: title,
    message_html: `<div><p><strong>${headline}</strong></p><ul>${rows
      .map(r => `<li><b>${r.label}:</b> ${r.value}</li>`)
      .join('')}</ul>${warning ? `<p style="color:#cc0000;">${warning}</p>` : ''}</div>`,
    message_text: `${headline} — ${plain}${warning ? ` | ${warning}` : ''}`,
    message_type: 'HPT',
    messages: [
      {
        type: 'flex',
        altText: headline,
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#160c2b',
            contents: [
              { type: 'text', text: `${emoji} PYHOS WORKBENCH`, weight: 'bold', size: 'lg', color: accent },
              { type: 'text', text: 'Hospital Data Workspace', size: 'xs', color: '#6b7280', margin: 'xs' },
            ],
          },
          body: {
            type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#0c0716',
            contents: [
              { type: 'text', text: headline, weight: 'bold', size: 'xl', color: '#f8fafc', wrap: true },
              { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs' },
              { type: 'separator', margin: 'lg', color: '#2a1152' },
              {
                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                contents: rows.map(r => ({
                  type: 'box', layout: 'baseline',
                  contents: [
                    { type: 'text', text: r.label, size: 'sm', color: '#6b7280', flex: 3 },
                    { type: 'text', text: r.value, size: 'sm', weight: 'bold', color: accent, flex: 5, wrap: true },
                  ],
                })),
              },
              ...(warning
                ? [{
                    type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#1e0a0a',
                    paddingAll: '12px', cornerRadius: 'md',
                    contents: [{ type: 'text', text: warning, size: 'sm', color: '#f87171', wrap: true, weight: 'bold' }],
                  }]
                : []),
            ],
          },
        },
      },
    ],
  }
}

/** ข้อมูลประกอบการแจ้งเตือนเข้า/ออกระบบ */
export type SessionAlertInfo = {
  username: string
  clientIp: string
  device: string
  /** ผ่านการยืนยัน OTP มาหรือไม่ (เฉพาะตอนเข้าระบบ) */
  viaMfa?: boolean
}

export type SendResult = { ok: boolean; status: number; ms: number; detail: string }

/** ส่ง OTP เข้า Line หมอพร้อมของเจ้าของเลขบัตรประชาชนที่ระบุ */
export async function sendOtpAlert(idCard: string, otp: string, ttlSeconds: number): Promise<SendResult> {
  return post(idCard, buildOtpTemplate(otp, ttlSeconds))
}

/** แจ้งเตือนเมื่อเข้าสู่ระบบสำเร็จ */
export async function sendLoginAlert(idCard: string, info: SessionAlertInfo): Promise<SendResult> {
  const { thaiDate, thaiTime } = formatThaiDate(new Date())
  return post(
    idCard,
    buildNoticeTemplate({
      title: 'แจ้งเตือน: เข้าสู่ระบบสำเร็จ',
      headline: 'เข้าสู่ระบบสำเร็จ',
      emoji: '✅',
      accent: '#c4b5fd',
      rows: [
        { label: 'วันที่', value: `${thaiDate} ${thaiTime} น.` },
        { label: 'ชื่อผู้ใช้', value: info.username },
        { label: 'วิธียืนยัน', value: info.viaMfa ? 'รหัสผ่าน + OTP หมอพร้อม' : 'รหัสผ่าน' },
        { label: 'IP ผู้ใช้งาน', value: info.clientIp },
        { label: 'อุปกรณ์', value: info.device },
      ],
      warning: 'หากท่านไม่ได้เป็นผู้เข้าสู่ระบบ กรุณาเปลี่ยนรหัสผ่านและติดต่อทีม IT ทันที',
    }),
  )
}

/** แจ้งเตือนเมื่อออกจากระบบ */
export async function sendLogoutAlert(idCard: string, info: SessionAlertInfo): Promise<SendResult> {
  const { thaiDate, thaiTime } = formatThaiDate(new Date())
  return post(
    idCard,
    buildNoticeTemplate({
      title: 'แจ้งเตือน: ออกจากระบบ',
      headline: 'ออกจากระบบแล้ว',
      emoji: '🔒',
      accent: '#a5b4fc',
      rows: [
        { label: 'วันที่', value: `${thaiDate} ${thaiTime} น.` },
        { label: 'ชื่อผู้ใช้', value: info.username },
        { label: 'IP ผู้ใช้งาน', value: info.clientIp },
        { label: 'อุปกรณ์', value: info.device },
      ],
    }),
  )
}

/** ยิง payload เข้า MOPH Alerting — ตัวกลางเดียวของทุกเทมเพลต */
async function post(idCard: string, template: object): Promise<SendResult> {
  const payload = { cid: [idCard], ...template }
  const started = Date.now()
  try {
    const res = await fetch(ALERT_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
      // กันค้างยาวจนหน้าเว็บรอไม่ไหว
      signal: AbortSignal.timeout(15_000),
    })
    // อ่าน body ทิ้งเพื่อปิด connection ให้เรียบร้อย (ไม่ log เนื้อหาที่อาจมีข้อมูลผู้ใช้)
    await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, ms: Date.now() - started, detail: `HTTP ${res.status}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, status: 0, ms: Date.now() - started, detail: `ERROR ${message}`.slice(0, 400) }
  }
}
