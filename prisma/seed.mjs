import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 بدء إضافة المستخدمين...')

  // مسح المستخدمين الموجودين
  await prisma.user.deleteMany()

  const users = [
    { email: 'distributor@mission.com', name: 'مدير التوزيع', role: 'DISTRIBUTOR', password: '123456' },
    { email: 'survey.manager@mission.com', name: 'رئيس قسم المساحة', role: 'SURVEY_MANAGER', password: '123456' },
    { email: 'technical.manager@mission.com', name: 'رئيس المكتب الفني', role: 'TECHNICAL_MANAGER', password: '123456' },
    { email: 'gis.manager@mission.com', name: 'رئيس نظم المعلومات', role: 'GIS_MANAGER', password: '123456' },
    { email: 'survey.engineer@mission.com', name: 'مهندس مساحة', role: 'SURVEY_ENGINEER', password: '123456' },
    { email: 'technical.staff@mission.com', name: 'موظف فني', role: 'TECHNICAL_STAFF', password: '123456' },
    { email: 'gis.analyst@mission.com', name: 'محلل نظم المعلومات', role: 'GIS_ANALYST', password: '123456' },
  ]

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 10)
    await prisma.user.create({
      data: {
        email: user.email,
        name: user.name,
        role: user.role,
        password: hashedPassword,
      },
    })
    console.log(`✅ تم إضافة: ${user.name} (${user.email})`)
  }

  console.log('🎉 تم إضافة جميع المستخدمين بنجاح!')
  console.log('📝 كلمة المرور للجميع: 123456')
}

main()
  .catch(e => {
    console.error('❌ خطأ:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })