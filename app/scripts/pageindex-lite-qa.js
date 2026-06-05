const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env.ragas.local') });

const PRUDENTIAL_ID = 'dac17baa-c623-4023-9184-3ed2049a6237';

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
    name: 'prudential-exclusions',
    question: 'Quais sao os riscos excluidos da Prudential?',
    sectionQuery: 'exclu',
    minRpcChunks: 20,
    expectedSection: /exclu/i,
    expectedContent: /riscos exclu|excluidos|nao estao cobert/i,
  },
  {
    name: 'prudential-grace-period',
    question: 'Qual e a carencia da Prudential para doencas graves?',
    sectionQuery: 'carenc',
    minRpcChunks: 1,
    expectedSection: /carenc/i,
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

async function runRpcCase(testCase) {
  const { data, error } = await supabase.rpc('fetch_chunks_by_toc', {
    filter_insurer_id: PRUDENTIAL_ID,
    filter_product_id: null,
    section_query: testCase.sectionQuery,
  });

  if (error) throw new Error(`${testCase.name}: RPC failed: ${error.message}`);

  const rows = data ?? [];
  assertCondition(
    rows.length >= testCase.minRpcChunks,
    `${testCase.name}: expected at least ${testCase.minRpcChunks} RPC chunks, got ${rows.length}`
  );

  const matchingSection = rows.some((row) =>
    testCase.expectedSection.test(normalizeText(row.metadata?.section))
  );
  const matchingContent = rows.some((row) =>
    testCase.expectedContent.test(normalizeText(row.content))
  );

  assertCondition(matchingSection, `${testCase.name}: no expected section match in RPC rows`);
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
      insurer: 'Prudential',
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
  assertCondition(sourceText.includes('prudential'), `${testCase.name}: sources do not mention Prudential`);
  assertCondition(testCase.expectedContent.test(sourceText), `${testCase.name}: sources do not contain expected content`);

  console.log(
    `[api] ${testCase.name}: ${body.sourceCount} sources, confidence=${body.confidenceScore}, citations=${body.citations?.length ?? 0}`
  );
}

async function main() {
  console.log('PageIndex Lite QA');
  console.log(`Supabase: ${supabaseUrl}`);

  for (const testCase of cases) {
    await runRpcCase(testCase);
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
