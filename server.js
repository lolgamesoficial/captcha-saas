const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Configuración API de 2Captcha
const TWO_CAPTCHA_KEY = process.env.TWO_CAPTCHA_KEY || 'd155362da6213ec339364526227167b8';

// Configuración PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicialización segura de Base de Datos
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        balance DECIMAL(10, 4) DEFAULT 0.0000,
        captchas_resueltos INT DEFAULT 0,
        api_key VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Base de datos verificada e inicializada correctamente.');
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err.message);
  }
};

initDb();

/* ==========================================
   RUTAS DE AUTENTICACIÓN
   ========================================== */

// Registro de usuarios
app.post('/api/registro', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ exito: false, mensaje: 'Todos los campos son obligatorios' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const apiKey = 'KEY-' + crypto.randomBytes(16).toString('hex');

    await pool.query(
      'INSERT INTO users (usuario, password, api_key) VALUES ($1, $2, $3)',
      [usuario, hashedPassword, apiKey]
    );

    res.json({ exito: true, mensaje: 'Usuario registrado con éxito' });
  } catch (err) {
    console.error('❌ Error en /api/registro:', err.message);
    if (err.code === '23505') {
      return res.status(400).json({ exito: false, mensaje: 'El nombre de usuario ya existe' });
    }
    res.status(500).json({ exito: false, mensaje: 'Error interno del servidor' });
  }
});

// Login de usuarios
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ exito: false, mensaje: 'Todos los campos son obligatorios' });
  }

  try {
    const userQuery = await pool.query('SELECT * FROM users WHERE usuario = $1', [usuario]);
    if (userQuery.rows.length === 0) {
      return res.status(400).json({ exito: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    const user = userQuery.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ exito: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    res.json({
      exito: true,
      mensaje: 'Inicio de sesión exitoso',
      usuario: { 
        id: user.id, 
        nombre: user.usuario, 
        saldo: parseFloat(user.balance || 0).toFixed(3), 
        captchasResueltos: user.captchas_resueltos || 0 
      }
    });
  } catch (err) {
    console.error('❌ Error en /api/login:', err.message);
    res.status(500).json({ exito: false, mensaje: 'Error interno del servidor' });
  }
});

/* ==========================================
   RUTAS DE TRABAJO (2CAPTCHA API)
   ========================================== */

// Solicitar un captcha real a 2Captcha
app.get('/api/obtener-captcha', async (req, res) => {
  try {
    const response = await axios.get(`http://2captcha.com/in.php?key=${TWO_CAPTCHA_KEY}&action=gettask&json=1`);
    if (response.data && response.data.status === 1) {
      res.json({ exito: true, captchaId: response.data.request, imagenUrl: response.data.url });
    } else {
      res.json({ exito: false, mensaje: 'No hay captchas disponibles de 2Captcha actualmente' });
    }
  } catch (err) {
    console.error('❌ Error obteniendo captcha de 2Captcha:', err.message);
    res.status(500).json({ exito: false, mensaje: 'Error al conectar con el proveedor de captchas' });
  }
});

// Enviar resolución y actualizar ganancias
app.post('/api/resolver', async (req, res) => {
  const { usuarioId, captchaId, respuesta } = req.body;

  if (!usuarioId) {
    return res.status(400).json({ exito: false, mensaje: 'Usuario no identificado' });
  }

  try {
    // Si viene un ID de captcha y respuesta, reportamos la solución a 2Captcha
    if (captchaId && respuesta) {
      await axios.get(`http://2captcha.com/res.php?key=${TWO_CAPTCHA_KEY}&action=reportbad&id=${captchaId}`);
    }

    // Acreditar resolución y saldo en tu base de datos
    const result = await pool.query(
      'UPDATE users SET captchas_resueltos = COALESCE(captchas_resueltos, 0) + 1, balance = COALESCE(balance, 0) + 0.001 WHERE id = $1 RETURNING captchas_resueltos, balance',
      [usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ exito: false, mensaje: 'Usuario no encontrado' });
    }

    const totalCaptchas = result.rows[0].captchas_resueltos;
    const saldoAcumulado = parseFloat(result.rows[0].balance).toFixed(3);
    const mostrarAnuncio = totalCaptchas % 20 === 0;

    res.json({
      exito: true,
      totalCaptchas,
      saldoAcumulado,
      mostrarAnuncio
    });
  } catch (err) {
    console.error('❌ Error en /api/resolver:', err.message);
    res.status(500).json({ exito: false, mensaje: 'Error al procesar el captcha' });
  }
});

/* ==========================================
   RUTA PRINCIPAL
   ========================================== */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Servidor activo en puerto ${port}`);
});