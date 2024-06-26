# @lekko/vite-plugin

The Lekko Vite plugin allows you to set up build-time code transformation to enable lekkos in your Vite projects.

With this plugin, you can write your lekkos as pure functions, which are transformed at build time to code that connects to Lekko's services to serve the latest dynamic values with static fallback built in.

## Requirements

- Vite >= 4
- TypeScript project

## Usage

Add this plugin to your `vite.config.js` config. The `lekko()` call should come last in the list of plugins.

Example for a React project:

```js showLineNumbers
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import lekko from "@lekko/vite-plugin";

export default defineConfig({
  plugins: [react(), lekko()],
  ...
})
```
