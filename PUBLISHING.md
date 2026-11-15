# Going public: checklist

The site starts out private and informal. This file and `npm run scrub` are the breadcrumbs for turning it into something presentable.

## Automatic guards (already wired up)

| Guard | Where |
|---|---|
| Teaching drafts are never built in public mode | `src/pages/teaching/[...slug].astro` |
| Only `status: public-ready` chapters are built in public mode | `src/pages/chapters/[...slug].astro`, `src/pages/index.astro` |
| `<Callout kind="verify">` and `kind="scrub"` **fail the build** in public mode | `src/components/ui/Callout.astro` |
| `noindex` meta on every page unless public mode | `src/layouts/Base.astro` |

Public build: `npm run build:public` (sets `PUBLIC_SITE=1`).

## Markers to use while writing

- `<Callout kind="verify" title="...">`: a factual claim that still needs a citation or check.
- `<Callout kind="scrub" title="...">`: anything else to fix before going public, e.g. tone, a placeholder, or a joke that only works privately.
- `{/* SCRUB: ... */}`, `{/* TODO: ... */}`, `{/* VERIFY: ... */}`: invisible MDX comments. `npm run scrub` picks these up too.
- In `src/data/tracks.yaml`, every recording has a `rights` field. Anything other than `embed-official`, `cc`, `public-domain`, or `own` is flagged.

## Manual checklist for each chapter

- [ ] `npm run scrub` shows the chapter clean.
- [ ] Every listening cue points to an **official** upload (artist/label/orchestra channel), not a fan upload.
- [ ] Any re-created musical excerpts (MIDI or synth versions of copyrighted songs) are short, transformative, and used for commentary. Make a judgment call or get advice; it's a gray area.
- [ ] Sources cited for every empirical claim, with links where they exist.
- [ ] Prose is in your voice. No leftover teaching-draft phrasing ("Try this", "you should be able to explain…" in the wrong register).
- [ ] Widgets work on a phone and in both light and dark mode.
- [ ] Set `status: public-ready`.

## Site-wide, before first public deploy

- [ ] Decide on a domain and hosting (Cloudflare Pages or GitHub Pages; the site is fully static).
- [ ] Decide whether to keep Google Fonts (loaded from Google) or self-host fonts.
- [ ] Add an about/colophon page, including how the book was made (Claude teaching drafts → your rewrite).
- [ ] Add a license for your text and code.
- [ ] `npm run build:public`, then click through every page of `dist/`.
