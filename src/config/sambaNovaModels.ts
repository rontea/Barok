export interface SambaNovaModelCatalogEntry {
  id: string;
  label: string;
  category: string;
}

export const SAMBANOVA_MODEL_CATALOG: readonly SambaNovaModelCatalogEntry[] = [
  { id: 'DeepSeek-V3.1', label: 'DeepSeek-V3.1', category: 'Reasoning' },
  { id: 'DeepSeek-V3.2', label: 'DeepSeek-V3.2', category: 'Reasoning' },
  { id: 'gpt-oss-120b', label: 'gpt-oss-120b', category: 'Text' },
  { id: 'Meta-Llama-3.3-70B-Instruct', label: 'Meta-Llama-3.3-70B-Instruct', category: 'Text' },
  { id: 'MiniMax-M2.7', label: 'MiniMax-M2.7', category: 'Text' },
  { id: 'gemma-4-31B-it', label: 'gemma-4-31B-it', category: 'Image / Text' },
] as const;

export const SAMBANOVA_MODEL_IDS = SAMBANOVA_MODEL_CATALOG.map((model) => model.id);
