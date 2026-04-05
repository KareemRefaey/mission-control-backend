import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import sqlite3 from 'sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import fs from 'fs'
import http from 'http'
import { Server } from 'socket.io'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config()

const app = express()
const server = http.createServer(app)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Socket.io configuration
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})

// Store user sockets
const userSockets = new Map()

// Middleware
app.use(cors())
app.use(express.json())

// Database
const db = new sqlite3.Database('./missions.db')

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads'
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir)
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})

const upload = multer({ storage: storage })

// Socket authentication
io.use((socket, next) => {
  const token = socket.handshake.query.token
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
      socket.userId = decoded.id
      socket.userRole = decoded.role
      socket.userName = decoded.name
      next()
    } catch (err) {
      next(new Error('Authentication error'))
    }
  } else {
    next(new Error('Authentication error'))
  }
})

io.on('connection', (socket) => {
  console.log(`✅ مستخدم متصل: ${socket.userName} (${socket.userRole})`)
  userSockets.set(socket.userId, socket.id)

  socket.on('disconnect', () => {
    console.log(`❌ مستخدم غير متصل: ${socket.userName}`)
    userSockets.delete(socket.userId)
  })
})

// Notification functions
const sendNotification = (userId, notification) => {
  const socketId = userSockets.get(userId)
  if (socketId) {
    io.to(socketId).emit('new_notification', notification)
  }
}

const notifyMissionAssigned = (userId, missionTitle, missionId) => {
  sendNotification(userId, {
    title: '📋 مأمورية جديدة',
    message: `تم توزيع "${missionTitle}" عليك`,
    missionId,
    type: 'assigned'
  })
}

const notifyMissionApproved = (userId, missionTitle, missionId) => {
  sendNotification(userId, {
    title: '✅ تم قبول المأمورية',
    message: `تم قبول "${missionTitle}" وتمريرها للمرحلة التالية`,
    missionId,
    type: 'approved'
  })
}

const notifyMissionRejected = (userId, missionTitle, notes) => {
  sendNotification(userId, {
    title: '❌ تم رفض المأمورية',
    message: notes || `تم رفض "${missionTitle}"، يرجى المراجعة`,
    type: 'rejected'
  })
}

// Helper function for mission logs
const addMissionLog = (missionId, userId, userName, userRole, action, stage) => {
  const id = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5)
  const createdAt = new Date().toISOString()
  
  db.run(
    `INSERT INTO mission_logs (id, missionId, userId, userName, userRole, action, stage, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, missionId, userId, userName, userRole, action, stage, createdAt],
    (err) => {
      if (err) console.error('❌ فشل تسجيل الحدث:', err)
    }
  )
}

// Create all tables
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      password TEXT,
      role TEXT,
      createdAt TEXT
    )
  `, (err) => {
    if (err) {
      console.error('❌ خطأ في إنشاء جدول المستخدمين:', err.message)
    } else {
      console.log('✅ جدول المستخدمين جاهز')
      
      const users = [
        { id: '1', email: 'distributor@mission.com', name: 'مدير التوزيع', role: 'DISTRIBUTOR', password: '123456' },
        { id: '2', email: 'survey.manager@mission.com', name: 'رئيس قسم المساحة', role: 'SURVEY_MANAGER', password: '123456' },
        { id: '3', email: 'technical.manager@mission.com', name: 'رئيس المكتب الفني', role: 'TECHNICAL_MANAGER', password: '123456' },
        { id: '4', email: 'gis.manager@mission.com', name: 'رئيس نظم المعلومات', role: 'GIS_MANAGER', password: '123456' },
        { id: '5', email: 'ahmed.ali@mission.com', name: 'أحمد علي', role: 'SURVEY_ENGINEER', password: '123456' },
        { id: '6', email: 'technical.staff@mission.com', name: 'سعيد محمود', role: 'TECHNICAL_STAFF', password: '123456' },
        { id: '7', email: 'gis.analyst@mission.com', name: 'مروان محمد', role: 'GIS_ANALYST', password: '123456' },
      ]

      users.forEach(user => {
        const hashedPassword = bcrypt.hashSync(user.password, 10)
        db.run(
          `INSERT OR IGNORE INTO users (id, email, name, password, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
          [user.id, user.email, user.name, hashedPassword, user.role, new Date().toISOString()]
        )
      })
      console.log('✅ تم إضافة المستخدمين التجريبيين')
    }
  })

  // Missions table
  db.run(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      stage TEXT DEFAULT 'survey',
      createdBy TEXT,
      assignedTo TEXT,
      createdAt TEXT,
      dueDate TEXT,
      reviewNotes TEXT,
      surveyData TEXT,
      technicalData TEXT,
      gisData TEXT,
      FOREIGN KEY (createdBy) REFERENCES users(id),
      FOREIGN KEY (assignedTo) REFERENCES users(id)
    )
  `, (err) => {
    if (err) {
      console.error('❌ خطأ في إنشاء جدول المأموريات:', err.message)
    } else {
      console.log('✅ جدول المأموريات جاهز')
    }
  })

  // Mission logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS mission_logs (
      id TEXT PRIMARY KEY,
      missionId TEXT,
      userId TEXT,
      userName TEXT,
      userRole TEXT,
      action TEXT,
      stage TEXT,
      createdAt TEXT,
      FOREIGN KEY (missionId) REFERENCES missions(id)
    )
  `, (err) => {
    if (err) {
      console.error('❌ خطأ في إنشاء جدول السجل:', err.message)
    } else {
      console.log('✅ جدول السجل جاهز')
    }
  })

  // Files table
  db.run(`
    CREATE TABLE IF NOT EXISTS mission_files (
      id TEXT PRIMARY KEY,
      missionId TEXT,
      userId TEXT,
      fileName TEXT,
      originalName TEXT,
      filePath TEXT,
      fileType TEXT,
      stage TEXT,
      uploadedAt TEXT,
      FOREIGN KEY (missionId) REFERENCES missions(id),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `, (err) => {
    if (err) {
      console.error('❌ خطأ في إنشاء جدول الملفات:', err.message)
    } else {
      console.log('✅ جدول الملفات جاهز')
    }
  })
})

// ============== Helper functions for export ==============

function getStatusTextForExport(status) {
  switch(status) {
    case 'pending': return 'قيد الانتظار'
    case 'in_progress': return 'جاري العمل'
    case 'pending_review': return 'بانتظار المراجعة'
    case 'rejected': return 'مرفوضة'
    case 'completed': return 'مكتملة'
    default: return status
  }
}

function getStageTextForExport(stage) {
  switch(stage) {
    case 'survey': return 'مرحلة المساحة'
    case 'technical': return 'مرحلة المكتب الفني'
    case 'gis': return 'مرحلة نظم المعلومات'
    case 'completed': return 'مكتملة'
    default: return stage
  }
}

// ============== Authentication API ==============

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body
  console.log('📝 محاولة تسجيل دخول:', email)

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) {
      console.error('❌ خطأ في قاعدة البيانات:', err.message)
      return res.status(500).json({ message: 'خطأ في السيرفر' })
    }
    
    if (!user) {
      console.log('❌ مستخدم غير موجود:', email)
      return res.status(401).json({ message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' })
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      console.log('❌ كلمة مرور خاطئة لـ:', email)
      return res.status(401).json({ message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' })
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '7d' }
    )

    console.log('✅ تسجيل دخول ناجح:', email)
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    })
  })
})

// ============== Missions API ==============

app.get('/api/my-tasks', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const userRole = decoded.role
    const userId = decoded.id

    if (userRole === 'SURVEY_ENGINEER') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.assignedTo = ? AND m.stage = 'survey' AND m.status = 'in_progress'`,
        [userId],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }
    
    if (userRole === 'TECHNICAL_STAFF') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.assignedTo = ? AND m.stage = 'technical' AND m.status = 'in_progress'`,
        [userId],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }
    
    if (userRole === 'GIS_ANALYST') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.assignedTo = ? AND m.stage = 'gis' AND m.status = 'in_progress'`,
        [userId],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }

    if (userRole === 'SURVEY_MANAGER') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.stage = 'survey' AND (m.status = 'pending' OR m.status = 'pending_review')`,
        [],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }
    
    if (userRole === 'TECHNICAL_MANAGER') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.stage = 'technical' AND (m.status = 'pending' OR m.status = 'pending_review')`,
        [],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }
    
    if (userRole === 'GIS_MANAGER') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.stage = 'gis' AND (m.status = 'pending' OR m.status = 'pending_review')`,
        [],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }

    if (userRole === 'DISTRIBUTOR') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.status != 'completed'
         ORDER BY m.createdAt DESC`,
        [],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }

    res.json([])
  } catch (error) {
    console.error('خطأ:', error)
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.get('/api/my-completed-tasks', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const userRole = decoded.role
    const userId = decoded.id

    if (userRole === 'SURVEY_ENGINEER') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.assignedTo = ? AND m.stage = 'survey' AND (m.status = 'pending_review' OR m.status = 'rejected')`,
        [userId],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }
    
    if (userRole === 'TECHNICAL_STAFF') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.assignedTo = ? AND m.stage = 'technical' AND (m.status = 'pending_review' OR m.status = 'rejected')`,
        [userId],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }
    
    if (userRole === 'GIS_ANALYST') {
      db.all(
        `SELECT m.*, creator.name as creatorName, assignee.name as assigneeName
         FROM missions m
         LEFT JOIN users creator ON m.createdBy = creator.id
         LEFT JOIN users assignee ON m.assignedTo = assignee.id
         WHERE m.assignedTo = ? AND m.stage = 'gis' AND (m.status = 'pending_review' OR m.status = 'rejected')`,
        [userId],
        (err, missions) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          res.json(missions)
        }
      )
      return
    }

    res.json([])
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.get('/api/completed-missions', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const userRole = decoded.role

    let query = `
      SELECT m.*, 
             creator.name as creatorName,
             assignee.name as assigneeName
      FROM missions m
      LEFT JOIN users creator ON m.createdBy = creator.id
      LEFT JOIN users assignee ON m.assignedTo = assignee.id
      WHERE m.status = 'completed'
    `

    if (userRole === 'DISTRIBUTOR') {
      query += ` ORDER BY m.createdAt DESC`
      return db.all(query, [], (err, missions) => {
        if (err) return res.status(500).json({ message: 'خطأ' })
        return res.json(missions)
      })
    }

    if (userRole.includes('MANAGER')) {
      query += ` AND m.stage = '${userRole === 'SURVEY_MANAGER' ? 'survey' : userRole === 'TECHNICAL_MANAGER' ? 'technical' : 'gis'}'`
    }

    db.all(query, [], (err, missions) => {
      if (err) return res.status(500).json({ message: 'خطأ' })
      res.json(missions)
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.post('/api/missions', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية إنشاء مأموريات' })
    }

    const { title, description, dueDate, assignedTo } = req.body
    const id = Date.now().toString()
    const createdAt = new Date().toISOString()

    db.get(`SELECT id, name, role FROM users WHERE id = ?`, [assignedTo], (err, manager) => {
      if (err || !manager) {
        return res.status(400).json({ message: 'المدير المختار غير موجود' })
      }

      let initialStage = 'survey'
      if (manager.role === 'TECHNICAL_MANAGER') initialStage = 'technical'
      else if (manager.role === 'GIS_MANAGER') initialStage = 'gis'

      db.run(
        `INSERT INTO missions (id, title, description, status, stage, createdBy, assignedTo, createdAt, dueDate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, description, 'pending', initialStage, decoded.id, assignedTo, createdAt, dueDate],
        (err) => {
          if (err) {
            console.error('خطأ:', err)
            return res.status(500).json({ message: 'خطأ في إنشاء المأمورية' })
          }

          addMissionLog(id, decoded.id, decoded.name, decoded.role, 'created', initialStage)
          res.json({ success: true, message: 'تم إنشاء المأمورية بنجاح', missionId: id })
        }
      )
    })
  } catch (error) {
    console.error('خطأ:', error)
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.put('/api/missions/:id/assign', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const { id } = req.params
    const { employeeId } = req.body

    const allowedRoles = ['SURVEY_MANAGER', 'TECHNICAL_MANAGER', 'GIS_MANAGER']
    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).json({ message: 'ليس لديك صلاحية توزيع المأموريات' })
    }

    db.get(`SELECT name, role, title FROM missions WHERE id = ?`, [id], (err, mission) => {
      if (err || !mission) {
        return res.status(400).json({ message: 'المأمورية غير موجودة' })
      }

      db.get(`SELECT name, role FROM users WHERE id = ?`, [employeeId], (err, employee) => {
        if (err || !employee) {
          return res.status(400).json({ message: 'الموظف غير موجود' })
        }

        db.run(
          `UPDATE missions SET assignedTo = ?, status = 'in_progress' WHERE id = ?`,
          [employeeId, id],
          (err) => {
            if (err) {
              console.error('خطأ:', err)
              return res.status(500).json({ message: 'خطأ في توزيع المأمورية' })
            }

            addMissionLog(id, decoded.id, decoded.name, decoded.role, `assigned_to_${employee.role}`, 'assign')
            addMissionLog(id, employeeId, employee.name, employee.role, 'received', 'assign')
            
            // Send notification to employee
            notifyMissionAssigned(employeeId, mission.title, id)
            
            res.json({ success: true, message: 'تم توزيع المأمورية بنجاح' })
          }
        )
      })
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.put('/api/missions/:id/approve', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const { id } = req.params
    const userRole = decoded.role

    let nextStage = ''
    let nextRole = ''

    if (userRole === 'SURVEY_MANAGER') {
      nextStage = 'technical'
      nextRole = 'TECHNICAL_MANAGER'
    } else if (userRole === 'TECHNICAL_MANAGER') {
      nextStage = 'gis'
      nextRole = 'GIS_MANAGER'
    } else if (userRole === 'GIS_MANAGER') {
      nextStage = 'completed'
    } else {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    db.get(`SELECT title, assignedTo FROM missions WHERE id = ?`, [id], (err, mission) => {
      if (err || !mission) {
        return res.status(404).json({ message: 'المأمورية غير موجودة' })
      }

      if (nextStage === 'completed') {
        db.run(
          `UPDATE missions SET status = 'completed', stage = 'completed', assignedTo = NULL WHERE id = ?`,
          [id],
          (err) => {
            if (err) {
              console.error('❌ فشل إكمال المأمورية:', err)
              return res.status(500).json({ message: 'خطأ في إكمال المأمورية' })
            }
            
            addMissionLog(id, decoded.id, decoded.name, decoded.role, 'completed', 'final')
            notifyMissionApproved(mission.assignedTo, mission.title, id)
            res.json({ success: true, message: 'تم إكمال المأمورية بنجاح' })
          }
        )
        return
      }

      db.get(`SELECT id, name, role FROM users WHERE role = ? LIMIT 1`, [nextRole], (err, nextManager) => {
        if (err || !nextManager) {
          return res.status(500).json({ message: `لم يتم العثور على مدير للمرحلة ${nextStage}` })
        }

        db.run(
          `UPDATE missions SET stage = ?, status = 'pending', assignedTo = ? WHERE id = ?`,
          [nextStage, nextManager.id, id],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'خطأ في تمرير المأمورية' })
            }
            
            addMissionLog(id, decoded.id, decoded.name, decoded.role, 'approved', nextStage)
            notifyMissionApproved(nextManager.id, mission.title, id)
            res.json({ success: true, message: `تم تمرير المأمورية إلى المدير التالي` })
          }
        )
      })
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.put('/api/missions/:id/reject', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const { id } = req.params
    const { notes } = req.body

    const allowedRoles = ['SURVEY_MANAGER', 'TECHNICAL_MANAGER', 'GIS_MANAGER']
    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    db.get(`SELECT title, assignedTo FROM missions WHERE id = ?`, [id], (err, mission) => {
      if (err || !mission) {
        return res.status(404).json({ message: 'المأمورية غير موجودة' })
      }

      db.run(
        `UPDATE missions SET status = 'rejected', reviewNotes = ? WHERE id = ?`,
        [notes || 'تم رفض المأمورية، يرجى المراجعة', id],
        (err) => {
          if (err) {
            return res.status(500).json({ message: 'خطأ في رفض المأمورية' })
          }
          
          addMissionLog(id, decoded.id, decoded.name, decoded.role, 'rejected', 'review')
          notifyMissionRejected(mission.assignedTo, mission.title, notes)
          res.json({ success: true, message: 'تم رفض المأمورية وإعادتها للموظف' })
        }
      )
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.put('/api/missions/:id/resubmit', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const { id } = req.params

    db.run(
      `UPDATE missions SET status = 'pending_review', reviewNotes = NULL WHERE id = ? AND assignedTo = ?`,
      [id, decoded.id],
      (err) => {
        if (err) {
          return res.status(500).json({ message: 'خطأ في إعادة تقديم المأمورية' })
        }
        
        addMissionLog(id, decoded.id, decoded.name, decoded.role, 'resubmitted', 'review')
        res.json({ success: true, message: 'تم إعادة تقديم المأمورية للمراجعة' })
      }
    )
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.delete('/api/missions/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية حذف المأموريات' })
    }

    const { id } = req.params

    db.get(`SELECT * FROM missions WHERE id = ?`, [id], (err, mission) => {
      if (err || !mission) {
        return res.status(404).json({ message: 'المأمورية غير موجودة' })
      }

      db.all(`SELECT * FROM mission_files WHERE missionId = ?`, [id], (err, files) => {
        if (!err && files) {
          files.forEach(file => {
            if (fs.existsSync(file.filePath)) {
              fs.unlinkSync(file.filePath)
            }
          })
        }

        db.run(`DELETE FROM mission_files WHERE missionId = ?`, [id])
        db.run(`DELETE FROM mission_logs WHERE missionId = ?`, [id])
        db.run(`DELETE FROM missions WHERE id = ?`, [id], (err) => {
          if (err) {
            console.error('خطأ:', err)
            return res.status(500).json({ message: 'خطأ في حذف المأمورية' })
          }
          
          res.json({ success: true, message: 'تم حذف المأمورية بنجاح' })
        })
      })
    })
  } catch (error) {
    console.error('خطأ:', error)
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.get('/api/department/employees', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    let roleFilter = ''
    if (decoded.role === 'SURVEY_MANAGER') {
      roleFilter = 'SURVEY_ENGINEER'
    } else if (decoded.role === 'TECHNICAL_MANAGER') {
      roleFilter = 'TECHNICAL_STAFF'
    } else if (decoded.role === 'GIS_MANAGER') {
      roleFilter = 'GIS_ANALYST'
    } else {
      return res.status(403).json({ message: 'غير مصرح' })
    }

    db.all(
      `SELECT id, name, email, role FROM users WHERE role = ?`,
      [roleFilter],
      (err, employees) => {
        if (err) {
          return res.status(500).json({ message: 'خطأ في السيرفر' })
        }
        res.json(employees)
      }
    )
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.get('/api/users', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  db.all(`SELECT id, name, email, role FROM users ORDER BY role`, [], (err, users) => {
    if (err) {
      return res.status(500).json({ message: 'خطأ في السيرفر' })
    }
    res.json(users)
  })
})

app.get('/api/missions/:id/logs', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  const { id } = req.params

  db.all(
    `SELECT * FROM mission_logs WHERE missionId = ? ORDER BY createdAt ASC`,
    [id],
    (err, logs) => {
      if (err) {
        return res.status(500).json({ message: 'خطأ في السيرفر' })
      }
      res.json(logs)
    }
  )
})

// ============== Reports API ==============

app.get('/api/reports/excel', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    const { startDate, endDate, status, stage } = req.query

    let query = `
      SELECT m.*, 
             creator.name as creatorName,
             assignee.name as assigneeName
      FROM missions m
      LEFT JOIN users creator ON m.createdBy = creator.id
      LEFT JOIN users assignee ON m.assignedTo = assignee.id
      WHERE 1=1
    `
    let params = []

    if (startDate) {
      query += ` AND m.createdAt >= ?`
      params.push(startDate)
    }
    if (endDate) {
      query += ` AND m.createdAt <= ?`
      params.push(endDate + 'T23:59:59')
    }
    if (status && status !== 'all') {
      query += ` AND m.status = ?`
      params.push(status)
    }
    if (stage && stage !== 'all') {
      query += ` AND m.stage = ?`
      params.push(stage)
    }

    query += ` ORDER BY m.createdAt DESC`

    db.all(query, params, async (err, missions) => {
      if (err) {
        console.error('خطأ:', err)
        return res.status(500).json({ message: 'خطأ في جلب البيانات' })
      }

      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('المأموريات')

      worksheet.columns = [
        { header: 'المعرف', key: 'id', width: 20 },
        { header: 'العنوان', key: 'title', width: 30 },
        { header: 'الوصف', key: 'description', width: 40 },
        { header: 'الحالة', key: 'status', width: 15 },
        { header: 'المرحلة', key: 'stage', width: 20 },
        { header: 'منشئ بواسطة', key: 'creatorName', width: 20 },
        { header: 'مسند إلى', key: 'assigneeName', width: 20 },
        { header: 'تاريخ الإنشاء', key: 'createdAt', width: 20 },
        { header: 'تاريخ التسليم', key: 'dueDate', width: 20 },
      ]

      worksheet.getRow(1).font = { bold: true }
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF667eea' }
      }

      missions.forEach(mission => {
        worksheet.addRow({
          id: mission.id,
          title: mission.title,
          description: mission.description || '',
          status: getStatusTextForExport(mission.status),
          stage: getStageTextForExport(mission.stage),
          creatorName: mission.creatorName || '',
          assigneeName: mission.assigneeName || '',
          createdAt: new Date(mission.createdAt).toLocaleDateString('ar-EG'),
          dueDate: mission.dueDate ? new Date(mission.dueDate).toLocaleDateString('ar-EG') : ''
        })
      })

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename=missions_report_${Date.now()}.xlsx`)

      await workbook.xlsx.write(res)
      res.end()
    })
  } catch (error) {
    console.error('خطأ:', error)
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.get('/api/reports/pdf', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    const { startDate, endDate, status, stage } = req.query

    let query = `
      SELECT m.*, 
             creator.name as creatorName,
             assignee.name as assigneeName
      FROM missions m
      LEFT JOIN users creator ON m.createdBy = creator.id
      LEFT JOIN users assignee ON m.assignedTo = assignee.id
      WHERE 1=1
    `
    let params = []

    if (startDate) {
      query += ` AND m.createdAt >= ?`
      params.push(startDate)
    }
    if (endDate) {
      query += ` AND m.createdAt <= ?`
      params.push(endDate + 'T23:59:59')
    }
    if (status && status !== 'all') {
      query += ` AND m.status = ?`
      params.push(status)
    }
    if (stage && stage !== 'all') {
      query += ` AND m.stage = ?`
      params.push(stage)
    }

    query += ` ORDER BY m.createdAt DESC`

    db.all(query, params, (err, missions) => {
      if (err) {
        console.error('خطأ:', err)
        return res.status(500).json({ message: 'خطأ في جلب البيانات' })
      }

      const doc = new PDFDocument({ margin: 50, size: 'A4' })
      
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename=missions_report_${Date.now()}.pdf`)

      doc.pipe(res)

      doc.fontSize(20).font('Helvetica-Bold').text('تقرير المأموريات', { align: 'center' })
      doc.moveDown()
      
      doc.fontSize(10).font('Helvetica')
      doc.text(`تاريخ التقرير: ${new Date().toLocaleDateString('ar-EG')}`, { align: 'right' })
      if (startDate) doc.text(`من تاريخ: ${new Date(startDate).toLocaleDateString('ar-EG')}`, { align: 'right' })
      if (endDate) doc.text(`إلى تاريخ: ${new Date(endDate).toLocaleDateString('ar-EG')}`, { align: 'right' })
      doc.text(`إجمالي المأموريات: ${missions.length}`, { align: 'right' })
      doc.moveDown()

      const tableTop = 150
      let currentTop = tableTop

      doc.fontSize(10).font('Helvetica-Bold')
      doc.text('المعرف', 50, currentTop)
      doc.text('العنوان', 150, currentTop)
      doc.text('الحالة', 350, currentTop)
      doc.text('المرحلة', 430, currentTop)
      doc.text('تاريخ الإنشاء', 500, currentTop)
      
      currentTop += 20
      doc.font('Helvetica')

      missions.forEach((mission) => {
        if (currentTop > 700) {
          doc.addPage()
          currentTop = 50
          doc.fontSize(10).font('Helvetica-Bold')
          doc.text('المعرف', 50, currentTop)
          doc.text('العنوان', 150, currentTop)
          doc.text('الحالة', 350, currentTop)
          doc.text('المرحلة', 430, currentTop)
          doc.text('تاريخ الإنشاء', 500, currentTop)
          currentTop += 20
          doc.font('Helvetica')
        }

        doc.fontSize(9)
        doc.text(mission.id.substring(0, 8), 50, currentTop)
        doc.text(mission.title.substring(0, 25), 150, currentTop)
        doc.text(getStatusTextForExport(mission.status), 350, currentTop)
        doc.text(getStageTextForExport(mission.stage), 430, currentTop)
        doc.text(new Date(mission.createdAt).toLocaleDateString('ar-EG'), 500, currentTop)
        
        currentTop += 20
      })

      doc.end()
    })
  } catch (error) {
    console.error('خطأ:', error)
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

// ============== File Upload API ==============

app.post('/api/missions/:id/upload', upload.single('file'), (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const { id } = req.params
    const { stage } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ message: 'الرجاء اختيار ملف' })
    }

    const fileId = Date.now().toString()
    const uploadedAt = new Date().toISOString()

    db.run(
      `INSERT INTO mission_files (id, missionId, userId, fileName, originalName, filePath, fileType, stage, uploadedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fileId, id, decoded.id, file.filename, file.originalname, file.path, file.mimetype, stage, uploadedAt],
      async (err) => {
        if (err) {
          console.error('خطأ:', err)
          return res.status(500).json({ message: 'خطأ في حفظ الملف' })
        }

        db.run(
          `UPDATE missions SET status = 'pending_review' WHERE id = ?`,
          [id],
          (updateErr) => {
            if (updateErr) console.error('❌ فشل تحديث الحالة:', updateErr)
          }
        )

        addMissionLog(id, decoded.id, decoded.name, decoded.role, 'uploaded_files', stage)
        res.json({ success: true, message: 'تم رفع الملف بنجاح، في انتظار المراجعة', file: file })
      }
    )
  } catch (error) {
    console.error('خطأ:', error)
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.get('/api/missions/:id/files', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  const { id } = req.params

  db.all(
    `SELECT f.*, u.name as uploadedByName 
     FROM mission_files f
     JOIN users u ON f.userId = u.id
     WHERE f.missionId = ?
     ORDER BY f.uploadedAt DESC`,
    [id],
    (err, files) => {
      if (err) {
        return res.status(500).json({ message: 'خطأ في السيرفر' })
      }
      res.json(files)
    }
  )
})

app.get('/api/files/:id/download', (req, res) => {
  const { id } = req.params
  const token = req.query.token || req.headers.authorization?.split(' ')[1]
  
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }
  
  try {
    jwt.verify(token, process.env.JWT_SECRET || 'secret123')
  } catch (error) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  db.get(`SELECT * FROM mission_files WHERE id = ?`, [id], (err, file) => {
    if (err || !file) {
      return res.status(404).json({ message: 'الملف غير موجود' })
    }
    
    if (!fs.existsSync(file.filePath)) {
      return res.status(404).json({ message: 'الملف غير موجود على السيرفر' })
    }
    
    res.download(file.filePath, file.originalName)
  })
})

app.delete('/api/files/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const { id } = req.params

    db.get(`SELECT * FROM mission_files WHERE id = ?`, [id], (err, file) => {
      if (err || !file) {
        return res.status(404).json({ message: 'الملف غير موجود' })
      }

      if (file.userId !== decoded.id && decoded.role !== 'DISTRIBUTOR') {
        return res.status(403).json({ message: 'ليس لديك صلاحية حذف هذا الملف' })
      }

      if (fs.existsSync(file.filePath)) {
        fs.unlinkSync(file.filePath)
      }

      db.run(`DELETE FROM mission_files WHERE id = ?`, [id], (err) => {
        if (err) {
          return res.status(500).json({ message: 'خطأ في حذف الملف' })
        }
        res.json({ success: true, message: 'تم حذف الملف بنجاح' })
      })
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

// ============== Dashboard API ==============

app.get('/api/dashboard/stats', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    const userRole = decoded.role
    const userId = decoded.id

    const stats = {}

    db.all(`SELECT status, COUNT(*) as count FROM missions GROUP BY status`, [], (err, statusCount) => {
      if (err) return res.status(500).json({ message: 'خطأ' })
      stats.byStatus = statusCount

      db.all(`SELECT stage, COUNT(*) as count FROM missions GROUP BY stage`, [], (err, stageCount) => {
        if (err) return res.status(500).json({ message: 'خطأ' })
        stats.byStage = stageCount

        const today = new Date().toISOString().split('T')[0]
        db.all(`SELECT COUNT(*) as count FROM missions WHERE dueDate < ? AND status != 'completed'`, [today], (err, lateCount) => {
          if (err) return res.status(500).json({ message: 'خطأ' })
          stats.lateMissions = lateCount[0]?.count || 0

          db.all(`SELECT role, COUNT(*) as count FROM users GROUP BY role`, [], (err, usersByRole) => {
            if (err) return res.status(500).json({ message: 'خطأ' })
            stats.usersByRole = usersByRole

            const lastWeek = new Date()
            lastWeek.setDate(lastWeek.getDate() - 7)
            db.all(`SELECT COUNT(*) as count FROM missions WHERE status = 'completed' AND createdAt > ?`, [lastWeek.toISOString()], (err, completedLastWeek) => {
              if (err) return res.status(500).json({ message: 'خطأ' })
              stats.completedLastWeek = completedLastWeek[0]?.count || 0

              if (userRole === 'DISTRIBUTOR') {
                db.all(`
                  SELECT u.name, u.role, COUNT(m.id) as missionCount 
                  FROM users u 
                  LEFT JOIN missions m ON u.id = m.assignedTo 
                  WHERE u.role != 'DISTRIBUTOR'
                  GROUP BY u.id 
                  ORDER BY missionCount DESC
                `, [], (err, employeeStats) => {
                  if (err) return res.status(500).json({ message: 'خطأ' })
                  stats.employeeStats = employeeStats
                  res.json(stats)
                })
              } else if (userRole.includes('MANAGER')) {
                let roleFilter = ''
                if (userRole === 'SURVEY_MANAGER') roleFilter = 'SURVEY_ENGINEER'
                else if (userRole === 'TECHNICAL_MANAGER') roleFilter = 'TECHNICAL_STAFF'
                else if (userRole === 'GIS_MANAGER') roleFilter = 'GIS_ANALYST'

                db.all(`
                  SELECT u.name, u.role, COUNT(m.id) as missionCount 
                  FROM users u 
                  LEFT JOIN missions m ON u.id = m.assignedTo 
                  WHERE u.role = ?
                  GROUP BY u.id 
                  ORDER BY missionCount DESC
                `, [roleFilter], (err, employeeStats) => {
                  if (err) return res.status(500).json({ message: 'خطأ' })
                  stats.employeeStats = employeeStats
                  
                  db.all(`
                    SELECT status, COUNT(*) as count 
                    FROM missions 
                    WHERE stage = ? 
                    GROUP BY status
                  `, [userRole === 'SURVEY_MANAGER' ? 'survey' : userRole === 'TECHNICAL_MANAGER' ? 'technical' : 'gis'], (err, deptStats) => {
                    if (err) return res.status(500).json({ message: 'خطأ' })
                    stats.deptStats = deptStats
                    res.json(stats)
                  })
                })
              } else {
                db.all(`
                  SELECT status, COUNT(*) as count 
                  FROM missions 
                  WHERE assignedTo = ? 
                  GROUP BY status
                `, [userId], (err, myStats) => {
                  if (err) return res.status(500).json({ message: 'خطأ' })
                  stats.myStats = myStats
                  res.json(stats)
                })
              }
            })
          })
        })
      })
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.get('/api/dashboard/employee-monthly-stats', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    const now = new Date()
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    
    db.all(`
      SELECT 
        u.id,
        u.name, 
        u.role,
        COUNT(DISTINCT ml.missionId) as completedCount
      FROM users u
      LEFT JOIN mission_logs ml ON u.id = ml.userId AND ml.action = 'uploaded_files' AND ml.createdAt > ?
      WHERE u.role != 'DISTRIBUTOR'
      GROUP BY u.id
      ORDER BY completedCount DESC
    `, [firstDayOfMonth], (err, monthlyStats) => {
      if (err) {
        console.error('خطأ:', err)
        return res.status(500).json({ message: 'خطأ في السيرفر' })
      }
      
      db.all(`
        SELECT 
          u.id,
          u.name,
          COUNT(DISTINCT ml.missionId) as totalCount
        FROM users u
        LEFT JOIN mission_logs ml ON u.id = ml.userId AND ml.action = 'uploaded_files'
        WHERE u.role != 'DISTRIBUTOR'
        GROUP BY u.id
      `, [], (err, totalStats) => {
        if (err) {
          console.error('خطأ:', err)
          return res.status(500).json({ message: 'خطأ في السيرفر' })
        }
        
        const result = monthlyStats.map(monthly => {
          const total = totalStats.find(t => t.id === monthly.id)
          return {
            name: monthly.name,
            role: monthly.role,
            monthlyCompleted: monthly.completedCount || 0,
            totalCompleted: total?.totalCount || 0
          }
        })
        
        res.json(result)
      })
    })
  } catch (error) {
    console.error('خطأ:', error)
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

// ============== Admin User Management API ==============

app.get('/api/admin/users', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    db.all(`SELECT id, email, name, role, createdAt FROM users ORDER BY role, name`, [], (err, users) => {
      if (err) {
        return res.status(500).json({ message: 'خطأ في السيرفر' })
      }
      res.json(users)
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.post('/api/admin/users', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    const { email, name, role, password } = req.body
    const id = Date.now().toString()
    const hashedPassword = bcrypt.hashSync(password || '123456', 10)
    const createdAt = new Date().toISOString()

    db.run(
      `INSERT INTO users (id, email, name, password, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, name, hashedPassword, role, createdAt],
      (err) => {
        if (err) {
          console.error('خطأ:', err)
          return res.status(500).json({ message: 'خطأ في إنشاء المستخدم' })
        }
        res.json({ success: true, message: 'تم إنشاء المستخدم بنجاح', userId: id })
      }
    )
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.put('/api/admin/users/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    const { id } = req.params
    const { name, email, role, password } = req.body

    let query = 'UPDATE users SET name = ?, email = ?, role = ?'
    let params = [name, email, role]

    if (password && password.trim() !== '') {
      const hashedPassword = bcrypt.hashSync(password, 10)
      query += ', password = ?'
      params.push(hashedPassword)
    }

    query += ' WHERE id = ?'
    params.push(id)

    db.run(query, params, (err) => {
      if (err) {
        console.error('خطأ:', err)
        return res.status(500).json({ message: 'خطأ في تحديث المستخدم' })
      }
      res.json({ success: true, message: 'تم تحديث المستخدم بنجاح' })
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

app.delete('/api/admin/users/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123')
    
    if (decoded.role !== 'DISTRIBUTOR') {
      return res.status(403).json({ message: 'ليس لديك صلاحية' })
    }

    const { id } = req.params

    if (id === decoded.id) {
      return res.status(400).json({ message: 'لا يمكن حذف حسابك الخاص' })
    }

    db.run(`DELETE FROM users WHERE id = ?`, [id], (err) => {
      if (err) {
        console.error('خطأ:', err)
        return res.status(500).json({ message: 'خطأ في حذف المستخدم' })
      }
      res.json({ success: true, message: 'تم حذف المستخدم بنجاح' })
    })
  } catch (error) {
    res.status(401).json({ message: 'انتهت الجلسة' })
  }
})

// Public test APIs
app.get('/api/public/missions', (req, res) => {
  db.all(`SELECT id, title, stage, assignedTo, status, createdBy FROM missions`, [], (err, missions) => {
    if (err) {
      return res.status(500).json({ error: err.message })
    }
    res.json(missions)
  })
})

app.get('/api/public/users', (req, res) => {
  db.all(`SELECT id, name, email, role FROM users`, [], (err, users) => {
    if (err) {
      return res.status(500).json({ error: err.message })
    }
    res.json(users)
  })
})

app.get('/', (req, res) => {
  res.json({ message: 'Mission Control API is running 🚀' })
})

// Start server
const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`)
  console.log(`📍 http://localhost:${PORT}`)
  console.log(`🔌 Socket.io ready for notifications`)
  console.log('\n📝 حسابات تجريبية (كلمة المرور: 123456):')
  console.log('   📧 distributor@mission.com - مدير التوزيع')
  console.log('   📧 survey.manager@mission.com - رئيس قسم المساحة')
  console.log('   📧 technical.manager@mission.com - رئيس المكتب الفني')
  console.log('   📧 gis.manager@mission.com - رئيس نظم المعلومات')
  console.log('   📧 ahmed.ali@mission.com - مهندس مساحة')
  console.log('   📧 technical.staff@mission.com - موظف فني')
  console.log('   📧 gis.analyst@mission.com - محلل نظم المعلومات\n')
})