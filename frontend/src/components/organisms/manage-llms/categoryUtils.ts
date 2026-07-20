import type { LlmModel } from '../../../types/api';

/* ── Category auto-detection (mirrors backend seed logic) ──────── */
const CATEGORY_RULES = [
  {
    test: (id: string) => /^(flux-|stable-diffusion|ideogram-|minimax-image|recraft-|bytedance-|gpt-image)/.test(id),
    category: 'Image Generation',
  },
  { test: (id: string) => /^(google-imagen|replicate-google-imagen)/.test(id), category: 'Image Generation' },
  { test: (id: string) => /^(gpt-|gpt3|o1-|o3|o4)/.test(id), category: 'OpenAI' },
  { test: (id: string) => /^(anthropic-claude|claude-)/.test(id), category: 'Anthropic' },
  { test: (id: string) => /^gemini-/.test(id), category: 'Google' },
  { test: (id: string) => /^perplexity-/.test(id), category: 'Perplexity' },
  { test: (id: string) => /^(llama-|meta-llama|codellama)/.test(id), category: 'Meta' },
  { test: (id: string) => /^deepseek-/.test(id), category: 'DeepSeek' },
  { test: (id: string) => /^cohere-/.test(id), category: 'Cohere' },
  { test: (id: string) => /^grok-/.test(id), category: 'xAI' },
];

export function autoCategory(modelId: string) {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(modelId)) return rule.category;
  }
  return 'Other';
}

export function prettifyModelId(modelId: string) {
  return modelId
    .split(/[-_]/)
    .map((s: string) =>
      /^\d+(\.\d+)?$/.test(s) || /^\d+[a-z]+$/i.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1),
    )
    .join(' ');
}

/* ── Category color mapping for badges ─────────────────────────── */
export const CATEGORY_COLORS: Record<string, string> = {
  OpenAI: 'green',
  Anthropic: 'orange',
  Google: 'blue',
  Perplexity: 'cyan',
  Meta: 'indigo',
  DeepSeek: 'violet',
  Cohere: 'pink',
  xAI: 'red',
  'Image Generation': 'grape',
  Other: 'gray',
};

export function getLatestModelUpdate(models: LlmModel[] = []) {
  const dates = models
    .map((m) => m?.updated_at || m?.created_at || '')
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length === 0) return '';
  dates.sort((a, b) => b.getTime() - a.getTime());
  const latest = dates[0];
  return latest ? latest.toISOString() : '';
}

export function filterModels(models: LlmModel[], search: string) {
  return models.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.model_id.toLowerCase().includes(q) ||
      (m.display_name || '').toLowerCase().includes(q) ||
      (m.category || '').toLowerCase().includes(q)
    );
  });
}

export function groupModelsByCategory(models: LlmModel[]) {
  const grouped: Record<string, LlmModel[]> = {};
  for (const m of models) {
    const cat = m.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  }
  return { grouped, sortedCategories: Object.keys(grouped).sort() };
}

export function getExistingCategories(models: LlmModel[]) {
  return [...new Set(models.map((m) => m.category).filter((c): c is string => !!c))].sort();
}
