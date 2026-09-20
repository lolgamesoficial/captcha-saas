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
        saldo: parseFloat(user.balance || 0).toFixed(4), 
        captchasResueltos: user.captchas_resueltos || 0 
      }
    });
  } catch (err) {
    console.error('❌ Error en /api/login:', err.message);
    res.status(500).json({ exito: false, mensaje: 'Error interno del servidor' });
  }
});

/* ==========================================
   RUTAS DE TRABAJO (PANEL 1: 2CAPTCHA + FALLBACK LOCAL)
   ========================================== */

// Generador de Captcha Local de Respaldo (para evitar cuellos de botella)
function generarCaptchaLocal() {
  const texto = Math.random().toString(36).substring(2, 8).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50" viewBox="0 0 150 50">
    <rect width="100%" height="100%" fill="#1a1a1e"/>
    <line x1="0" y1="10" x2="150" y2="40" stroke="#4CAF50" stroke-width="2"/>
    <line x1="0" y1="40" x2="150" y2="10" stroke="#333" stroke-width="2"/>
    <text x="20" y="35" font-family="Arial" font-size="28" font-weight="bold" fill="#ffffff" letter-spacing="4">${texto}</text>
  </svg>`;
  const imagenUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return { captchaId: 'LOCAL_' + Date.now(), imagenUrl, textoEsperado: texto };
}

// Almacén temporal de captchas locales
const sesionesCaptchas = new Map();

// Solicitar Captcha
app.get('/api/obtener-captcha', async (req, res) => {
  try {
    const response = await axios.get(`http://2captcha.com/in.php?key=${TWO_CAPTCHA_KEY}&action=gettask&json=1`, { timeout: 2000 }).catch(() => null);

    if (response && response.data && response.data.status === 1) {
      return res.json({ exito: true, captchaId: response.data.request, imagenUrl: response.data.url });
    }

    const captchaLocal = generarCaptchaLocal();
    sesionesCaptchas.set(captchaLocal.captchaId, captchaLocal.textoEsperado);

    res.json({
      exito: true,
      captchaId: captchaLocal.captchaId,
      imagenUrl: captchaLocal.imagenUrl
    });

  } catch (err) {
    const captchaLocal = generarCaptchaLocal();
    sesionesCaptchas.set(captchaLocal.captchaId, captchaLocal.textoEsperado);

    res.json({
      exito: true,
      captchaId: captchaLocal.captchaId,
      imagenUrl: captchaLocal.imagenUrl
    });
  }
});

// Enviar resolución y actualizar ganancias (REPARTO 50/50 + CÁLCULO POR BLOQUES DE 20)
app.post('/api/resolver', async (req, res) => {
  const { usuarioId, captchaId, respuesta } = req.body;

  if (!usuarioId) {
    return res.status(400).json({ exito: false, mensaje: 'Usuario no identificado' });
  }

  // Validación si el captcha era local
  if (captchaId && captchaId.startsWith('LOCAL_')) {
    const textoCorrecto = sesionesCaptchas.get(captchaId);
    if (textoCorrecto && respuesta.trim().toUpperCase() !== textoCorrecto) {
      return res.status(400).json({ exito: false, mensaje: 'Código captcha incorrecto. Intenta de nuevo.' });
    }
    sesionesCaptchas.delete(captchaId);
  }

  try {
    // 1. TARIFA GENERADA POR CAPTCHA ($0.0020 de valor real)
    const VALOR_REAL_GENERADO = 0.0020; 

    // 2. APLICAR 50% PARA EL TRABAJADOR Y 50% RETENIDO PARA LA EMPRESA
    const PAGO_TRABAJADOR = VALOR_REAL_GENERADO * 0.50; // $0.0010 netos al usuario

    // 3. ACTUALIZAR SALDO DEL TRABAJADOR EN BASE DE DATOS
    const result = await pool.query(
      'UPDATE users SET captchas_resueltos = COALESCE(captchas_resueltos, 0) + 1, balance = COALESCE(balance, 0) + $1 WHERE id = $2 RETURNING captchas_resueltos, balance',
      [PAGO_TRABAJADOR, usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ exito: false, mensaje: 'Usuario no encontrado' });
    }

    const totalCaptchas = result.rows[0].captchas_resueltos;
    const saldoAcumulado = parseFloat(result.rows[0].balance).toFixed(4);
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
   RUTAS DE NAVEGACIÓN Y PANELES
   ========================================== */

// Panel 1: Hoja de trabajo dedicada a 2Captcha
app.get('/panel-2captcha', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'panel-2captcha.html'));
});

// Ruta Principal (Portada/Login)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Servidor activo en puerto ${port}`);
});