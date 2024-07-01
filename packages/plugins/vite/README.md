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

## Environment variables

The plugin requires the following environment variables in production to ensure that your project is connected to Lekko's services:

- `VITE_LEKKO_API_KEY`: You can generate API keys for your team on the web UI by clicking on your team in the top navigation bar -> Admin tab -> API keys.
- `VITE_LEKKO_REPOSITORY_OWNER`: The GitHub owner for your generated Lekko repository.
- `VITE_LEKKO_REPOSITORY_NAME`: The name of your generated Lekko repository. `lekko-configs` by default.

## Options

### `tsconfigPath` (optional)

Relative path to your project's `tsconfig.json` file. Defaults to `./tsconfig.json`. This option might be necessary if your project has a non-standard TypeScript setup, or if you use sub-projects via [references](https://www.typescriptlang.org/docs/handbook/project-references.html).

```js showLineNumbers
lekko({ tsconfigPath: "./tsconfig.app.json" });
```

### `configSrcPath` (optional)

Relative path to the directory containing lekko TypeScript files.
Defaults to `./src/lekko`.

```js showLineNumbers
lekko({ configSrcPath: "./some/other/path" });
```

### `verbose` (optional)

Enables verbose logging for debugging purposes.
Defaults to false.

```js showLineNumbers
lekko({ verbose: true });
```
