import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const chapterSchema = z.object({
  title: z.string(),
  volume: z.number().int().min(0).max(7), // 0 = overture, 7 = atlas
  chapter: z.number().int(),
  summary: z.string(),
  /**
   * teaching-draft: Claude's explainer (never published)
   * not-started / rewriting / in-review / public-ready: your version's lifecycle
   */
  status: z.enum(['teaching-draft', 'not-started', 'rewriting', 'in-review', 'public-ready']),
  updated: z.coerce.date().optional(),
  /** Concept ids (src/data/concepts.yaml) the reader needs coming in. Shown in the refresher box. */
  assumes: z.array(z.string()).default([]),
  /** Concept ids this chapter teaches. */
  introduces: z.array(z.string()).default([]),
  /** Concept ids the lint should skip here because a word is used in another sense (a homonym). Say why in a YAML comment. */
  lintIgnore: z.array(z.string()).default([]),
});

/** Claude's teaching drafts: source material for your rewrite. Private only. */
const teaching = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/teaching' }),
  schema: chapterSchema,
});

/** Your rewritten chapters: the actual book. */
const chapters = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/chapters' }),
  schema: chapterSchema,
});

/**
 * Every recording referenced anywhere. `rights` is the breadcrumb for going
 * public: anything other than embed-official / cc / public-domain / own
 * needs a decision before publishing (see PUBLISHING.md).
 */
const tracks = defineCollection({
  loader: file('src/data/tracks.yaml'),
  schema: z.object({
    title: z.string(),
    artist: z.string(),
    year: z.union([z.number(), z.string()]).nullish(),
    youtube: z.string().nullish(), // video ID (official upload preferred)
    spotify: z.string().nullish(), // track ID
    search: z.string(), // fallback query when IDs aren't filled in yet
    rights: z.enum(['embed-official', 'embed-unofficial', 'cc', 'public-domain', 'own', 'recreation', 'unknown']),
    notes: z.string().optional(),
    /** A human has listened and confirmed the track (and cue timestamps) demonstrate the point. */
    listened: z.boolean().default(false),
  }),
});

/** Concept registry: terms, definitions, and where each is introduced. */
const concepts = defineCollection({
  loader: file('src/data/concepts.yaml'),
  schema: z.object({
    term: z.string(),
    category: z.string(),
    introducedIn: z.string().regex(/^v\d-\d\d$/),
    deepIn: z.string().regex(/^v\d-\d\d$/).optional(),
    aliases: z.array(z.string()).default([]),
    def: z.string(),
  }),
});

export const collections = { teaching, chapters, tracks, concepts };
