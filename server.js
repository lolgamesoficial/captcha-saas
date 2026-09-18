const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicialización limpia de la base de datos
const initDb = async () => {
  try {
    // Elimina la tabla antigua con inconsistencias de columnas si existe
    await pool.query(`DROP TABLE IF EXISTS users CASCADE;`);

    // Crea la tabla users con la estructura exacta que requiere el sistema
    await pool.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        balance DECIMAL(10, 4) DEFAULT 0.0000,
        captchas_resueltos INT DEFAULT 0,
        api_key VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Base de datos recreada e inicializada correctamente.');
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err.message);
  }
};

initDb();

// Ruta: Registro de usuario
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

// Ruta: Login de usuario
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

// Ruta: Resolver Captchas
app.post('/api/resolver', async (req, res) => {
  const { usuarioId } = req.body;
  if (!usuarioId) {
    return res.status(400).json({ exito: false, mensaje: 'Usuario no identificado' });
  }

  try {
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor activo en puerto ${port}`);
});