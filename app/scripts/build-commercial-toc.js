const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env.ragas.local'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const write = process.argv.includes('--write');

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TARGET_INSURERS = [
  { id: 'dfb52b5b-93e0-46a5-8f82-ca29490b6c88', name: 'Azos' },
  { id: '2f9b2aa3-51ac-45ae-a3d2-f99d8720f273', name: 'MAG Seguros' },
  { id: 'de69235a-3cb0-4229-a5d4-389b0b5e4697', name: 'MetLife' },
];

const SECTION_PATTERNS = [
  {
    title: 'Riscos excluidos',
    path: 'Riscos excluidos',
    pattern:
      /(?:clausula\s+\d+\s*[-\u2013]\s*|\b\d{1,2}\s*[\).]\s*)riscos?\s+excluidos?(?!\s*\.{3})/i,
  },
  {
    title: 'Carencia',
    path: 'Carencia',
    pattern:
      /(?:clausula\s+\d+\s*[-\u2013]\s*|\b\d{1,2}\s*[\).]\s*)(?:periodo\s+de\s+|prazo\s+de\s+)?carencias?(?!\s*\.{3})/i,
  },
];

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function resolvedSource(document) {
  const metadata = document.metadata ?? {};
  return metadata.source_doc || metadata.source_url || document.source_url || null;
}

function documentPosition(document) {
  const page = Number(document.metadata?.page);
  return Number.isInteger(page) && page > 0 ? page : document.chunk_index;
}

function hasBodyHeading(content, pattern) {
  const normalized = normalizeText(content);
  const match = normalized.match(pattern);
  if (!match || match.index === undefined) return false;

  const around = normalized.slice(match.index, match.index + match[0].length + 80);
  return !/\.{3,}/.test(around);
}

async function fetchDocuments(insurerId) {
  const rows = [];
  const batchSize = 1000;

  for (let from = 0; ; from += batchSize) {
    const { data, error } = await supabase
      .from('documents')
      .select('content, metadata, source_url, product_id, chunk_index')
      .eq('insurer_id', insurerId)
      .order('source_url')
      .order('chunk_index')
      .range(from, from + batchSize - 1);

    if (error) throw new Error(`documents query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < batchSize) break;
  }

  return rows;
}

function buildRows(insurer, documents) {
  const bySource = new Map();

  for (const document of documents) {
    const sourceDoc = resolvedSource(document);
    if (!sourceDoc || sourceDoc === 'null') continue;

    const group = bySource.get(sourceDoc) ?? [];
    group.push(document);
    bySource.set(sourceDoc, group);
  }

  const tocRows = [];
  for (const [sourceDoc, sourceDocuments] of bySource) {
    sourceDocuments.sort((a, b) => documentPosition(a) - documentPosition(b));
    const maxPosition = documentPosition(sourceDocuments[sourceDocuments.length - 1]);

    for (const document of sourceDocuments) {
      for (const section of SECTION_PATTERNS) {
        if (!hasBodyHeading(document.content, section.pattern)) continue;

        const start = documentPosition(document);
        tocRows.push({
          insurer_id: insurer.id,
          product_id: document.product_id ?? null,
          source_doc: sourceDoc,
          section_title: section.title,
          section_path: section.path,
          start_page: start,
          end_page: Math.min(start + 3, maxPosition),
        });
      }
    }
  }

  const uniqueRows = new Map();
  for (const row of tocRows) {
    const key = [
      row.insurer_id,
      row.product_id ?? '',
      row.source_doc,
      row.section_path,
      row.start_page,
    ].join('|');
    uniqueRows.set(key, row);
  }

  return [...uniqueRows.values()];
}

async function replaceTargetRows(insurer, rows) {
  const { error: deleteError } = await supabase
    .from('document_toc')
    .delete()
    .eq('insurer_id', insurer.id)
    .in(
      'section_path',
      SECTION_PATTERNS.map((section) => section.path)
    );

  if (deleteError) throw new Error(`${insurer.name}: TOC cleanup failed: ${deleteError.message}`);

  for (let offset = 0; offset < rows.length; offset += 100) {
    const { error } = await supabase.from('document_toc').insert(rows.slice(offset, offset + 100));
    if (error) throw new Error(`${insurer.name}: TOC insert failed: ${error.message}`);
  }
}

async function main() {
  console.log(`Commercial TOC builder (${write ? 'write' : 'dry-run'})`);

  for (const insurer of TARGET_INSURERS) {
    const documents = await fetchDocuments(insurer.id);
    const rows = buildRows(insurer, documents);
    const exclusions = rows.filter((row) => row.section_path === 'Riscos excluidos').length;
    const gracePeriods = rows.filter((row) => row.section_path === 'Carencia').length;

    console.log(
      `${insurer.name}: documents=${documents.length}, toc=${rows.length}, exclusions=${exclusions}, grace=${gracePeriods}`
    );

    if (rows.length === 0) {
      throw new Error(`${insurer.name}: no commercial TOC rows generated`);
    }

    if (write) await replaceTargetRows(insurer, rows);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
