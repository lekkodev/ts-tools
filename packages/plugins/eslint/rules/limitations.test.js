const { RuleTester } = require("@typescript-eslint/rule-tester");
const limitations = require("./limitations");

const ruleTester = new RuleTester({
  parserOptions: { sourceType: "module" },
});

ruleTester.run("limitations", limitations, {
  valid: [
    {
      code: "export async function getFlag({ env }: { env: string }): Promise<bool> { return false; }",
    },
  ],
  invalid: [
    {
      code: "async function getFlag({ env }: { env: string }): Promise<bool> { return false; }",
      errors: 2,
    },
    {
      code: "export function getFlag({ env }: { env: string }): bool { return false; }",
      errors: 1,
    },
    {
      code: "export async function getFlag({ env }: { env: string }): bool { const x = 0; return false; }",
      errors: 1,
    },
    {
      code: "export async function get_flag({ env }: { env: string }): bool { return false; }",
      errors: 1,
    },
  ],
});
