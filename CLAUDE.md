# The Architecture of Music

An online, interactive "Modernist Cuisine for music": a first-principles course spanning art music and popular music. The site is built with Astro + MDX, and its widgets are React + Web Audio.

## The workflow (important)

The owner is **learning this material as they go**. They have some rusty music theory. Each chapter goes through a loop:

1. **Claude writes a teaching draft** → `src/content/teaching/<id>.mdx` (`status: teaching-draft`).
   The draft teaches the owner. It explains more than the final chapter needs, says plainly where the science is uncertain, includes `check` questions, and ends with a `rewrite` callout. That callout lists what the owner should be able to explain, the decisions they need to make for their rewrite, and misconceptions to avoid. Mark factual claims that need checking with `<Callout kind="verify">`.
2. **The owner rewrites** it in their own voice → `src/content/chapters/<same id>.mdx`. Rewriting is how they learn the material and how the text loses its AI tone. Don't write their version for them.
3. **Claude reviews** the rewrite (`status: in-review`): factual accuracy against the teaching draft and the sources, clarity, proofreading. Suggest edits rather than silently rewriting their voice.

Section headings are plain textbook titles ("A vibrating string"), never "Step N:". Chapters read like a textbook, not a how-to guide. Refer to other sections by name, not number.

Chapter ids look like `v1-05-consonance` (volume, chapter, slug). The `volume` and `chapter` frontmatter link a chapter to `src/data/outline.ts`.

## Introduced before use (important)

Readers (including the owner) may be years away from any music theory. The rule: **never use a term the reader hasn't been introduced to.** It's fine to move fast and not simplify, as long as every term has been defined somewhere earlier.

- Every term the book relies on lives in `src/data/concepts.yaml`, with a definition, `introducedIn` (the first chapter that teaches it), and optionally `deepIn`. Basic vocabulary (notes, octaves, intervals, chords) is introduced in the Overture's "Toolkit" primer (`v0-02`), so later chapters can assume it.
- Each chapter's frontmatter declares `assumes:` (prior knowledge; rendered automatically as the **Quick refresher** box at the top) and `introduces:` (taught in this chapter).
- If a chapter needs a term that's only taught later, explain it briefly where it's used, list it in `introduces`, and set its `introducedIn` to the earliest chapter that explains it.
- Use `<Term id="...">` for inline hover/tap definitions where a reader might have lost the thread, especially for assumed terms deep in a chapter.
- Run `npm run concepts`. It flags terms used without being declared, terms assumed before they're taught, and unknown ids. Keep it at 0 problems. When adding a new term to the registry, give it specific aliases so the lint can find it.

## Going public later

The site is private and informal for now. Keep breadcrumbs so it can be cleaned up later (see `PUBLISHING.md`):

- `<Callout kind="verify">` / `kind="scrub"` for anything not yet presentable. These fail a public build.
- Every recording goes in `src/data/tracks.yaml` with an honest `rights` value. Never invent YouTube or Spotify IDs. Find candidates (e.g. a web search restricted to `open.spotify.com` or `youtube.com`), then confirm each ID with `npm run verify-track -- spotify:<id> youtube:<id>`, which reads the public metadata. Prefer official YouTube uploads ("<Artist> - Topic", VEVO, or the label/orchestra channel) that match the Spotify recording. Pick recordings that clearly demonstrate the point, not just any match. Leave `listened: false` until the owner confirms by ear.
- Song maps (`<SongMap track=...>`) read a `map:` (sections, events, `verified`) from the track in `tracks.yaml`. Estimated timestamps stay `verified: false` until the owner retimes them by ear (the map's "Retime" panel prints YAML).
- Run `npm run scrub` for the report.

## Structure

- `src/lib/`: framework-free logic. `audio.ts` (shared AudioContext, `AdditiveVoice`, one-widget-at-a-time), `dissonance.ts` (Sethares/Plomp–Levelt roughness model, spectra), `tuning.ts`, `sequence.ts` (scheduling fixed passages on the audio clock), `spectrum.ts`, `rhythm.ts`.
- `src/components/widgets/*.tsx`: React widgets. `ui.tsx` holds the shared frame and controls (styles are the `w-` classes in `src/styles/global.css`).
- `src/components/embeds/*.astro`: thin wrappers that hydrate widgets (`client:visible`).
- `src/components/mdx.ts`: the registry of components usable in MDX **without imports**. To add a widget, write the `.tsx`, copy a wrapper, and register it here.
- `src/components/ui/`: `Callout`, `Answer`, `ListeningCue`, `Term`, `Refresher` (auto-rendered by the chapter layout).
- `src/data/concepts.yaml` + `src/lib/concepts.ts`: concept registry; `/glossary/` lists it.
- Design principles for widgets: build reusable labs (each one should serve several chapters), make every visual reflect the actual model, and give each widget a caption saying what you're looking at.

## Hosting

- Every push to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`), at https://mister-meeseeks.github.io/archMusic/. The repo and site are public. The deploy uses the private build, so teaching drafts are included.
- The site lives under a sub-path there, so internal links must go through `url()` from `src/lib/url.ts` (e.g. `href={url('/glossary/')}`). In MDX, use relative links (`../../glossary/`).

## Commands

- `npm run dev`: dev server. For agents: `npx astro dev --background`, then manage it with `astro dev stop|status|logs`.
- `npm run build`: private build (everything).
- `npm run build:public`: public build (`PUBLIC_SITE=1`).
- `npm run scrub`: report of pre-publication issues.
- `npm run concepts`: introduced-before-use lint.
- `npm run check`: type-check.
