# Dev notes

## Organization

This project is organized as a multi-package repo using npm workspaces. The packages are located in `packages/`.

The current packages are:

- @lekko/ts-transformer
  - Responsible for translating TypeScript Lekko config files to local config repos and replacing local calls with SDK client calls at build time
- @lekko/vite-plugin
  - Plugin to be used in vite projects, uses @lekko/ts-transformer as a dependency

## Workflows

```bash
# From repo root
npm install
npm run build # builds all packages
npm pack --workspaces # creates tarballs for all packages
```

I recommend using the tarballs as the dependencies in local projects instead of pointing to the package roots, it helps with noticing dependency issues and such much easier

e.g. In `package.json`:

```json
{
  ...
  "devDependencies": {
    "@lekko/ts-transformer": "file:../ts-tools/lekko-ts-transformer-0.0.0.tgz",
    "@lekko/vite-plugin": "file:../ts-tools/lekko-vite-plugin-0.0.0.tgz",
  }
}
```

Then to update after making any changes you can run

```bash
npm uninstall @lekko/ts-transformer @lekko/vite-plugin --no-save && npm install @lekko/ts-transformer @lekko/vite-plugin --no-save --force
```
