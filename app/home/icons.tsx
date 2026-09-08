'use client'
import Icon from '@ant-design/icons'
import { FaMotorcycle } from 'react-icons/fa'

/**
 * ไอคอนที่ชุด @ant-design/icons ไม่มีให้
 *
 * ห่อด้วย Icon ของ antd แทนการวาง svg ของ react-icons ตรง ๆ เพราะตัวห่อใส่คลาส
 * anticon ให้ ซึ่งเป็นตัวจัดขนาดและแนวให้ตรงกับไอคอนอื่นในเมนูและหัวข้อ
 * ถ้าใช้ svg เปล่า ๆ ไอคอนจะลอยสูงกว่าตัวอักษรเล็กน้อยในทุกที่ที่ใช้
 */

/** มอเตอร์ไซค์ — ใช้แทนรถยนต์ในงาน Health Rider เพราะคนส่งยาใช้มอเตอร์ไซค์จริง */
export function MotorcycleOutlined(props: { className?: string }) {
  return <Icon component={FaMotorcycle} {...props} />
}
