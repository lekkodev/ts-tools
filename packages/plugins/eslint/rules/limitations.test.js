const { RuleTester } = require("@typescript-eslint/rule-tester");
const limitations = require("./limitations");

const ruleTester = new RuleTester({
  parserOptions: { sourceType: "module" },
});

ruleTester.run("limitations", limitations, {
  valid: [
    {
      code: "export function getFlag({ env }: { env: string }): bool { return false; }",
    },
    {
      code: "export interface ComplexType { field: string }",
    },
  ],
  invalid: [
    {
      // Async
      code: "export async function getFlag({ env }: { env: string }): Promise<bool> { return false; }",
      errors: 1,
    },
    {
      // Non-exported
      code: "function getFlag(): bool { return false; }",
      errors: 2,
    },
    {
      // Assignment statement
      code: "export function getFlag({ env }: { env: string }): bool { const x = 0; return false; }",
      errors: 1,
    },
    {
      // Function name
      code: "export function get_flag({ env }: { env: string }): bool { return false; }",
      errors: 1,
    },
    {
      // Type instead of interface
      code: "export type ComplexType = { field: string }",
      errors: 1,
    },
  ],
});
