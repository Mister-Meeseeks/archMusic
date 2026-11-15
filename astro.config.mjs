// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// https://astro.build/config
// For GitHub Pages the site lives under /<repo>/; set SITE_BASE (and SITE_URL)
// in the deploy workflow. Locally both are unset, so the site is served at /.
export default defineConfig({
  site: process.env.SITE_URL,
  base: process.env.SITE_BASE ?? '/',
  integrations: [mdx(), react()],
});