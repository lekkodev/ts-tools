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

In `tsconfig.json`:

```json
{
  ...
  "compilerOptions": {
    ...
    "plugins": [
      { "transform": "@lekko/ts-transformer", "transformProgram": true }
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

## TODOs

### Automatic install script

Especially for Node projects, we should provide an automatic install script that updates users' `tsconfig.json`, `package.json`, etc. in one command.

### E2E tests

- Make the transformer testable, which also benefits "documenting" known, supported native lang syntaxes and different tsconfig options.
- Testing setup can remove dependency on CLIs and filesystem (but could start with them)
- In the long term with support for other languages we probably want a full conformance testing suite

### Performance

The end-to-end program transformation is quite slow at the moment and noticeably increases build times e.g. when using the Vite plugin. We should profile/benchmark this, but a few intuitive potential improvements:

- We make a lot of calls to executables e.g. Lekko CLI, Buf CLI
  - Especially for Lekko CLI, we should try to implement batch commands that can e.g. generate starlark for all configs in one go
  - We should investigate if we can call Buf's ES protoc plugin as a library rather than via the CLI
- We make a lot of synchronous fs I/O calls
  - See if there's things we can do virtually
  - See if we can refactor to be able to take advantage of async fs APIs
- For bundler plugins, we might want to look at implementing a watcher that can handle incremental changes instead of dealing with the whole transformed program on each build.

### HMR support
