import { url } from './url';
// Server-side helpers for the concept registry (used by Term, Refresher, glossary).
import { getCollection, type CollectionEntry } from 'astro:content';
import { chapterKey, chapterLabel } from '../data/outline';

export type Concept = CollectionEntry<'concepts'>;

const isPublic = () => import.meta.env.PUBLIC_SITE === '1';

/** Where a reader should go to learn a concept: its introducing chapter if written, else the glossary. */
export async function conceptHref(c: Concept): Promise<{ href: string; label: string }> {
  const key = c.data.introducedIn;
  const mine = await getCollection('chapters', (e) =>
    isPublic() ? e.data.status === 'public-ready' : e.data.status !== 'not-started',
  );
  const hit = mine.find((e) => chapterKey(e.data.volume, e.data.chapter) === key);
  if (hit) return { href: url(`/chapters/${hit.id}/`), label: chapterLabel(key) };
  if (!isPublic()) {
    const teaching = await getCollection('teaching');
    const t = teaching.find((e) => chapterKey(e.data.volume, e.data.chapter) === key);
    if (t) return { href: url(`/teaching/${t.id}/`), label: chapterLabel(key) };
  }
  return { href: url(`/glossary/#${c.id}`), label: 'glossary' };
}

export async function getConcepts(ids: string[], where: string): Promise<Concept[]> {
  const all = await getCollection('concepts');
  return ids.map((id) => {
    const c = all.find((x) => x.id === id);
    if (!c) throw new Error(`${where}: unknown concept "${id}". Add it to src/data/concepts.yaml.`);
    return c;
  });
}
