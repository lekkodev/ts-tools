# @lekko/webpack-loader

This package contains Lekko's Webpack loader and plugin for TypeScript projects bundled using Webpack.

These build tools transform your locally defined TypeScript config functions under `lekko/` into code that can communicate with Lekko and serve up-to-date dynamically configured values.

## Installation

### NPM

```
npm install -D @lekko/webpack-loader
```

### Yarn

```
yarn add -D @lekko/webpack-loader
```

### Lekko CLI

This package depends on the Lekko CLI for local development. Installing it and setting up an account will make sure your project can communicate with Lekko's services for dynamic configuration correctly.

```
brew tap lekkodev/lekko
brew install lekko

lekko setup
```

## Usage

This package has 2 main parts, the loader and the plugin:

- The loader is responsible for:
  - Transforming code under `lekko/` at build time
  - Translating config functions defined in TypeScript to a cross-language DSL, stored locally on the filesystem to be pushed to remote
- The plugin is responsible for:
  - Emitting Lekko-specific environment variables for running your project in production mode
    - Lekko's SDK clients will automatically read these environment variables

> [!NOTE]
> You only want the loader and plugin to run for **production builds**. Make sure that you add them to your production webpack configs.

Example: In your `webpack.prod.config.js`:

```typescript
const lekko = require("@lekko/webpack-loader");

...

module.exports = {
  module: {
    rules: [
      {
        test: /lekko\/.*\.ts$/,
        use: "@lekko/webpack-loader"
      }
    ]
  },
  plugins: [
    // Pass the appropriate env var `prefix` so that Lekko env vars will be picked up
    new lekko.LekkoEnvVarPlugin({ prefix: "REACT_APP_" }),
  ]
}
```
