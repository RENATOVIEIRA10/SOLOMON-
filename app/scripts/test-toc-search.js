const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.ragas.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.ragas.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testTOC() {
  console.log('Testing fetch_chunks_by_toc RPC...');
  const prudentialId = 'dac17baa-c623-4023-9184-3ed2049a6237';

  // We query for 'exclus' (which corresponds to 'exclusão' or 'exclusões')
  const { data, error } = await supabase.rpc('fetch_chunks_by_toc', {
    filter_insurer_id: prudentialId,
    filter_product_id: null,
    section_query: 'exclu'
  });

  if (error) {
    console.error('Error executing fetch_chunks_by_toc RPC:', error.message);
    process.exit(1);
  }

  console.log(`Successfully fetched ${data.length} chunks via TOC.`);

  if (!data || data.length === 0) {
    console.error('Error: fetch_chunks_by_toc returned 0 chunks for the Prudential exclusions smoke test.');
    process.exit(1);
  }
  
  if (data.length > 0) {
    console.log('\nSample Chunks Retrieved:');
    data.slice(0, 5).forEach((d, idx) => {
      console.log(`\n[Chunk ${idx}]`);
      console.log(`  Source Doc: ${d.source_url}`);
      console.log(`  Page: ${d.metadata ? d.metadata.page : 'unknown'}`);
      console.log(`  Section: ${d.metadata ? d.metadata.section : 'unknown'}`);
      console.log(`  Content: ${d.content.slice(0, 200)}...`);
    });
  }
}

testTOC();
