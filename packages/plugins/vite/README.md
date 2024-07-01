# @lekko/vite-plugin

The Lekko Vite plugin allows you to set up build-time code transformation to enable lekkos in your Vite projects.

With this plugin, you can write your lekkos as pure functions, which are transformed at build time to code that connects to Lekko's services to serve the latest dynamic values with static fallback built in.

## Requirements

- Vite >= 4
- TypeScript

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

> [!NOTE]
> If you initialized your project using `npm create vite`, you might have a split `tsconfig.json` file that uses the project references feature of TypeScript.
> In this case, you need to pass the `tsconfigPath` option to `lekko()`, an example of which you can see below.

## Environment variables

To connect your project to Lekko's services when building (e.g. when deploying), pass the `VITE_LEKKO_API_KEY` environment variable.

You can generate API keys for your team on the Lekko [web UI](https://app.lekko.com) by clicking on your team in the top navigation bar -> Admin tab -> API keys.

## Options

### `tsconfigPath` (optional)

Relative path to your project's `tsconfig.json` file. Defaults to `./tsconfig.json`. This option might be necessary if your project has a non-standard TypeScript setup, or if you use sub-projects via [references](https://www.typescriptlang.org/docs/handbook/project-references.html).

```js showLineNumbers
lekko({ tsconfigPath: "./tsconfig.app.json" });
```

### `verbose` (optional)

Enables verbose logging for debugging purposes.
Defaults to false.

```js showLineNumbers
lekko({ verbose: true });
```
