/* eslint-disable @typescript-eslint/no-require-imports */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env.ragas.local'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const COMMERCIAL_INSURERS = [
  { id: 'dfb52b5b-93e0-46a5-8f82-ca29490b6c88', name: 'Azos', retrieval: 'toc' },
  { id: '64ee178b-135b-45f0-a527-547059e46529', name: 'Icatu', retrieval: 'structured' },
  { id: '2f9b2aa3-51ac-45ae-a3d2-f99d8720f273', name: 'MAG', retrieval: 'toc' },
  { id: 'de69235a-3cb0-4229-a5d4-389b0b5e4697', name: 'MetLife', retrieval: 'toc' },
  { id: 'dac17baa-c623-4023-9184-3ed2049a6237', name: 'Prudential', retrieval: 'toc' },
];

async function exactCount(table, configure) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  query = configure(query);
  const { count, error } = await query;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

async function auditInsurer(insurer) {
  const total = await exactCount('documents', (query) => query.eq('insurer_id', insurer.id));
  const missingEmbeddings = await exactCount('documents', (query) =>
    query.eq('insurer_id', insurer.id).is('embedding', null)
  );
  const tocRows = await exactCount('document_toc', (query) => query.eq('insurer_id', insurer.id));
  const embeddingCoverage = total === 0 ? 0 : (total - missingEmbeddings) / total;

  return {
    ...insurer,
    total,
    missingEmbeddings,
    embeddingCoverage,
    tocRows,
    ready:
      total > 0 &&
      embeddingCoverage >= 0.99 &&
      (insurer.retrieval === 'structured' || tocRows > 0),
  };
}

async function main() {
  const results = [];
  for (const insurer of COMMERCIAL_INSURERS) results.push(await auditInsurer(insurer));

  console.log('SOLOMON RAG readiness audit');
  console.log('Embedding contract: text-embedding-3-small / 1536 dimensions');
  console.log('Vector index contract: HNSW + cosine; legacy IVFFlat also exists');
  console.log('');

  for (const result of results) {
    console.log(
      `${result.ready ? 'PASS' : 'FAIL'} ${result.name}: documents=${result.total}, missing_embeddings=${result.missingEmbeddings}, coverage=${(result.embeddingCoverage * 100).toFixed(2)}%, toc=${result.tocRows}, retrieval=${result.retrieval}`
    );
  }

  const failed = results.filter((result) => !result.ready);
  if (failed.length > 0) {
    throw new Error(`RAG readiness failed for: ${failed.map((result) => result.name).join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
