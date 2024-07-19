# @lekko/eslint-plugin

The Lekko eslint plugin provides warnings on syntax that is incompatible for Lekko config functions.

This plugin will continue to be updated to better match the list of supported/unsupported features.

## Installation

`npm i -D @lekko/eslint-plugin`

## Usage

New eslint configuration format:

```js
import lekko from "@lekko/eslint-plugin";

export default [
  {
    files: ["src/lekko/*.ts"],
    plugins: { lekko: lekko },
    rules: { "lekko/limitations": "error" },
  },
];
```

Legacy eslint configuration format:

```json
// .eslintrc.json
{
  "plugins": ["@lekko"],
  "overrides": [
    {
      "files": ["src/lekko/*.ts"],
      "rules": {
        "@lekko/limitations": "error"
      }
    }
  ]
}
```
