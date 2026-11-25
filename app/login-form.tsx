'use client'
import { withBase } from '@/lib/base-path'
import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { BrandMark } from '@/app/brand-mark'
import { ThemeToggleButton } from '@/app/theme'
import {
  FaUser,
  FaLock,
  FaEye,
  FaEyeSlash,
  FaShieldAlt,
  FaArrowRight,
  FaMobileAlt,
  FaArrowLeft,
  FaCheck,
} from 'react-icons/fa'

/**
 * งานที่ระบบมีอยู่จริง — แสดงบนแผงซ้ายของจอกว้าง
 * ตรงกับเมนูใน app/home/app-shell.tsx (MENU_ITEMS) เพิ่ม/ถอดเมนูแล้วต้องแก้ที่นี่ด้วย
 * ไม่ได้ import จากที่นั่นตรง ๆ เพราะหน้านี้เปิดก่อนล็อกอิน ไม่ควรโหลดโครงหน้าหลังล็อกอินมาด้วย
 * และไม่ใส่เมนูที่จำกัดสิทธิ์อย่างร่องรอยการใช้งาน
 */
const FEATURES = [
  'ประวัติการได้รับยา',
  'Drug Profile ผู้ป่วยใน',
  'ผลตรวจ HLA-B*5801 / 1502',
  'ตัวชี้วัด RDU',
  'ตรวจสุขภาพ พร้อมใบรายงานผล',
  'Service Plan',
  'Health Rider ส่งยาถึงบ้าน',
]

/* สไตล์ของตัวควบคุมในฟอร์ม — ใช้ซ้ำทั้งขั้นรหัสผ่านและขั้น OTP */
const LABEL = 'mb-1.5 block text-xs font-semibold text-ink-2'
const INPUT =
  'block w-full rounded-lg border border-line bg-raised text-ink placeholder:text-ink-3 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20'
const SUBMIT =
  'group flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#6d28d9] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5b21b6] disabled:cursor-not-allowed disabled:opacity-60'

export default function LoginForm({ initialError = '' }: { initialError?: string }) {
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  // ข้อความเริ่มต้นมาจากฝั่งเซิร์ฟเวอร์ (เช่น ถูกส่งกลับมาเพราะเซสชันหมดอายุ)
  const [error, setError] = useState(initialError)

  // ── ขั้นยืนยัน OTP ผ่าน Line หมอพร้อม (แสดงเฉพาะเมื่อ backend ตอบ mfa_required) ──
  // รหัสรอบ OTP อยู่ในคุกกี้ httpOnly (เซิร์ฟเวอร์ตั้ง) — หน้าเว็บรู้แค่ว่าอยู่ขั้นไหน
  const [otpStep, setOtpStep] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpNotice, setOtpNotice] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const otpInputRef = useRef<HTMLInputElement>(null)

  // นับถอยหลังปุ่ม "ขอรหัสใหม่"
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // โฟกัสช่อง OTP อัตโนมัติเมื่อเข้าสู่ขั้นยืนยัน
  useEffect(() => {
    if (otpStep) otpInputRef.current?.focus()
  }, [otpStep])

  // เข้าระบบ — ใช้ร่วมกันทั้งเส้นทางปกติและเส้นทาง MFA
  //
  // ไม่มีการเก็บ cookie ตรงนี้แล้ว: เซิร์ฟเวอร์ตั้ง auth_token แบบ httpOnly
  // มาให้ใน response ของ /api/auth/login และ /api/auth/verify-otp
  // (ดู buildLoginSuccess) หน้าเว็บจึงอ่าน token ไม่ได้ และไม่จำเป็นต้องอ่าน
  const completeLogin = (json: { username_change_required?: boolean }) => {
    // นโยบายอายุรหัสผ่าน: ไม่บล็อกที่นี่ — เข้าใช้งานได้ตามปกติ
    // แถบเตือนจะคำนวณจากวันที่เปลี่ยนรหัสล่าสุดผ่าน /users/me/password-status บนทุกหน้า
    //
    // นโยบายชื่อผู้ใช้โหมด force: พาไปตั้งชื่อใหม่ทันที (backend ปิดกั้น API อื่นไว้อยู่แล้ว
    // ถ้าพิมพ์ URL ตรงก็จะได้ 423 แล้วถูกพากลับมาที่นี่)
    const destination = json.username_change_required ? '/account/change-username' : '/home'

    // โหลดหน้าใหม่ทั้งหน้า ไม่ใช้ router.push
    //
    // ห้ามใช้ router.push() ตามด้วย router.refresh(): refresh ทำงานกับ URL
    // ปัจจุบันซึ่งตอนนั้นยังเป็นหน้า login อยู่ (push ยังไม่ commit) มันจึงดึง
    // หน้า login กลับมาทับการเปลี่ยนหน้า ผู้ใช้ค้างอยู่ที่ /?expired=1 พร้อม
    // ข้อความ "เซสชันหมดอายุ" ทั้งที่ล็อกอินสำเร็จแล้ว
    //
    // การโหลดใหม่ทั้งหน้ายังการันตีว่าเซิร์ฟเวอร์เห็น cookie ที่เพิ่งตั้ง และ
    // ไม่มี RSC cache ของรอบก่อนค้าง (กรณีออกจากระบบแล้วล็อกอินซ้ำในแท็บเดิม)
    window.location.assign(withBase(destination))
  }

  const handleLogin = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(withBase('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
        return
      }
      // ต้องยืนยัน OTP ก่อน — ยังไม่ได้ token
      if (json.mfa_required) {
        setOtpStep(true)
        setCooldown(json.resend_after_seconds ?? 60)
        setOtpNotice('ส่งรหัสยืนยันไปยัง Line หมอพร้อมแล้ว')
        setPassword('')
        return
      }
      completeLogin(json)
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setError('')
    setOtpNotice('')
    setLoading(true)
    try {
      const res = await fetch(withBase('/api/auth/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message || 'รหัสยืนยันไม่ถูกต้อง')
        setOtp('')
        // รอบถูกตัด/หมดอายุ → กลับไปหน้ากรอกรหัสผ่าน
        if (res.status === 400 && !json.can_resend) backToPassword()
        if (res.status === 429) backToPassword()
        return
      }
      completeLogin(json)
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (cooldown > 0 || loading) return
    setError('')
    setOtpNotice('')
    setLoading(true)
    try {
      const res = await fetch(withBase('/api/auth/resend-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.message || 'ขอรหัสใหม่ไม่สำเร็จ')
        if (json.retry_after_seconds) setCooldown(json.retry_after_seconds)
        return
      }
      setOtp('')
      setOtpNotice('ส่งรหัสยืนยันใหม่แล้ว')
      setCooldown(json.resend_after_seconds ?? 60)
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  const backToPassword = () => {
    setOtpStep(false)
    setOtp('')
    setOtpNotice('')
    setCooldown(0)
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-accent-soft">
      {/* ปุ่มสลับธีม — หน้านี้ไม่มีแถบบน จึงลอยไว้มุมขวาบน */}
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <ThemeToggleButton />
      </div>

      {/* ============================ ซ้าย — แนะนำระบบ (จอกว้าง) ============================
          ภาพพื้นหลังเก็บไว้ในโปรเจกต์ (public/images/login-bg.webp) ไม่ได้ดึงจาก Unsplash
          ตอนเปิดหน้า — เครื่องในวง LAN ของโรงพยาบาลที่ออกเน็ตไม่ได้ก็ยังเห็น และไม่ต้องเปิด
          ให้ตัวปรับขนาดรูปของ Next ดึงรูปจากโดเมนภายนอก (ต้นฉบับ: images.unsplash.com
          photo-1758110197549-7e94845ad04b ใช้ได้ตามสัญญาอนุญาตของ Unsplash)

          ภาพหกเหลี่ยมหลายสีลายตามาก ตัวหนังสือวางทับตรง ๆ อ่านไม่ออก จึงทับด้วยม่วงเข้ม
          วัดกรณีแย่สุด (ภาพข้างใต้เป็นขาวล้วน): ครึ่งซ้ายที่มีตัวหนังสือ ตัวขาวได้ ≥ 10:1
          ตัวขาว 70% ได้ ≥ 6:1 ส่วนมุมขวาล่างที่ทับบางสุด (ไม่มีตัวหนังสือ) ตัวขาวยังได้ 6.8:1
          ใช้ชุดสีนี้ทั้งสองธีม — แผงนี้เป็นภาพ ไม่ใช่พื้นผิวของแอปที่ต้องสลับตามโหมด

          (เคยมีแดชบอร์ดจำลองที่ตัวเลขแต่งขึ้น เช่น "ผู้ป่วยนอกวันนี้ 1,284" ถูกเอาออกแล้ว
          เพราะตัวเลขที่ดูเหมือนจริงแต่ไม่จริงทำให้เข้าใจผิดได้) */}
      <div className="relative hidden w-full overflow-hidden lg:flex lg:w-1/2 xl:w-[55%]">
        <Image
          src={withBase('/images/login-bg.webp')}
          alt=""
          fill
          priority
          sizes="(min-width: 1280px) 55vw, 50vw"
          className="object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-br from-[#160b30]/92 via-[#2e1065]/86 to-[#4c1d95]/82"
        />

        <div className="relative flex w-full flex-col justify-between p-10 text-white xl:p-14">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-[0.16em]">PYHOS WORKBENCH</div>
              <div className="text-xs text-white/70">Hospital Data Workspace</div>
            </div>
          </div>

          <div className="max-w-lg">
            <h1 className="mb-4 text-4xl font-semibold leading-[1.2] tracking-tight xl:text-[2.75rem]">
              เวิร์กเบนช์
              <br />
              <span className="text-[#ddd6fe]">งานยาและข้อมูลผู้ป่วย</span>
            </h1>
            <div className="title-rule mb-5 [--rule-color:#c4b5fd]" />
            <p className="mb-8 text-base leading-relaxed text-white/85">
              ดูประวัติการได้รับยา ผลแล็บ และผลตรวจสุขภาพของผู้ป่วยจากฐาน HIS ในที่เดียว
              ติดตามตัวชี้วัด RDU และ Service Plan พิมพ์ใบรายงาน หรือส่งออกไปทำงานต่อได้
            </p>

            <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
              {FEATURES.map(feature => (
                <li key={feature} className="flex items-center gap-2.5 text-sm text-white/90">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[10px] text-[#ddd6fe]">
                    <FaCheck />
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/70">
            <FaShieldAlt className="text-[#c4b5fd]" />
            เข้ารหัสด้วย TLS 1.3 · เข้าถึงข้อมูลตามสิทธิ์ที่ได้รับมอบหมาย
          </div>
        </div>
      </div>

      {/* ============================ ขวา — ฟอร์มเข้าสู่ระบบ ============================ */}
      <div className="flex w-full flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:w-1/2 lg:px-10 xl:w-[45%]">
        <div className="w-full max-w-sm">
          {/* โลโก้สำหรับจอเล็ก — จอกว้างมีอยู่บนแผงซ้ายแล้ว */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <BrandMark size={36} />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-[0.16em] text-ink">PYHOS WORKBENCH</div>
              <div className="text-[11px] text-ink-3">Hospital Data Workspace</div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-panel p-6 shadow-[0_8px_32px_var(--card-shadow)] sm:p-8">
            <div className="mb-6">
              <h2 className="mb-1 text-2xl font-semibold tracking-tight text-ink">
                {otpStep ? 'ยืนยันตัวตน' : 'เข้าสู่ระบบ'}
              </h2>
              <p className="mb-0 text-sm text-ink-3">
                {otpStep
                  ? 'กรอกรหัส 6 หลักที่ส่งไปยัง Line หมอพร้อม'
                  : 'ลงชื่อเข้าใช้ด้วยบัญชีของโรงพยาบาล'}
              </p>
            </div>

            {/* ─────────────── ขั้นที่ 2: ยืนยัน OTP ─────────────── */}
            {otpStep ? (
              <form className="space-y-4" onSubmit={handleVerifyOtp}>
                <div className="flex items-start gap-3 rounded-lg border border-accent-line bg-accent-soft px-3.5 py-3">
                  <FaMobileAlt className="mt-0.5 shrink-0 text-accent" />
                  <div className="text-xs leading-relaxed text-ink-2">
                    ส่งรหัสยืนยันไปยัง <span className="font-semibold">Line หมอพร้อม</span> ที่ผูกกับบัญชีของท่านแล้ว
                    <div className="mt-1 text-ink-3">
                      หากไม่ได้รับ กรุณาตรวจสอบว่าเพิ่มเพื่อนและผูกบัญชี Line หมอพร้อมไว้แล้ว
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="otp" className={LABEL}>
                    รหัสยืนยัน (OTP)
                  </label>
                  <input
                    id="otp"
                    name="otp"
                    ref={otpInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    required
                    placeholder="000000"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`${INPUT} py-2.5 text-center font-mono text-2xl tracking-[0.5em] placeholder:text-ink-3/40`}
                  />
                </div>

                {otpNotice && !error && (
                  <div role="status" className="rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2.5 text-sm text-accent">
                    {otpNotice}
                  </div>
                )}
                {error && (
                  <div role="alert" className="rounded-lg border border-danger-line bg-danger-bg px-3.5 py-2.5 text-sm text-danger">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading || otp.length < 6} className={SUBMIT}>
                  {loading ? 'กำลังยืนยัน...' : 'ยืนยันรหัส'}
                  {!loading && <FaArrowRight className="text-xs transition-transform group-hover:translate-x-0.5" />}
                </button>

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={backToPassword}
                    className="flex cursor-pointer items-center gap-1.5 text-ink-3 transition-colors hover:text-ink"
                  >
                    <FaArrowLeft className="text-[10px]" /> ย้อนกลับ
                  </button>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={cooldown > 0 || loading}
                    className="cursor-pointer font-medium text-accent transition-colors hover:text-accent-strong disabled:cursor-not-allowed disabled:text-ink-3"
                  >
                    {cooldown > 0 ? `ขอรหัสใหม่ได้ใน ${cooldown} วินาที` : 'ขอรหัสใหม่'}
                  </button>
                </div>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={handleLogin}>
                <div>
                  <label htmlFor="username" className={LABEL}>
                    ชื่อผู้ใช้งาน
                  </label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3 transition-colors group-focus-within:text-accent">
                      <FaUser className="text-sm" />
                    </span>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      required
                      placeholder="เช่น somchai.j"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className={`${INPUT} py-2.5 pl-9 pr-3 text-sm`}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className={LABEL}>
                    รหัสผ่าน
                  </label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3 transition-colors group-focus-within:text-accent">
                      <FaLock className="text-sm" />
                    </span>
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${INPUT} py-2.5 pl-9 pr-11 text-sm`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      className="absolute inset-y-0 right-1 flex w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors hover:text-accent"
                      aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    >
                      {showPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div role="alert" className="rounded-lg border border-danger-line bg-danger-bg px-3.5 py-2.5 text-sm text-danger">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className={SUBMIT}>
                  {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                  {!loading && <FaArrowRight className="text-xs transition-transform group-hover:translate-x-0.5" />}
                </button>
              </form>
            )}

            {/* เดิมมีช่อง "จดจำฉันไว้" และลิงก์ "ลืมรหัสผ่าน?" / "ติดต่อผู้ดูแลระบบ" ที่ชี้ไป #
                ซึ่งไม่ได้ทำอะไรเลย — เหลือเป็นข้อความบอกทางที่ใช้ได้จริงแทน */}
            <p className="mt-6 mb-0 border-t border-line pt-4 text-center text-xs text-ink-3">
              ลืมรหัสผ่านหรือยังไม่มีสิทธิ์เข้าถึงข้อมูล กรุณาติดต่อผู้ดูแลระบบ
            </p>
          </div>

          <div className="mt-6 text-center text-[11px] text-ink-3">
            © {new Date().getFullYear()} PYHOS Workbench
          </div>
        </div>
      </div>
    </div>
  )
}
