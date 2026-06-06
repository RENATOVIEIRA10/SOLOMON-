const fs = require('fs');
const path = require('path');

const ragasDir = path.join(__dirname, '../eval/ragas');
const outputDir = path.join(__dirname, '../eval/fine_tuning');
const minApprovedExamples = Number(process.env.SFT_MIN_APPROVED_EXAMPLES ?? 100);
const allowNotReady = process.argv.includes('--allow-not-ready');

const inputFiles = fs
  .readdirSync(ragasDir)
  .filter((name) => /^questions.*\.jsonl$/.test(name))
  .sort();

function loadJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${filePath}:${index + 1}: invalid JSON`);
      }
    });
}

function validateExample(example, source) {
  for (const field of ['id', 'category', 'question', 'ground_truth']) {
    if (typeof example[field] !== 'string' || example[field].trim().length === 0) {
      throw new Error(`${source}: ${example.id ?? '<unknown>'} missing ${field}`);
    }
  }
  if (example.question.length < 10) throw new Error(`${source}: ${example.id} question is too short`);
  if (example.ground_truth.length < 60) throw new Error(`${source}: ${example.id} ground_truth is too short`);
}

const approved = [];
const sourceExamples = [];
for (const fileName of inputFiles) {
  for (const example of loadJsonl(path.join(ragasDir, fileName))) {
    sourceExamples.push({ ...example, source_file: fileName });
    if (example.approved_for_sft !== true) continue;
    validateExample(example, fileName);
    approved.push({
      id: example.id,
      category: example.category,
      messages: [
        {
          role: 'system',
          content:
            'Voce e o SOLOMON, assistente tecnico para corretores de seguros. Responda com precisao, separe regras por seguradora/produto e nao invente condicoes.',
        },
        { role: 'user', content: example.question },
        { role: 'assistant', content: example.ground_truth },
      ],
    });
  }
}

const unique = new Map(approved.map((example) => [example.id, example]));
const dataset = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
const uniqueSourceExamples = new Map();
for (const example of sourceExamples) {
  const existing = uniqueSourceExamples.get(example.id);
  if (!existing || example.approved_for_sft === true) {
    uniqueSourceExamples.set(example.id, example);
  }
}

const reviewCandidates = [...uniqueSourceExamples.values()]
  .filter((example) => example.approved_for_sft !== true)
  .filter((example) => example.needs_julio_review === false)
  .filter((example) => example.out_of_scope !== true)
  .filter(
    (example) =>
      typeof example.question === 'string' &&
      example.question.length >= 10 &&
      typeof example.ground_truth === 'string' &&
      example.ground_truth.length >= 60
  )
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((example) => ({
    id: example.id,
    category: example.category,
    question: example.question,
    ground_truth: example.ground_truth,
    source_file: example.source_file,
    reviewed_by: example.reviewed_by ?? null,
    review_notes: example.review_notes ?? null,
  }));

const requiresExpertReview = [...uniqueSourceExamples.values()].filter(
  (example) => example.approved_for_sft !== true && example.needs_julio_review === true
);

fs.mkdirSync(outputDir, { recursive: true });
const previewPath = path.join(outputDir, 'solomon-sft-approved.jsonl');
fs.writeFileSync(previewPath, dataset.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
const reviewQueuePath = path.join(outputDir, 'solomon-sft-review-candidates.jsonl');
fs.writeFileSync(
  reviewQueuePath,
  reviewCandidates.map((row) => JSON.stringify(row)).join('\n') + '\n',
  'utf8'
);

const categoryCounts = {};
for (const row of dataset) categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;

const report = {
  input_files: inputFiles,
  approved_examples: dataset.length,
  minimum_required: minApprovedExamples,
  ready_for_training: dataset.length >= minApprovedExamples,
  unique_source_examples: uniqueSourceExamples.size,
  review_candidates: reviewCandidates.length,
  requires_expert_review: requiresExpertReview.length,
  remaining_to_minimum: Math.max(0, minApprovedExamples - dataset.length),
  new_examples_required_even_if_all_current_candidates_are_approved: Math.max(
    0,
    minApprovedExamples - dataset.length - reviewCandidates.length
  ),
  categories: categoryCounts,
  output: 'eval/fine_tuning/solomon-sft-approved.jsonl',
  review_queue: 'eval/fine_tuning/solomon-sft-review-candidates.jsonl',
};

fs.writeFileSync(path.join(outputDir, 'readiness.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));

if (!report.ready_for_training && !allowNotReady) {
  console.error(
    `Fine-tuning blocked: ${dataset.length} approved examples; minimum is ${minApprovedExamples}.`
  );
  process.exit(2);
}
