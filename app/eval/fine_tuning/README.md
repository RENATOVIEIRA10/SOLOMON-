# SOLOMON Fine-Tuning Gate

Fine-tuning is allowed only after the approved dataset reaches the configured
minimum and the RAG evaluation remains green.

## Build the approved SFT dataset

```bash
npm run sft:dataset
```

Only Ragas questions with `"approved_for_sft": true` are included. Generated
rows use the Hugging Face conversational `messages` format.

The command intentionally exits with code `2` while fewer than 100 approved
examples exist. This prevents spending GPU budget on an undersized or
unreviewed dataset.

CI validates schema and regenerates the deterministic preview with:

```bash
npm run sft:dataset -- --allow-not-ready
```

The same command also writes `solomon-sft-review-candidates.jsonl`. This queue
contains valid, in-scope examples that still need validation. Candidates can be
approved through the synthetic comparison documented in the Ragas README,
followed by explicit adjudication of every `review` or `fail` result. The source
question must contain `"approved_for_sft": true` before it enters training.

Fine-tuning should improve answer behavior and format. Insurer rules and
current product facts must continue to come from RAG/structured data.

As of May 7, 2026, OpenAI blocks new fine-tuning jobs for organizations that
have not previously used fine-tuning. The current SOLOMON organization returns
`training_not_available`, so the executable training route uses Amazon Bedrock:

```bash
npm run sft:bedrock:prepare
npm run sft:bedrock:start
npm run sft:bedrock:status
```

This converts all 100 approved examples to the Bedrock Converse format and
starts a two-epoch fine-tune of Amazon Nova Micro. The start command creates a
dedicated S3 bucket and least-scope IAM role when they do not already exist.
Training completion does not promote the model to production automatically;
the custom model must first pass a comparison suite outside the training set.
