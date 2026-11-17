import mysql from 'mysql2/promise';

export function connectionOptions(overrides = {}) {
  return {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3407),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'campus_sidequest',
    charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
    ...overrides
  };
}

export function createPool(overrides = {}) {
  const pool = mysql.createPool({ ...connectionOptions(overrides), connectionLimit: 8, waitForConnections: true, queueLimit: 40 });
  pool.on('connection', connection => {
    connection.query("SET SESSION time_zone='+00:00'");
    connection.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
    connection.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY'");
  });
  return pool;
}

// Each CALL owns a complete transaction. Retry only the entire CALL after a deadlock.
export async function call(pool, procedure, values = []) {
  if (!/^sp_[a-z_]+$/.test(procedure)) throw new Error('Invalid procedure name');
  for (let attempt = 0; ; attempt++) {
    try {
      const [sets] = await pool.query(`CALL ${procedure}(${values.map(() => '?').join(',')})`, values);
      return Array.isArray(sets[0]) ? sets[0] : [];
    } catch (error) {
      if (![1213, 1205].includes(error.errno) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1) + Math.random() * 30));
    }
  }
}
