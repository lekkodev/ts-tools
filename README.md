# @lekko/ts-tools

## Requirements

An up-to-date version of the Lekko CLI installed on the system is required for most of this library's components for translating changes in TypeScript files to local config repos.

```
brew tap lekkodev/lekko
brew install lekko
```

## Installation

```
npm install -D @lekko/ts-tools
```

## Usage

### Transformer

In `tsconfig.json`

```
{
  ...
  "compilerOptions": {
    ...
    "plugins": [
      { "transform": "@lekko/ts-tools/transformer" }
    ]
  }
}
```
