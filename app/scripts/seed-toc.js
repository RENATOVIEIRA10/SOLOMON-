const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '../.env.ragas.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.ragas.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function validateTocItem(item, index) {
  const requiredStringFields = ['insurer_id', 'source_doc', 'section_title', 'section_path'];
  for (const field of requiredStringFields) {
    if (typeof item[field] !== 'string' || item[field].trim() === '') {
      throw new Error(`Invalid TOC seed row ${index}: missing ${field}`);
    }
  }

  if (!Number.isInteger(item.start_page) || !Number.isInteger(item.end_page)) {
    throw new Error(`Invalid TOC seed row ${index}: start_page/end_page must be integers`);
  }
  if (item.start_page > item.end_page) {
    throw new Error(`Invalid TOC seed row ${index}: start_page is greater than end_page`);
  }
}

async function seed() {
  console.log('Reading seed data from app_toc_seed.json...');
  const jsonPath = path.join(__dirname, '../app_toc_seed.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`Error: Seed file not found at ${jsonPath}`);
    return;
  }

  const tocList = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Loaded ${tocList.length} TOC entries.`);

  if (!Array.isArray(tocList) || tocList.length === 0) {
    console.error('Error: Seed file must contain a non-empty array.');
    process.exit(1);
  }

  tocList.forEach(validateTocItem);
  const insurerIds = [...new Set(tocList.map(item => item.insurer_id))];

  console.log(`Clearing existing document_toc records for ${insurerIds.length} insurer(s)...`);
  for (const insurerId of insurerIds) {
    const { error: deleteError } = await supabase
      .from('document_toc')
      .delete()
      .eq('insurer_id', insurerId);

    if (deleteError) {
      console.error(`Error clearing document_toc for insurer ${insurerId}:`, deleteError.message);
      process.exit(1);
    }
  }
  console.log('Cleared existing records successfully.');

  console.log('Inserting seed records in batches...');
  const batchSize = 100;
  for (let i = 0; i < tocList.length; i += batchSize) {
    const batch = tocList.slice(i, i + batchSize);
    
    // Map fields to match document_toc columns
    const insertData = batch.map(item => ({
      insurer_id: item.insurer_id,
      product_id: item.product_id,
      source_doc: item.source_doc,
      section_title: item.section_title,
      section_path: item.section_path,
      start_page: item.start_page,
      end_page: item.end_page
    }));

    const { error } = await supabase
      .from('document_toc')
      .insert(insertData);

    if (error) {
      console.error(`Error inserting batch ${i / batchSize}:`, error.message);
      process.exit(1);
    }
    console.log(`Inserted batch ${i / batchSize + 1}/${Math.ceil(tocList.length / batchSize)}`);
  }

  console.log('Seeding completed successfully!');
}

seed();
