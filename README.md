# @lekko/ts-tools

## Requirements

An up-to-date version of the Lekko CLI installed on the system is required for most of this library's components for translating changes in TypeScript files to local config repos.

```bash
brew tap lekkodev/lekko
brew install lekko
```

## Packages

These packages are not published to NPM yet.

### @lekko/ts-transformer

Installation

```bash
npm install -D @lekko/ts-transformer
```

Usage

For pushing changes from native language TS files to a local Lekko repo:

```bash
npx ts-to-lekko -f src/lekko/<namespace>.ts
```

In `tsconfig.json`:

```json
{
  ...
  "compilerOptions": {
    ...
    "plugins": [
      { "transform": "@lekko/ts-transformer" }
    ]
  }
}
```

Then use with `tspc`

### @lekko/vite-plugin

Installation

```
npm install -D @lekko/vite-plugin
```

Usage

In `vite.config.js`:

```typescript
import lekko from "@lekko/vite-plugin";

export default defineConfig({
  plugins: [lekko(), react()],
  ...
});
```
