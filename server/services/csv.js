/**
 * Minimal CSV serializer. Avoids pulling in a dep for a one-liner that works
 * for our use cases. Handles the three values that show up in practice:
 *   - null/undefined → empty string
 *   - Date → ISO string
 *   - strings that contain commas, quotes, or newlines → double-quoted with
 *     embedded quotes doubled per RFC 4180
 * Numbers and booleans fall through to String().
 */
function escape(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
