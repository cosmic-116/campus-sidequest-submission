import fs from 'node:fs/promises';

// DELIMITER belongs to Workbench/the mysql client, not to the SQL server.
export async function importSQL(connection, path, onResult = () => {}) {
  let delimiter = ';', buffer = '';
  for (const line of (await fs.readFile(path, 'utf8')).split(/\r?\n/)) {
    if (line.trim().startsWith('--') || !line.trim()) continue;
    if (/^DELIMITER /i.test(line.trim())) {
      delimiter = line.trim().split(/\s+/)[1];
      continue;
    }
    buffer += line + '\n';
    if (buffer.trimEnd().endsWith(delimiter)) {
      const [result] = await connection.query(buffer.trimEnd().slice(0, -delimiter.length));
      onResult(result);
      buffer = '';
    }
  }
  if (buffer.trim()) throw new Error(`Unterminated SQL in ${path}`);
}
