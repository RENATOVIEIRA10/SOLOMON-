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

async function analyze() {
  console.log('Querying count of documents with section per insurer...');
  
  const { data: insurers, error: insError } = await supabase
    .from('insurers')
    .select('id, name');
    
  if (insError) {
    console.error('Error fetching insurers:', insError.message);
    return;
  }

  for (const insurer of insurers) {
    const { count, error } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('insurer_id', insurer.id)
      .not('metadata->>section', 'is', null);
      
    if (error) {
      console.error(`Error counting for ${insurer.name}:`, error.message);
    } else if (count > 0) {
      console.log(`${insurer.name} (${insurer.id}): ${count} documents with section`);
    }
  }
}

analyze();
