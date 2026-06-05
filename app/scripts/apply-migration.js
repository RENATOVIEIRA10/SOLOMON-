// Applies the TOC coalesce migration via Supabase Management API.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.ragas.local') });

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ohmoyfbtfuznhlpjcbbk';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('Error: SUPABASE_ACCESS_TOKEN is required to apply migrations via Management API.');
  process.exit(1);
}

async function runSql(label, query) {
  console.log(`\n--- Running SQL: ${label} ---`);
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  console.log(`HTTP ${res.status}`);
  if (body) console.log(body.substring(0, 1000));
  if (!res.ok) throw new Error(`SQL failed: ${label}`);
  return body;
}

async function main() {
  const migrationFile = '20260605200000_update_fetch_chunks_by_toc_coalesce.sql';
  const migrationPath = path.resolve(__dirname, '../supabase/migrations', migrationFile);

  if (!fs.existsSync(migrationPath)) {
    console.error(`Error: Migration file not found at ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  try {
    await runSql(`Apply ${migrationFile}`, sql);
    console.log('\nMigration applied successfully!');
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  }
}

main();
