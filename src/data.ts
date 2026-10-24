import { parse } from 'yaml';
import { loadDefinition } from './engine/load';
import type { UseCaseDefinition } from './engine/types';

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  status: 'available' | 'planned';
}

const rawFiles = import.meta.glob('./data/*.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const catalogSource = rawFiles['./data/catalog.yaml'];
if (!catalogSource) throw new Error('Missing use-case catalog');

const catalogValue = parse(catalogSource) as { useCases?: CatalogEntry[] };
export const catalog = catalogValue.useCases ?? [];

export const definitions = new Map<string, UseCaseDefinition>();
for (const [path, source] of Object.entries(rawFiles)) {
  if (path.endsWith('/catalog.yaml')) continue;
  const definition = loadDefinition(source);
  definitions.set(definition.id, definition);
}

for (const entry of catalog.filter(({ status }) => status === 'available')) {
  if (!definitions.has(entry.id)) throw new Error(`Catalog entry "${entry.id}" has no decision definition`);
}

