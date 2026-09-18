const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Función para crear las tablas automáticamente en la base de datos
const initDb = async () => {
  try {
    // Tabla de Usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        balance DECIMAL(10, 4) DEFAULT 0.0000,
        api_key VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla de Tareas/Captchas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS captcha_tasks (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        captcha_type VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        solution TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Tablas en PostgreSQL verificadas/creadas correctamente.');
  } catch (err) {
    console.error('❌ Error al inicializar las tablas:', err);
  }
};

// Inicializar base de datos
initDb();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor activo en puerto ${port}`);
});