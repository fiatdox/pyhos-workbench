'use client'
import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Cookies from 'js-cookie'
import { ThemeToggleButton } from '@/app/theme'
import {
  FaUser,
  FaLock,
  FaEye,
  FaEyeSlash,
  FaShieldAlt,
  FaLayerGroup,
  FaArrowRight,
  FaMobileAlt,
  FaArrowLeft,
  FaArrowUp,
  FaArrowDown,
} from 'react-icons/fa'

// ภาพพื้นหลังเต็มจอ — โฮสต์ที่ images.unsplash.com (อนุญาตไว้ใน next.config.ts › images.remotePatterns)
const BG_IMAGE =
  'https://images.unsplash.com/photo-1624727828489-a1e03b79bba8?q=80&w=1171&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'

// ตัวอย่างข้อมูลสำหรับ mock แดชบอร์ดฝั่งซ้าย — ใช้ตกแต่งเท่านั้น ไม่ได้ยิง API
const PREVIEW_STATS = [
  { label: 'ผู้ป่วยนอกวันนี้', value: '1,284', delta: '+8.2%', up: true },
  { label: 'เตียงว่าง', value: '46', delta: '-3.1%', up: false },
  { label: 'รอผลแล็บ', value: '312', delta: '+1.7%', up: true },
  { label: 'ชุดข้อมูลที่เชื่อม', value: '27', delta: '+2', up: true },
]
const PREVIEW_BARS = [38, 62, 45, 78, 55, 88, 70, 96, 64, 82, 58, 74]

export default function LoginForm({ initialError = '' }: { initialError?: string }) {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  // ข้อความเริ่มต้นมาจากฝั่งเซิร์ฟเวอร์ (เช่น ถูกส่งกลับมาเพราะเซสชันหมดอายุ)
  const [error, setError] = useState(initialError)

  // ── ขั้นยืนยัน OTP ผ่าน Line หมอพร้อม (แสดงเฉพาะเมื่อ backend ตอบ mfa_required) ──
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
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
    if (challengeToken) otpInputRef.current?.focus()
  }, [challengeToken])

  // เก็บ cookie แล้วเข้าระบบ — ใช้ร่วมกันทั้งเส้นทางปกติและเส้นทาง MFA
  const completeLogin = (json: { token: string; data: { user_type_id: number }; username_change_required?: boolean }) => {
    // อายุ cookie = 8 ชม. ให้ตรงกับอายุ JWT ฝั่ง backend (exp: '8h')
    const COOKIE_HOURS = 8 / 24
    Cookies.set('auth_token', json.token, { expires: COOKIE_HOURS, sameSite: 'Lax' })
    Cookies.set('user_data', JSON.stringify(json.data), { expires: COOKIE_HOURS, sameSite: 'Lax' })
    Cookies.set('user_type_id', String(json.data.user_type_id), { expires: COOKIE_HOURS, sameSite: 'Lax' })
    // นโยบายอายุรหัสผ่าน: ไม่บล็อกที่นี่ — เข้าใช้งานได้ตามปกติ
    // แถบเตือนจะคำนวณจากวันที่เปลี่ยนรหัสล่าสุดผ่าน /users/me/password-status บนทุกหน้า
    //
    // นโยบายชื่อผู้ใช้โหมด force: พาไปตั้งชื่อใหม่ทันที (backend ปิดกั้น API อื่นไว้อยู่แล้ว
    // ถ้าพิมพ์ URL ตรงก็จะได้ 423 แล้วถูกพากลับมาที่นี่)
    router.push(json.username_change_required ? '/account/change-username' : '/home')
  }

  const handleLogin = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/auth/login`, {
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
        setChallengeToken(json.challenge_token)
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
      const res = await fetch(`/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_token: challengeToken, otp }),
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
      const res = await fetch(`/api/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_token: challengeToken }),
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
    setChallengeToken(null)
    setOtp('')
    setOtpNotice('')
    setCooldown(0)
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground selection:bg-accent-soft">
      {/* ───────────── พื้นหลัง: ภาพเต็มจอ + ชั้นไล่สีตามธีม ─────────────
          ทุกชั้นอ่านค่าจาก token --hero-* ธีมสว่างจึงหรี่ภาพลงแล้วไล่เป็นขาวอมม่วง
          แทนที่จะไล่เป็นม่วงเกือบดำ */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <Image
          src={BG_IMAGE}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ opacity: 'var(--hero-image-opacity)' }}
        />
        {/* ย้อมสี + ไล่ทึบเพื่อให้ข้อความอ่านง่าย */}
        <div
          className="absolute inset-0 mix-blend-color"
          style={{ background: 'var(--hero-tint)', opacity: 'var(--hero-tint-opacity)' }}
        />
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--hero-wash)' }} />
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--hero-fade)' }} />
        {/* vignette */}
        <div className="absolute inset-0" style={{ boxShadow: 'var(--hero-vignette)' }} />
        {/* แสงม่วงนวล */}
        <div className="absolute -top-40 -left-40 h-120 w-120 rounded-full bg-(--glow-1) blur-[150px]" />
        <div className="absolute top-1/3 -right-40 h-130 w-130 rounded-full bg-(--glow-2) blur-[170px]" />
        {/* เส้นตารางบางๆ */}
        <div
          className="absolute inset-0"
          style={{
            opacity: 'var(--grid-opacity)',
            backgroundImage:
              'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
      </div>

      {/* ปุ่มสลับธีม — หน้านี้ยังไม่มีแถบบน จึงลอยไว้มุมขวาบน */}
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <ThemeToggleButton />
      </div>

      <div className="relative z-10 flex min-h-screen w-full flex-col lg:flex-row">
        {/* ============================ LEFT — BRAND PANEL ============================ */}
        <div className="relative hidden w-full lg:flex lg:w-1/2 xl:w-3/5">
          <div className="flex h-full w-full flex-col justify-between p-10 xl:p-16">
            {/* Brand mark */}
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-line bg-linear-to-br from-violet-500 to-purple-800 shadow-lg shadow-violet-500/25">
                <FaLayerGroup className="text-xl text-ink" />
              </div>
              <div className="leading-tight">
                <div className="text-lg font-semibold tracking-[0.18em] text-ink">PYHOS WORKBENCH</div>
                <div className="text-xs tracking-wide text-accent/80">Hospital Data Workspace</div>
              </div>
            </div>

            {/* Hero text */}
            <div className="max-w-lg">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent-line bg-panel px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-accent backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_#a78bfa]" />
                Secure Access
              </div>
              <h1 className="mb-5 text-4xl font-semibold leading-[1.15] tracking-tight text-ink xl:text-5xl">
                เวิร์กเบนช์<br />
                {/* ไล่สีของหัวข้อสลับตามธีม — ม่วงอ่อนบนพื้นมืด, ม่วงเข้มบนพื้นขาว */}
                <span
                  className="bg-clip-text font-bold text-transparent"
                  style={{ backgroundImage: 'var(--headline-grad)' }}
                >
                  สืบค้นข้อมูลโรงพยาบาล
                </span>
              </h1>
              <div className="mb-5 h-px w-24 bg-linear-to-r from-violet-400/70 to-transparent" />
              <p className="text-base leading-relaxed text-ink-2/75">
                ค้นหา กรอง และเปรียบเทียบข้อมูลจากทุกระบบในที่เดียว — เปิดดูเป็นตาราง สรุปเป็นแดชบอร์ด
                หรือส่งออกไปทำงานต่อ ได้ในไม่กี่คลิก
              </p>

              {/* Mini dashboard preview */}
              <div className="mt-8 rounded-2xl border border-line bg-panel p-4 shadow-2xl shadow-black/40 backdrop-blur-md">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
                    ภาพรวมวันนี้
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-accent">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    อัปเดตสด
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                  {PREVIEW_STATS.map((s) => (
                    <div key={s.label} className="rounded-xl border border-line-faint bg-raised p-3">
                      <div className="truncate text-[10px] text-ink-3">{s.label}</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-ink">{s.value}</div>
                      <div
                        className={`mt-0.5 flex items-center gap-1 text-[10px] ${
                          s.up ? 'text-accent' : 'text-ink-3'
                        }`}
                      >
                        {s.up ? <FaArrowUp className="text-[8px]" /> : <FaArrowDown className="text-[8px]" />}
                        {s.delta}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Sparkline-style bars */}
                <div className="mt-4 flex h-16 items-end gap-1.5">
                  {PREVIEW_BARS.map((h, i) => (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className="flex-1 rounded-sm bg-linear-to-t from-violet-700/40 to-violet-300/80"
                    />
                  ))}
                </div>
              </div>

              {/* Feature pills */}
              <div className="mt-6 flex flex-wrap gap-2">
                {['สืบค้นข้อมูล', 'แดชบอร์ด', 'รายงาน', 'เปรียบเทียบย้อนหลัง', 'ส่งออก Excel/CSV'].map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink-2/90 backdrop-blur"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>

            {/* Footer note */}
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <FaShieldAlt className="text-accent" />
              เข้ารหัสด้วย TLS 1.3 · เข้าถึงข้อมูลตามสิทธิ์ที่ได้รับมอบหมาย
            </div>
          </div>
        </div>

        {/* ============================ RIGHT — LOGIN PANEL ============================ */}
        <div className="flex w-full flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:w-1/2 lg:px-10 xl:w-2/5 xl:px-16">
          <div className="w-full max-w-md">
            {/* Mobile-only branding */}
            <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent-line bg-linear-to-br from-violet-500 to-purple-800 shadow-lg shadow-violet-500/25">
                <FaLayerGroup className="text-lg text-ink" />
              </div>
              <div className="leading-tight">
                <div className="text-base font-semibold tracking-[0.16em] text-ink">PYHOS WORKBENCH</div>
                <div className="text-[11px] text-accent/80">Hospital Data Workspace</div>
              </div>
            </div>

            {/* Glass card */}
            <div className="relative rounded-3xl border border-line bg-card p-6 shadow-2xl shadow-(color:--card-shadow) backdrop-blur-2xl sm:p-8">
              {/* corner glow */}
              <div className="pointer-events-none absolute -top-px left-10 right-10 h-px bg-linear-to-r from-transparent via-accent/60 to-transparent" />

              <div className="mb-7 text-center">
                <h2 className="mb-1.5 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                  {challengeToken ? 'ยืนยันตัวตน' : 'เข้าสู่ระบบ'}
                </h2>
                <p className="text-sm text-ink-3">
                  {challengeToken
                    ? 'กรอกรหัส 6 หลักที่ส่งไปยัง Line หมอพร้อม'
                    : 'ยินดีต้อนรับกลับ — ลงชื่อเข้าใช้เพื่อเปิดพื้นที่ทำงานข้อมูลของท่าน'}
                </p>
              </div>

              {/* ─────────────── ขั้นที่ 2: ยืนยัน OTP ─────────────── */}
              {challengeToken ? (
                <form className="space-y-5" onSubmit={handleVerifyOtp}>
                  <div className="flex items-start gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3">
                    <FaMobileAlt className="mt-0.5 shrink-0 text-accent" />
                    <div className="text-xs leading-relaxed text-ink-2">
                      ส่งรหัสยืนยันไปยัง <span className="font-semibold">Line หมอพร้อม</span> ที่ผูกกับบัญชีของท่านแล้ว
                      <div className="mt-1 text-accent/70">
                        หากไม่ได้รับ กรุณาตรวจสอบว่าเพิ่มเพื่อนและผูกบัญชี Line หมอพร้อมไว้แล้ว
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="otp" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">
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
                      className="block w-full rounded-xl border border-line bg-raised py-3 text-center font-mono text-2xl tracking-[0.5em] text-ink placeholder:text-ink-3/40 outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                  </div>

                  {otpNotice && !error && (
                    <div className="rounded-xl border border-accent-line bg-accent-soft px-4 py-2.5 text-sm text-accent">
                      {otpNotice}
                    </div>
                  )}
                  {error && (
                    <div className="rounded-xl border border-danger-line bg-danger-bg px-4 py-2.5 text-sm text-danger">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || otp.length < 6}
                    className="group flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-linear-to-r from-violet-600 to-purple-700 px-4 py-3 text-sm font-semibold tracking-wide text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-violet-800/40 hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? 'กำลังยืนยัน...' : 'ยืนยันรหัส'}
                    {!loading && <FaArrowRight className="text-xs transition-transform group-hover:translate-x-0.5" />}
                  </button>

                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={backToPassword}
                      className="flex items-center gap-1.5 text-ink-3 transition hover:text-ink-2"
                    >
                      <FaArrowLeft className="text-[10px]" /> ย้อนกลับ
                    </button>
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={cooldown > 0 || loading}
                      className="font-medium text-accent transition hover:text-accent disabled:cursor-not-allowed disabled:text-ink-3"
                    >
                      {cooldown > 0 ? `ขอรหัสใหม่ได้ใน ${cooldown} วินาที` : 'ขอรหัสใหม่'}
                    </button>
                  </div>
                </form>
              ) : (
              <form className="space-y-5" onSubmit={handleLogin}>
                {/* Username */}
                <div>
                  <label htmlFor="username" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">
                    ชื่อผู้ใช้งาน
                  </label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-3 transition-colors group-focus-within:text-accent">
                      <FaUser className="text-sm" />
                    </span>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      required
                      placeholder="เช่น somchai.j"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="block w-full rounded-xl border border-line bg-raised py-3 pl-10 pr-3 text-sm text-ink placeholder:text-ink-3 outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">
                    รหัสผ่าน
                  </label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-3 transition-colors group-focus-within:text-accent">
                      <FaLock className="text-sm" />
                    </span>
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full rounded-xl border border-line bg-raised py-3 pl-10 pr-12 text-sm text-ink placeholder:text-ink-3 outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      className="absolute inset-y-0 right-3 flex items-center text-ink-3 transition-colors hover:text-accent"
                      aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    >
                      {showPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                </div>

                {/* Row: remember + forgot */}
                <div className="flex items-center justify-between text-sm">
                  <label className="flex cursor-pointer items-center gap-2 text-ink-2">
                    <input
                      type="checkbox"
                      name="remember-me"
                      className="h-4 w-4 cursor-pointer rounded border-accent-line bg-raised accent-violet-500 focus:ring-violet-500/40"
                    />
                    <span className="text-xs">จดจำฉันไว้</span>
                  </label>
                  <Link
                    href="#"
                    className="text-xs font-medium text-accent transition hover:text-accent"
                  >
                    ลืมรหัสผ่าน?
                  </Link>
                </div>

                {/* Error message */}
                {error && (
                  <div className="rounded-xl border border-danger-line bg-danger-bg px-4 py-2.5 text-sm text-danger">
                    {error}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="group flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-linear-to-r from-violet-600 to-purple-700 px-4 py-3 text-sm font-semibold tracking-wide text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-violet-800/40 hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                  {!loading && <FaArrowRight className="text-xs transition-transform group-hover:translate-x-0.5" />}
                </button>
              </form>
              )}

              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-3">
                  หรือ
                </span>
                <div className="h-px flex-1 bg-line" />
              </div>

              {/* Helper card */}
              <div className="rounded-xl border border-line-faint bg-raised p-3 text-center">
                <p className="text-xs text-ink-3">
                  ยังไม่มีสิทธิ์เข้าถึงข้อมูล?{' '}
                  <a href="#" className="font-medium text-accent hover:text-accent">
                    ติดต่อผู้ดูแลระบบ
                  </a>
                </p>
              </div>
            </div>

            {/* Bottom legal */}
            <div className="mt-6 text-center text-[11px] text-ink-3">
              © {new Date().getFullYear()} PYHOS Workbench
              <span className="mx-2">·</span>
              <a href="#" className="hover:text-ink-2">นโยบายความเป็นส่วนตัว</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
