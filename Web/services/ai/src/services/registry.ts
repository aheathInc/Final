import { prisma } from '@a-health/database';

export interface ModelSeed {
  key: string;
  displayName: string;
  function: string;
  runtime: string;
}

/**
 * The full shortlist. Every one of these gets a registry row whether or not it
 * is deployed — a model with no recorded validation must be visible as
 * exactly that, which is what the AI governance committee reviews, and what
 * `not_deployed` rows communicate that an empty table cannot.
 */
export const MODEL_SHORTLIST: ModelSeed[] = [
  // Not one of the 15 shortlisted models — the deterministic fallback this
  // service actually runs on by default. Registered because it is what is
  // really handling every request under the default config, and that is
  // precisely the fact a governance registry exists to surface, not hide.
  { key: 'stub', displayName: 'Rule-based stub', function: 'Deterministic offline fallback for chat, used when no model provider is configured', runtime: 'in-process' },
  { key: 'llama-3.1', displayName: 'Llama 3.1', function: 'Clinical assistant, patient Q&A, report drafting', runtime: 'vLLM / self-hosted' },
  { key: 'medgemma', displayName: 'MedGemma', function: 'Medical reasoning and diagnosis-support drafting for clinicians', runtime: 'vLLM / self-hosted' },
  { key: 'biobert', displayName: 'BioBERT', function: 'Medical NLP, entity extraction from clinical text', runtime: 'ONNX / self-hosted' },
  { key: 'clinicalbert', displayName: 'ClinicalBERT', function: 'Clinical note understanding and summarisation', runtime: 'ONNX / self-hosted' },
  { key: 'whisper', displayName: 'Whisper', function: 'Speech-to-text for patient and clinician voice notes', runtime: 'whisper.cpp / self-hosted' },
  { key: 'piper-tts', displayName: 'Piper TTS', function: 'Text-to-speech for low-literacy and voice-channel delivery', runtime: 'Piper / self-hosted' },
  { key: 'yolov11', displayName: 'YOLOv11', function: 'Medical image object detection', runtime: 'ONNX / GPU' },
  { key: 'monai', displayName: 'MONAI', function: 'Medical image analysis (radiology, pathology)', runtime: 'PyTorch / GPU' },
  { key: 'xgboost', displayName: 'XGBoost', function: 'Disease risk scoring', runtime: 'in-process' },
  { key: 'lightgbm', displayName: 'LightGBM', function: 'Facility and hospital risk / load scoring', runtime: 'in-process' },
  { key: 'isolation-forest', displayName: 'Isolation Forest', function: 'Anomaly and fraud detection', runtime: 'in-process' },
  { key: 'prophet', displayName: 'Prophet', function: 'Disease-trend and surveillance forecasting', runtime: 'in-process' },
  { key: 'faiss', displayName: 'FAISS', function: 'Vector search over the clinical knowledge base', runtime: 'in-process' },
  { key: 'qdrant', displayName: 'Qdrant', function: 'Vector database for retrieval-augmented generation', runtime: 'service' },
  { key: 'sentence-transformers', displayName: 'Sentence Transformers', function: 'Embedding generation for semantic search', runtime: 'ONNX / self-hosted' },
];

/** Idempotent. Safe to run on every deploy — inserts what is missing, touches nothing already there. */
export async function seedModelRegistry(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const model of MODEL_SHORTLIST) {
    const existing = await prisma.aiModel.findUnique({ where: { key: model.key } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.aiModel.create({
      data: {
        key: model.key,
        displayName: model.displayName,
        function: model.function,
        version: 'unpinned',
        status: model.key === 'stub' ? 'active' : 'not_deployed',
        runtime: model.runtime,
      },
    });
    inserted += 1;
  }
  return { inserted, skipped };
}

function serialise(m: {
  key: string; displayName: string; function: string; version: string; status: string;
  lastValidatedAt: Date | null; accuracySummary: string | null;
  biasReviewAt: Date | null; governanceNotes: string | null;
}) {
  return {
    key: m.key,
    function: m.function,
    version: m.version,
    status: m.status,
    last_validated_at: m.lastValidatedAt?.toISOString() ?? null,
    accuracy_summary: m.accuracySummary,
    bias_review_at: m.biasReviewAt?.toISOString() ?? null,
    governance_notes: m.governanceNotes,
  };
}

/** The register the AI governance committee reviews. */
export async function listModels() {
  const rows = await prisma.aiModel.findMany({ orderBy: { key: 'asc' } });
  return { data: rows.map(serialise) };
}

/** Resolves a model's live status; used to refuse a call to something not deployed. */
export async function getModelStatus(key: string): Promise<string | null> {
  const row = await prisma.aiModel.findUnique({ where: { key }, select: { status: true } });
  return row?.status ?? null;
}
