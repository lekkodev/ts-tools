# eslint-plugin-lekko

`npm i -D eslint-plugin-lekko`

```
.eslintrc.json
{
  "extends": "next/core-web-vitals",
  "plugins": [
    "lekko"
  ],
  "overrides": [
    {
      "files": ["src/lekko/*.ts"],
      "rules": {
        "lekko/lekko-limitations": "error"
      }
    }
  ]
}
```
