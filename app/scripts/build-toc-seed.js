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

async function buildTOC() {
  console.log('Scanning documents for Prudential to build Table of Contents...');
  const prudentialId = 'dac17baa-c623-4023-9184-3ed2049a6237';

  // We fetch in batches of 1000 to get all 1981 documents
  let allDocs = [];
  let page = 0;
  const limit = 1000;
  
  while (true) {
    const { data, error } = await supabase
      .from('documents')
      .select('id, metadata, product_id, source_url')
      .eq('insurer_id', prudentialId)
      .not('metadata->>section', 'is', null)
      .range(page * limit, (page + 1) * limit - 1);

    if (error) {
      console.error('Error fetching documents:', error.message);
      return;
    }

    if (!data || data.length === 0) break;
    allDocs = allDocs.concat(data);
    if (data.length < limit) break;
    page++;
  }

  console.log(`Fetched ${allDocs.length} documents with section metadata.`);

  // Group by source document + section
  const groups = {};
  const skipped = {
    missingSource: 0,
    missingSection: 0,
    invalidPage: 0,
  };

  allDocs.forEach(d => {
    const meta = d.metadata || {};
    const sourceDoc = meta.source_doc || meta.source_url || d.source_url;
    const section = typeof meta.section === 'string' ? meta.section.trim() : '';
    const pageNum = parseInt(meta.page, 10);
    const productId = d.product_id || null;

    if (!sourceDoc) {
      skipped.missingSource++;
      return;
    }
    if (!section) {
      skipped.missingSection++;
      return;
    }
    if (Number.isNaN(pageNum)) {
      skipped.invalidPage++;
      return;
    }

    const groupKey = `${sourceDoc}|||${section}`;
    if (!groups[groupKey]) {
      groups[groupKey] = {
        insurer_id: prudentialId,
        product_id: productId,
        source_doc: sourceDoc,
        section_title: section,
        section_path: section,
        start_page: pageNum,
        end_page: pageNum
      };
    } else {
      if (pageNum < groups[groupKey].start_page) {
        groups[groupKey].start_page = pageNum;
      }
      if (pageNum > groups[groupKey].end_page) {
        groups[groupKey].end_page = pageNum;
      }
    }
  });

  const tocList = Object.values(groups);
  console.log(`\nGenerated ${tocList.length} TOC entries.`);
  console.log(`Skipped: ${JSON.stringify(skipped)}`);

  if (tocList.length === 0) {
    console.error('Error: no TOC entries generated.');
    process.exit(1);
  }

  // Sort them by source_doc and start_page for readability
  tocList.sort((a, b) => {
    if (a.source_doc !== b.source_doc) return a.source_doc.localeCompare(b.source_doc);
    return a.start_page - b.start_page;
  });

  // Print a summary of source docs and their sections
  const byDoc = {};
  tocList.forEach(item => {
    if (!byDoc[item.source_doc]) byDoc[item.source_doc] = [];
    byDoc[item.source_doc].push(item);
  });

  Object.keys(byDoc).forEach(doc => {
    console.log(`\nDocument: ${doc}`);
    console.log(`Total sections: ${byDoc[doc].length}`);
    byDoc[doc].forEach(sec => {
      console.log(`  - Page ${sec.start_page}-${sec.end_page}: "${sec.section_title}" (Product ID: ${sec.product_id})`);
    });
  });

  // Generate seed SQL statements or a JSON seed file
  const fs = require('fs');
  const jsonPath = path.join(__dirname, '../app_toc_seed.json');
  fs.writeFileSync(jsonPath, JSON.stringify(tocList, null, 2), 'utf-8');
  console.log(`\nSaved ${tocList.length} TOC entries to ${jsonPath}`);
}

buildTOC();
