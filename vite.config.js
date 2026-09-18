import { defineConfig } from 'vite';

// This file exists for one reason: GitHub Pages serves the project from
// https://<user>.github.io/<repo>/, not from a domain root. With Vite's default
// base of '/', the build asks for /assets/index-xxx.js, which resolves above the
// project path — a 404 for every asset and a blank page.
//
// './' rather than '/DoomSlop/': relative URLs work under any prefix, so renaming
// the repo or moving to a custom domain doesn't silently break the deploy. It also
// leaves the dev server at the root, where the headless drivers expect it —
// a hardcoded base moves dev to http://localhost:5173/DoomSlop/ and every driver
// starts navigating to a 404.
//
// Nothing else needs a base: the game loads no asset files at runtime (sounds are
// synthesized, graphics are flat colors), so the only paths in the build are the
// bundle and the stylesheet.
export default defineConfig({
  base: './',
});
