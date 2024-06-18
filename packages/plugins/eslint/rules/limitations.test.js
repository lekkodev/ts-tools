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
    {
      code: `
      export interface TunableStruct {
  stringField?: string;
  numberField?: number;
  booleanField?: boolean;
}
    `},
    {
      code: `
/** tunable boolean */
export function getBooleanTunable(): boolean {
  return true;
}

    `},
    {
      code: `
/** tunable number */
export function getNumberTunable(): number {
  return 42;
}

    `},
    {
      code: `
/** tunable string */
export function getStringTunable(): string {
  return "foo";
}

    `},
    {
      code: `
/** test boolean operators */
export function getTestBooleanOperators({
  isTest,
}: {
  isTest: boolean;
}): string {
  if (isTest) {
    return "true";
  } else if (!isTest) {
    return "false";
  }
  return "default";
}

    `},
    {
      code: `
export function getTestLogicalOperators({
  env,
  isTest,
  version,
}: {
  env: string;
  isTest: boolean;
  version: number;
}): string {
  if (env === "prod" && version === 1) {
    return "and";
  } else if (env === "test" || version === 2) {
    return "or";
  } else if (env === "prod" && (version === 1 || isTest)) {
    return "and or";
  } else if (env === "prod" || (version === 1 && isTest)) {
    return "or and";
  } else if (env === "prod" && !(version === 1 && isTest)) {
    return "and not";
  }
  return "default";
}

    `},
    {
      code: `
/** test number operators */
export function getTestNumberOperators({
  version,
}: {
  version: number;
}): string {
  if (version === 1) {
    return "equals";
  } else if (version !== 2) {
    return "not equals";
  } else if (version > 3) {
    return "greater";
  } else if (version >= 4) {
    return "greater or equals";
  } else if (version < 5) {
    return "less";
  } else if (version <= 6) {
    return "less or equals";
  } else if ([1, 3, 5].includes(version)) {
    return "in";
  }
  return "default";
}
    `},
    {
      code: `

/** test string operators */
export function getTestStringOperators({ env }: { env: string }): string {
  if (env === "prod") {
    return "equals";
  } else if (env !== "dev") {
    return "not equals";
  } else if (env.includes("test")) {
    return "test";
  } else if (env.startsWith("staging")) {
    return "staging";
  } else if (env.endsWith("beta")) {
    return "beta";
  } else if (["special1", "special2"].includes(env)) {
    return "special";
  }
  return "default";
}
    `},
    {
      code: `

/** tunable interface */
export function getTunableInterface({ env }: { env: string }): TunableStruct {
  if (env === "test") {
    return {
      booleanField: true,
      numberField: 3.14,
      stringField: "test",
    };
  }
  return {
    booleanField: true,
    numberField: 42,
    stringField: "default",
  };
}
      `,
    },

  ],
  invalid: [
    {
      // Async
      code: "export async function getFlag({ env }: { env: string }): Promise<bool> { return false; }",
      output: "export  function getFlag({ env }: { env: string }): Promise<bool> { return false; }",
      errors: 1,
    },
    {
      // Non-exported
      code: "function getFlag(): bool { return false; }",
      output: "export function getFlag(): bool { return false; }",
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
    {
      // No return type
      code: "export function getSomeBool() { return true; }",
      errors: 1,
    },
    {
      code: `export function getTestStringOperators({ env, b }: { env: string; b: string }): string {
  if (b === env) {
    return "equals";
  }
  return "left"
}
    `,
      errors: 1
    },
    {
      code: `export function getTestStringOperators({ env }: { env: string }): string {
  if ("prod" === env) {
    return "equals";
  }
  return "left"
}
    `,
      output: `export function getTestStringOperators({ env }: { env: string }): string {
  if (env === "prod") {
    return "equals";
  }
  return "left"
}
    `,
      errors: 2
    }
  ],
});
