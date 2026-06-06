/* eslint-disable @typescript-eslint/no-require-imports */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env.ragas.local') });

const args = new Set(process.argv.slice(2));
const apiUrlArg = process.argv.find((arg) => arg.startsWith('--api-url='));
const apiUrl =
  apiUrlArg?.slice('--api-url='.length).replace(/\/$/, '') ||
  process.env.PAGEINDEX_QA_API_URL?.replace(/\/$/, '') ||
  process.env.SOLOMON_QA_API_URL?.replace(/\/$/, '') ||
  '';
const requireApi = args.has('--require-api');
const skipApi = args.has('--skip-api');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const cases = [
  {
    mode: 'toc',
    name: 'azos-exclusions',
    insurerId: 'dfb52b5b-93e0-46a5-8f82-ca29490b6c88',
    insurerLabel: 'Azos',
    insurerNeedle: 'azos',
    question: 'Quais sao os riscos excluidos da Azos?',
    sectionQuery: 'exclu',
    minRpcChunks: 2,
    expectedContent: /riscos exclu|expressamente exclu|excluem-se/i,
  },
  {
    mode: 'documents',
    name: 'icatu-disease-coverage',
    insurerId: '64ee178b-135b-45f0-a527-547059e46529',
    insurerLabel: 'Icatu',
    insurerNeedle: 'icatu',
    question: 'Quais produtos da Icatu possuem cobertura para doencas graves?',
    documentQuery: '%DOENCA_GRAVE%',
    minRpcChunks: 1,
    expectedContent: /doenca_grave|doencas graves/i,
  },
  {
    mode: 'toc',
    name: 'mag-grace-period',
    insurerId: '2f9b2aa3-51ac-45ae-a3d2-f99d8720f273',
    insurerLabel: 'MAG',
    insurerNeedle: 'mag',
    question: 'Como funciona a carencia da MAG?',
    sectionQuery: 'carenc',
    minRpcChunks: 2,
    expectedContent: /carencia|24 \(vinte e quatro\) meses|nao sera adotado periodo/i,
  },
  {
    mode: 'toc',
    name: 'metlife-exclusions',
    insurerId: 'de69235a-3cb0-4229-a5d4-389b0b5e4697',
    insurerLabel: 'MetLife',
    insurerNeedle: 'metlife',
    question: 'Quais sao os riscos excluidos da MetLife?',
    sectionQuery: 'exclu',
    minRpcChunks: 2,
    expectedContent: /riscos exclu|expressamente exclu/i,
  },
  {
    mode: 'toc',
    name: 'prudential-exclusions',
    insurerId: 'dac17baa-c623-4023-9184-3ed2049a6237',
    insurerLabel: 'Prudential',
    insurerNeedle: 'prudential',
    question: 'Quais sao os riscos excluidos da Prudential?',
    sectionQuery: 'exclu',
    minRpcChunks: 20,
    expectedContent: /riscos exclu|excluidos|nao estao cobert/i,
  },
  {
    mode: 'toc',
    name: 'prudential-grace-period',
    insurerId: 'dac17baa-c623-4023-9184-3ed2049a6237',
    insurerLabel: 'Prudential',
    insurerNeedle: 'prudential',
    question: 'Qual e a carencia da Prudential para doencas graves?',
    sectionQuery: 'carenc',
    minRpcChunks: 1,
    expectedContent: /carencia|90 \(noventa\) dias|diagnostico/i,
  },
];

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runDataCase(testCase) {
  if (testCase.mode === 'documents') {
    const { data, error } = await supabase
      .from('documents')
      .select('content, metadata, source_url')
      .eq('insurer_id', testCase.insurerId)
      .ilike('content', testCase.documentQuery)
      .limit(20);

    if (error) throw new Error(`${testCase.name}: documents query failed: ${error.message}`);

    const rows = data ?? [];
    const content = normalizeText(rows.map((row) => row.content).join('\n'));
    assertCondition(
      rows.length >= testCase.minRpcChunks,
      `${testCase.name}: expected at least ${testCase.minRpcChunks} structured rows, got ${rows.length}`
    );
    assertCondition(testCase.expectedContent.test(content), `${testCase.name}: structured rows lack expected content`);
    console.log(`[documents] ${testCase.name}: ${rows.length} rows`);
    return;
  }

  const { data, error } = await supabase.rpc('fetch_chunks_by_toc', {
    filter_insurer_id: testCase.insurerId,
    filter_product_id: null,
    section_query: testCase.sectionQuery,
  });

  if (error) throw new Error(`${testCase.name}: RPC failed: ${error.message}`);

  const rows = data ?? [];
  assertCondition(
    rows.length >= testCase.minRpcChunks,
    `${testCase.name}: expected at least ${testCase.minRpcChunks} RPC chunks, got ${rows.length}`
  );

  const matchingContent = rows.some((row) =>
    testCase.expectedContent.test(normalizeText(row.content))
  );

  assertCondition(matchingContent, `${testCase.name}: no expected content match in RPC rows`);

  console.log(`[rpc] ${testCase.name}: ${rows.length} chunks`);
}

async function runApiCase(testCase) {
  const headers = { 'content-type': 'application/json' };
  const evalToken = process.env.SOLOMON_EVAL_TOKEN?.trim();
  if (evalToken) headers['x-solomon-eval-token'] = evalToken;

  const response = await fetch(`${apiUrl}/api/ask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question: testCase.question,
      insurer: testCase.insurerLabel,
      channel: 'api',
      evalMode: true,
    }),
  });

  const rawBody = await response.text();
  assertCondition(
    response.ok,
    `${testCase.name}: API returned ${response.status}: ${rawBody.slice(0, 240)}`
  );

  const body = JSON.parse(rawBody);
  const sources = Array.isArray(body.sources) ? body.sources : [];
  const sourceText = normalizeText(
    sources
      .map((source) =>
        [
          source.insurerName,
          source.productName,
          source.sourceDoc,
          source.sourceUrl,
          source.content,
        ].join('\n')
      )
      .join('\n')
  );

  assertCondition(typeof body.answer === 'string' && body.answer.length >= 80, `${testCase.name}: answer is too short`);
  assertCondition(Number(body.sourceCount) > 0, `${testCase.name}: sourceCount must be > 0`);
  assertCondition(sources.length > 0, `${testCase.name}: evalMode did not return sources`);
  assertCondition(
    sourceText.includes(testCase.insurerNeedle),
    `${testCase.name}: sources do not mention ${testCase.insurerLabel}`
  );
  assertCondition(testCase.expectedContent.test(sourceText), `${testCase.name}: sources do not contain expected content`);

  console.log(
    `[api] ${testCase.name}: ${body.sourceCount} sources, confidence=${body.confidenceScore}, citations=${body.citations?.length ?? 0}`
  );
}

async function main() {
  console.log('PageIndex Lite QA');
  console.log(`Supabase: ${supabaseUrl}`);

  for (const testCase of cases) {
    await runDataCase(testCase);
  }

  if (skipApi) {
    console.log('[api] skipped by --skip-api');
    return;
  }

  if (!apiUrl) {
    const message = '[api] skipped: pass --api-url=http://localhost:3000 or set PAGEINDEX_QA_API_URL';
    if (requireApi) throw new Error(message);
    console.log(message);
    return;
  }

  console.log(`API: ${apiUrl}`);
  for (const testCase of cases) {
    await runApiCase(testCase);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
