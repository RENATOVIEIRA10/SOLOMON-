const fs = require('fs');
const path = require('path');

const fineTuningDir = path.join(__dirname, '../eval/fine_tuning');
const sourcePath = path.join(fineTuningDir, 'solomon-sft-approved.jsonl');
const outputPath = path.join(fineTuningDir, 'solomon-sft-bedrock-train.jsonl');

const rows = fs
  .readFileSync(sourcePath, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    const row = JSON.parse(line);
    const system = row.messages?.find((message) => message.role === 'system');
    const user = row.messages?.find((message) => message.role === 'user');
    const assistant = row.messages?.find((message) => message.role === 'assistant');
    if (!system?.content || !user?.content || !assistant?.content) {
      throw new Error(`${sourcePath}:${index + 1}: incomplete conversation`);
    }
    return {
      id: row.id,
      example: {
        schemaVersion: 'bedrock-conversation-2024',
        system: [{ text: system.content }],
        messages: [
          { role: 'user', content: [{ text: user.content }] },
          { role: 'assistant', content: [{ text: assistant.content }] },
        ],
      },
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const ids = new Set(rows.map((row) => row.id));
if (ids.size !== rows.length) throw new Error('duplicate SFT ids');
if (rows.length < 100) throw new Error('Amazon Nova SFT requires at least 100 records');

fs.writeFileSync(
  outputPath,
  `${rows.map((row) => JSON.stringify(row.example)).join('\n')}\n`,
  'utf8'
);

console.log(
  JSON.stringify(
    {
      training_examples: rows.length,
      training_file: path.relative(path.join(__dirname, '..'), outputPath),
      base_model: 'amazon.nova-micro-v1:0:128k',
    },
    null,
    2
  )
);
