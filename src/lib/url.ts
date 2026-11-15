// Internal links go through `url()` so the site works both at the domain root
// (local dev) and under a sub-path (GitHub Pages project sites, e.g.
// https://<user>.github.io/<repo>/). The base comes from astro.config.mjs.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function url(path: string): string {
  return BASE + (path.startsWith('/') ? path : '/' + path);
}
