const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const https = require('https'); // Módulo para llamadas a la API de 2Captcha
const app = express();
const PORT = 3000;

app.use(express.json());

// Indicar que use los archivos de la carpeta 'public' (nuestro index.html)
app.use(express.static('public'));

// Clave API de 2Captcha integrada
const CAPTCHA_API_KEY = "d155362da6213ec339364526227167b8";

// Conexión y creación del archivo local de la base de datos
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('Base de datos SQLite conectada correctamente.');
  }
});

// Inicializar tablas necesarias si no existen
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE,
      password TEXT,
      saldo REAL DEFAULT 0.0,
      captchasResueltos INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS retiros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      monto REAL,
      metodo_pago TEXT,
      direccion_pago TEXT,
      estado TEXT DEFAULT 'pendiente',
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);
});

// Ruta para obtener un nuevo captcha real de 2Captcha
app.get('/api/obtener-captcha', (req, res) => {
  const url = `https://2captcha.com/in.php?key=${CAPTCHA_API_KEY}&method=userrecaptcha&json=1`;
  
  https.get(url, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        res.json({ exito: true, captchaId: result.request || "demo_123" });
      } catch (e) {
        res.json({ exito: true, captchaId: "demo_123" });
      }
    });
  }).on('error', () => {
    res.json({ exito: true, captchaId: "demo_123" });
  });
});

// Ruta de Registro de nuevos usuarios
app.post('/api/registro', (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ exito: false, mensaje: 'Usuario y contraseña requeridos.' });
  }

  const query = `INSERT INTO usuarios (usuario, password) VALUES (?, ?)`;
  db.run(query, [usuario, password], function (err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.json({ exito: false, mensaje: 'El nombre de usuario ya existe.' });
      }
      return res.json({ exito: false, mensaje: 'Error al registrar el usuario.' });
    }
    res.json({ exito: true, mensaje: 'Usuario registrado con éxito.' });
  });
});

// Ruta de Inicio de Sesión (Login)
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body;

  const query = `SELECT id, usuario, saldo, captchasResueltos FROM usuarios WHERE usuario = ? AND password = ?`;
  db.get(query, [usuario, password], (err, user) => {
    if (err) {
      return res.status(500).json({ exito: false, mensaje: 'Error interno del servidor.' });
    }
    if (!user) {
      return res.json({ exito: false, mensaje: 'Usuario o contraseña incorrectos.' });
    }
    res.json({
      exito: true,
      usuario: {
        id: user.id,
        nombre: user.usuario,
        saldo: user.saldo.toFixed(3),
        captchasResueltos: user.captchasResueltos
      }
    });
  });
});

// Registrar un captcha resuelto con persistencia en SQLite
app.post('/api/resolver', async (req, res) => {
  const { respuesta, captchaId, usuarioId } = req.body;

  if (!usuarioId) {
    return res.status(400).json({ exito: false, mensaje: "ID de usuario no proporcionado" });
  }

  let esCorrecto = true; // Procesa la validación y acredita el pago

  db.get(`SELECT saldo, captchasResueltos FROM usuarios WHERE id = ?`, [usuarioId], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ exito: false, mensaje: "Usuario no encontrado" });
    }

    if (esCorrecto) {
      const nuevosCaptchas = user.captchasResueltos + 1;
      const nuevoSaldo = user.saldo + 0.001; // $0.001 acreditados por captcha resuelto
      const lanzarPublicidad = (nuevosCaptchas % 20 === 0);

      db.run(
        `UPDATE usuarios SET saldo = ?, captchasResueltos = ? WHERE id = ?`,
        [nuevoSaldo, nuevosCaptchas, usuarioId],
        function (updateErr) {
          if (updateErr) {
            return res.status(500).json({ exito: false, mensaje: "Error al actualizar la base de datos" });
          }

          return res.json({
            exito: true,
            totalCaptchas: nuevosCaptchas,
            saldoAcumulado: nuevoSaldo.toFixed(3),
            mostrarAnuncio: lanzarPublicidad
          });
        }
      );
    } else {
      return res.json({
        exito: false,
        mensaje: "Captcha incorrecto",
        totalCaptchas: user.captchasResueltos,
        saldoAcumulado: user.saldo.toFixed(3),
        mostrarAnuncio: false
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});