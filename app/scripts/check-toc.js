// Script to check if document_toc table exists in Supabase and count rows.
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.ragas.local
dotenv.config({ path: path.join(__dirname, '../.env.ragas.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.ragas.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTable() {
  console.log(`Connecting to Supabase at: ${supabaseUrl}`);

  const { data: insurers, error: insError } = await supabase
    .from('insurers')
    .select('id, name');
  if (insError) {
    console.error('Error fetching insurers:', insError.message);
    return;
  }

  console.log('\n--- Document and TOC Counts per Insurer ---');
  for (const insurer of insurers) {
    const { count: documentCount, error: documentError } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('insurer_id', insurer.id);

    const { count: tocCount, error: tocError } = await supabase
      .from('document_toc')
      .select('*', { count: 'exact', head: true })
      .eq('insurer_id', insurer.id);

    if (documentError || tocError) {
      console.error(
        `Error counting for ${insurer.name}:`,
        documentError?.message || tocError?.message
      );
      continue;
    }

    console.log(`${insurer.name} (${insurer.id}): ${documentCount} documents, ${tocCount} TOC entries`);
  }
}

checkTable();
