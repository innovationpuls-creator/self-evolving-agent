// Display names for provider ids. Presentation only: option values stay the exact provider id.

const common: Array<[id: string, name: string]> = [
  ['openai-codex', 'OpenAI ChatGPT 订阅'],
  ['anthropic', 'Anthropic Claude'],
  ['openai', 'OpenAI API'],
  ['google', 'Google Gemini'],
  ['deepseek', 'DeepSeek'],
  ['openrouter', 'OpenRouter'],
  ['qwen-token-plan-cn', '通义千问 Qwen（中国）'],
  ['moonshotai-cn', 'Kimi / Moonshot（中国）'],
  ['zai-coding-cn', '智谱 GLM Coding（中国）'],
  ['github-copilot', 'GitHub Copilot'],
];

const other: Record<string, string> = {
  'amazon-bedrock': 'Amazon Bedrock',
  'google-vertex': 'Google Vertex AI',
  azure: 'Azure OpenAI',
  xai: 'xAI Grok',
  groq: 'Groq',
  cerebras: 'Cerebras',
  mistral: 'Mistral',
  minimax: 'MiniMax（国际）',
  'minimax-cn': 'MiniMax（中国）',
  moonshotai: 'Kimi / Moonshot（国际）',
  'kimi-coding': 'Kimi Coding',
  zai: '智谱 Z.ai（国际）',
  'qwen-token-plan': '通义千问 Qwen（国际）',
  'qwen-token-plan-individual': '通义千问 Qwen（个人）',
  huggingface: 'Hugging Face',
  fireworks: 'Fireworks',
  together: 'Together AI',
  baseten: 'Baseten',
  nvidia: 'NVIDIA',
  meta: 'Meta Llama',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  xiaomi: '小米 MiMo',
  'xiaomi-token-plan-cn': '小米 MiMo Token Plan（中国）',
  'xiaomi-token-plan-ams': '小米 MiMo Token Plan（阿姆斯特丹）',
  'xiaomi-token-plan-sgp': '小米 MiMo Token Plan（新加坡）',
};

const names = new Map<string, string>([...common, ...Object.entries(other)]);
const commonOrder = new Map(common.map(([id], index) => [id, index]));

export function providerName(id: string, fallback?: string) {
  return names.get(id) ?? fallback ?? id;
}

/** Splits provider ids into the common list (fixed order) and the rest (sorted by display name). */
export function groupProviders<T extends { id: string }>(
  providers: T[],
  fallback?: (id: string) => string | undefined,
) {
  const label = (id: string) => providerName(id, fallback?.(id));
  const commonItems = providers
    .filter((item) => commonOrder.has(item.id))
    .sort((a, b) => (commonOrder.get(a.id) ?? 0) - (commonOrder.get(b.id) ?? 0))
    .map((item) => ({ id: item.id, name: label(item.id) }));
  const otherItems = providers
    .filter((item) => !commonOrder.has(item.id))
    .map((item) => ({ id: item.id, name: label(item.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { common: commonItems, other: otherItems };
}
