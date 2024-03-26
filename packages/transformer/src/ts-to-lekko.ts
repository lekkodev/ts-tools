import assert from "assert";
import { spawnSync } from "child_process";
import camelCase from "lodash.camelcase";
import snakeCase from "lodash.snakecase";
import fs from "node:fs";
import path from "node:path";
import ts, { type TypeChecker } from "typescript";
import {
  type ProtoFileBuilder,
  type JSONObject,
  type JSONValue,
  type LekkoConfigJSON,
  type LekkoConfigJSONRule,
  type LekkoConfigJSONTree,
  type LekkoConfigJSONValue,
  type LekkoConfigType,
  type LekkoComparisonOperator,
  type LekkoLogicalOperator,
} from "./types";
//import { rimrafSync } from "rimraf";
import { type CheckedFunctionDeclaration, isIntrinsicType } from "./helpers";

const COMPARISON_TOKEN_TO_OPERATOR: Partial<
  Record<ts.SyntaxKind, LekkoComparisonOperator>
> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "COMPARISON_OPERATOR_EQUALS",
  [ts.SyntaxKind.LessThanToken]: "COMPARISON_OPERATOR_LESS_THAN",
  [ts.SyntaxKind.LessThanEqualsToken]:
    "COMPARISON_OPERATOR_LESS_THAN_OR_EQUALS",
  [ts.SyntaxKind.GreaterThanToken]: "COMPARISON_OPERATOR_GREATER_THAN",
  [ts.SyntaxKind.GreaterThanEqualsToken]:
    "COMPARISON_OPERATOR_GREATER_THAN_OR_EQUALS",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]:
    "COMPARISON_OPERATOR_NOT_EQUALS",
};

const LOGICAL_TOKEN_TO_OPERATOR: Partial<
  Record<ts.SyntaxKind, LekkoLogicalOperator>
> = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: "LOGICAL_OPERATOR_AND",
  [ts.SyntaxKind.BarBarToken]: "LOGICAL_OPERATOR_OR",
};

function exprToContextKey(expr: ts.Expression): string {
  switch (expr.kind) {
    case ts.SyntaxKind.Identifier:
      return expr.getText();
    case ts.SyntaxKind.PropertyAccessExpression:
      return (expr as ts.PropertyAccessExpression).name.getText();
    default:
      throw new Error(`need to be able to handle: ${ts.SyntaxKind[expr.kind]}`);
  }
}

function expressionToThing(expression: ts.Expression): LekkoConfigJSONRule {
  switch (expression.kind) {
    case ts.SyntaxKind.BinaryExpression: {
      const binaryExpr = expression as ts.BinaryExpression;
      const tokenKind = binaryExpr.operatorToken.kind;
      if (tokenKind in COMPARISON_TOKEN_TO_OPERATOR) {
        return {
          atom: {
            contextKey: exprToContextKey(binaryExpr.left),
            comparisonValue: expressionToJsonValue(binaryExpr.right) as
              | boolean
              | string
              | number,
            comparisonOperator: COMPARISON_TOKEN_TO_OPERATOR[tokenKind]!,
          },
        };
      } else if (tokenKind in LOGICAL_TOKEN_TO_OPERATOR) {
        return {
          logicalExpression: {
            rules: [
              expressionToThing(binaryExpr.left),
              expressionToThing(binaryExpr.right),
            ],
            logicalOperator: LOGICAL_TOKEN_TO_OPERATOR[tokenKind]!,
          },
        };
      } else {
        throw new Error(
          `Operator ${ts.SyntaxKind[binaryExpr.operatorToken.kind]} is currently not supported`,
        );
      }
    }
    case ts.SyntaxKind.ParenthesizedExpression: {
      const expr = expression as ts.ParenthesizedExpression;
      return expressionToThing(expr.expression);
    }
    // TODO other literal types
    default: {
      throw new Error(
        `need to be able to handle: ${ts.SyntaxKind[expression.kind]}`,
      );
    }
  }
}

function ifStatementToRule(
  ifStatement: ts.IfStatement,
  namespace: string,
  returnType: string,
) {
  const block = ifStatement.thenStatement as ts.Block;
  if (block.statements.length != 1) {
    throw new Error(
      `Must only contain return statement: ${block.getFullText()}`,
    );
  }
  if (ifStatement.elseStatement != undefined) {
    throw new Error(
      `Else does not yet exist, sorry: ${ifStatement.getFullText()}`,
    );
  }
  return {
    rule: expressionToThing(ifStatement.expression),
    value: returnStatementToValue(
      block.statements[0] as ts.ReturnStatement,
      namespace,
      returnType,
    ),
  };
}

function returnStatementToValue(
  returnNode: ts.ReturnStatement,
  namespace: string,
  returnType: string,
): LekkoConfigJSONValue {
  const expression = returnNode.expression;
  assert(expression);
  return expressionToProtoValue(expression, namespace, returnType);
}

// HACK: Essential eval(), it's an easy way to handle string literals, etc.
function expressionToJsonValue(expression: ts.Expression): JSONValue {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-implied-eval
  return Function(`return ${expression.getFullText()}`)();
}

function expressionToProtoValue(
  expression: ts.Expression,
  namespace: string,
  protoType?: string,
): LekkoConfigJSONValue {
  switch (expression.kind) {
    case ts.SyntaxKind.FalseKeyword:
      return {
        "@type": "type.googleapis.com/google.protobuf.BoolValue",
        value: false,
      };
    case ts.SyntaxKind.TrueKeyword:
      return {
        "@type": "type.googleapis.com/google.protobuf.BoolValue",
        value: true,
      };
    case ts.SyntaxKind.StringLiteral:
      return {
        "@type": "type.googleapis.com/google.protobuf.StringValue",
        value: expressionToJsonValue(expression) as string,
      };
    case ts.SyntaxKind.NumericLiteral:
      return {
        "@type": "type.googleapis.com/google.protobuf.DoubleValue",
        value: new Number(expression.getText()).valueOf(),
      };
    case ts.SyntaxKind.ObjectLiteralExpression:
      return {
        ...(expressionToJsonValue(expression) as JSONObject),
        // Relies on a proto message being defined that has the same name as used
        "@type": `type.googleapis.com/${namespace}.config.v1beta1.${protoType}`,
      };
    default:
      throw new Error(
        `need to be able to handle: ${ts.SyntaxKind[expression.kind]}`,
      );
  }
}

function getLekkoType(
  returnType: ts.Type,
  checker: ts.TypeChecker,
): LekkoConfigType {
  if (returnType.flags & ts.TypeFlags.Boolean) {
    return "FEATURE_TYPE_BOOL";
  }
  if (returnType.flags & ts.TypeFlags.Number) {
    return "FEATURE_TYPE_FLOAT";
  }
  if (returnType.flags & ts.TypeFlags.String) {
    return "FEATURE_TYPE_STRING";
  }
  if (returnType.flags & ts.TypeFlags.Object) {
    return "FEATURE_TYPE_PROTO";
  }
  throw new Error(
    `Unsupported TypeScript type: ${returnType.flags} - ${checker.typeToString(returnType)}`,
  );
}

/**
 * Creates a JSON representation of a Lekko config from a function declaration.
 */
export function functionToConfigJSON(
  node: CheckedFunctionDeclaration,
  checker: ts.TypeChecker,
  namespace: string,
  configKey: string,
  returnType: ts.Type,
): LekkoConfigJSON {
  // TODO support nested interfaces
  const configType = getLekkoType(returnType, checker);

  let valueType: string;
  if (isIntrinsicType(returnType)) {
    // This is how we check for boolean/number/string
    valueType = returnType.intrinsicName;
  } else {
    valueType = checker.typeToString(
      returnType,
      undefined,
      ts.TypeFormatFlags.None,
    );
  }
  assert(node.body);

  let configTreeDefault:
    | LekkoConfigJSONTree<typeof configType>["default"]
    | undefined;
  let configTreeConstraints:
    | LekkoConfigJSONTree<typeof configType>["constraints"]
    | undefined;

  for (const statement of node.body.statements) {
    switch (statement.kind) {
      case ts.SyntaxKind.IfStatement: {
        const { rule, value } = ifStatementToRule(
          statement as ts.IfStatement,
          namespace,
          valueType,
        );
        if (configTreeConstraints === undefined) {
          configTreeConstraints = [];
        }
        configTreeConstraints.push({
          value: value,
          ruleAstNew: rule,
        });
        break;
      }
      case ts.SyntaxKind.ReturnStatement: {
        // TODO check that it's only 3
        // TODO refactor for all return types
        configTreeDefault = returnStatementToValue(
          statement as ts.ReturnStatement,
          namespace,
          valueType,
        );
        break;
      }
      default: {
        throw new Error(`Unable to handle: ${ts.SyntaxKind[statement.kind]}`);
      }
    }
  }

  assert(
    configTreeDefault,
    "Missing default value, check for return statement",
  );

  const config: LekkoConfigJSON<typeof configType> = {
    key: configKey,
    // TODO: Handle descriptions
    description: "Generated from TypeScript",
    tree: {
      default: configTreeDefault,
      constraints: configTreeConstraints,
    },
    type: configType,
  };
  return config;
}

/**
 * Generates starlark files in local config repo based on function declarations.
 * Depends on the Lekko CLI.
 */
export function genStarlark(
  repoPath: string,
  namespace: string,
  config: LekkoConfigJSON,
) {
  const configJSON = JSON.stringify(config, null, 2);
  const jsonDir = path.join(repoPath, namespace, "gen", "json");
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.writeFileSync(path.join(jsonDir, `${config.key}.json`), configJSON);
  const spawnReturns = spawnSync(
    "lekko",
    ["exp", "gen", "starlark", "-n", namespace, "-c", config.key],
    {
      encoding: "utf-8",
      cwd: repoPath,
    },
  );
  if (spawnReturns.error !== undefined || spawnReturns.status !== 0) {
    throw new Error(
      `Failed to generate starlark for ${config.key}: ${spawnReturns.stdout}${spawnReturns.stderr}`,
    );
  }
}

/**
 * Mutates the proto builder based on the interface declaration node.
 */
export function interfaceToProto(
  node: ts.InterfaceDeclaration,
  checker: TypeChecker,
  builder: ProtoFileBuilder,
) {
  const name = node.name.getText();
  const fields = node.members.map((member, idx) => {
    if (ts.isPropertySignature(member)) {
      const propertyName = snakeCase(member.name.getText());
      assert(member.type);
      const propertyType = checker.getTypeAtLocation(member.type);
      const protoType = getProtoTypeFromTypeScriptType(
        checker,
        propertyType,
        propertyName,
        name,
        builder,
      );
      return `${protoType} ${propertyName} = ${idx + 1};`;
    } else {
      throw new Error(
        `Unsupported member type: ${ts.SyntaxKind[member.kind]} - ${member.getFullText()}`,
      );
    }
  });
  builder.messages[name] = fields;
}

function symbolToFields(
  node: ts.Symbol,
  typeChecker: ts.TypeChecker,
  name: string,
  builder: ProtoFileBuilder,
) {
  if (node.members == undefined) {
    throw new Error(`Error: Programmer is incompetent.  Replace with ChatGPT.`);
  }
  return Array.from(node.members).map(([propertyName, symbol], idx) => {
    const propertyType = typeChecker.getTypeOfSymbol(symbol);
    const fieldName = snakeCase(propertyName.toString());
    const protoType = getProtoTypeFromTypeScriptType(
      typeChecker,
      propertyType,
      fieldName,
      name,
      builder,
    );
    return `${protoType} ${fieldName} = ${idx + 1};`;
  });
}

function getProtoTypeFromTypeScriptType(
  checker: TypeChecker,
  type: ts.Type,
  propertyName: string,
  name: string,
  builder: ProtoFileBuilder,
): string {
  if (type.flags & ts.TypeFlags.String) {
    return "string";
  }
  if (type.flags & ts.TypeFlags.Number) {
    return "double";
  }
  // TODO: Int fields
  if (type.flags & ts.TypeFlags.Boolean) {
    return "bool";
  }
  if (type.flags & ts.TypeFlags.Union) {
    const unionType: ts.UnionType = type as ts.UnionType;
    // If optional or undefined and another type, handle - proto fields are all optional
    if (unionType.types.length === 2) {
      let definedType: ts.Type;
      const [typeA, typeB] = unionType.types;
      if (typeA.flags & ts.TypeFlags.Undefined) {
        definedType = typeB;
      } else if (typeB.flags & ts.TypeFlags.Undefined) {
        definedType = typeA;
      } else {
        throw new Error("Union types are currently not fully supported.");
      }
      return getProtoTypeFromTypeScriptType(
        checker,
        definedType,
        propertyName,
        name,
        builder,
      );
    }
    // If all the types are ObjectLiteral - do we want to use that type, or make an enum?  Do we want to do oneOf for the others?
    throw new Error("Union types are currently not fully supported.");
  }
  if (type.flags & ts.TypeFlags.Object) {
    // Need to turn nested objects in interface to protos as well
    const camelCasePropertyName = camelCase(propertyName);
    const childName =
      name +
      camelCasePropertyName.charAt(0).toUpperCase() +
      camelCasePropertyName.slice(1);
    const symbol = type.getSymbol();
    assert(symbol);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (symbol.escapedName === "Array") {
      const typeArgs = (type as ts.TypeReference).typeArguments;
      assert(typeArgs);
      const innerType = typeArgs[0];
      return (
        "repeated " +
        getProtoTypeFromTypeScriptType(
          checker,
          innerType,
          propertyName,
          name,
          builder,
        )
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    } else if (symbol.escapedName === "Date") {
      return "int32"; // TODO dates are stupid
    } else {
      const symbol = type.getSymbol();
      assert(symbol);
      builder.messages[childName] ||= [];
      builder.messages[childName].push(
        ...symbolToFields(symbol, checker, childName, builder),
      );
    }
    return childName;
  }
  throw new Error(
    `Unsupported TypeScript type: ${type.flags} - ${checker.typeToString(type)}`,
  );
}

/**
 * Check for presence of lekko and buf CLIs. Also creates a default repo for now.
 * TODO: Add version range checks.
 */
export function checkCLIDeps() {
  const lekkoCmd = spawnSync("lekko", ["--version"]);
  const bufCmd = spawnSync("buf", ["--version"]);
  if (
    lekkoCmd.error !== undefined ||
    lekkoCmd.status !== 0 ||
    bufCmd.error !== undefined ||
    bufCmd.status !== 0
  ) {
    throw new Error(
      "Lekko CLI could not be found. Install it with `brew tap lekkodev/lekko && brew install lekko` and make sure it's located on your PATH.",
    );
  }
  const defaultInitCmd = spawnSync("lekko", ["repo", "init-default"], {
    encoding: "utf-8",
  });
  if (defaultInitCmd.error !== undefined || defaultInitCmd.status !== 0) {
    throw new Error("Failed to initialize default Lekko repo");
  }
}

function getProtoPath(repoPath: string, namespace: string) {
  return path.join(
    repoPath,
    "proto",
    namespace,
    "config",
    "v1beta1",
    `${namespace}.proto`,
  );
}

/**
 * Generate .proto files in local config repo.
 * TODO: Switch to using proto fds when we want to add more advanced features
 * and be more error-proof instead of manually constructing file contents
 */
export function genProtoFile(
  sourceFile: ts.SourceFile,
  repoPath: string,
  builder: ProtoFileBuilder,
) {
  // Nothing to write?
  if (Object.keys(builder.messages).length === 0) {
    return;
  }
  const namespace = path.basename(
    sourceFile.path,
    path.extname(sourceFile.path),
  );
  const protoPath = getProtoPath(repoPath, namespace);

  let contents = `syntax = "proto3";\n\n`;
  contents += `package ${namespace}.config.v1beta1;\n\n`;

  Object.entries(builder.messages).forEach(([messageName, fields]) => {
    contents += `message ${messageName} {\n  ${fields.join("\n  ")}\n}\n\n`;
  });

  fs.mkdirSync(path.dirname(protoPath), { recursive: true });
  fs.writeFileSync(protoPath, contents);

  const formatCmd = spawnSync("buf", ["format", protoPath, "--write"], {
    encoding: "utf-8",
  });
  if (formatCmd.error !== undefined || formatCmd.status !== 0) {
    throw new Error("Failed to generate well-formed protobuf files.");
  }
}

/**
 * Generate TS proto bindings. Depends on the buf CLI. Returns a map of
 * relative paths to generated ts contents.
 * This is a generator function - it can be reentered to trigger cleanup logic.
 */
export function* genProtoBindings(
  repoPath: string,
  outputPath: string,
  namespace: string,
) {
  const protoPath = getProtoPath(repoPath, namespace);

  if (!fs.existsSync(protoPath)) {
    yield {} as Record<string, string>;
    return;
  }

  // Generate
  const bufGenTemplate = JSON.stringify({
    version: "v1",
    managed: { enabled: true },
    plugins: [
      {
        plugin: "buf.build/bufbuild/es:v1.7.2",
        out: "gen",
        opt: ["target=ts"],
      },
    ],
  });
  const cmd = spawnSync(
    "buf",
    [
      "generate",
      "--template",
      bufGenTemplate,
      repoPath,
      "--path",
      protoPath,
      "--output",
      outputPath,
    ],
    {
      encoding: "utf-8",
    },
  );

  if (cmd.error !== undefined || cmd.status !== 0) {
    throw new Error("Failed to generate proto bindings");
  }

  // Can stop here if not interested in contents
  yield {};
  // Yield the generated _pb.ts files' relative paths and contents
  const relGenPath = path.join("gen", namespace, "config", "v1beta1");
  const absGenPath = path.join(outputPath, relGenPath);
  const files: Record<string, string> = {};
  if (!fs.existsSync(absGenPath)) {
    yield files;
    return;
  }
  fs.readdirSync(absGenPath, {
    withFileTypes: true,
  }).forEach((dirEnt) => {
    if (dirEnt.isFile() && path.extname(dirEnt.name) === ".ts") {
      files[path.join(relGenPath, dirEnt.name)] = fs.readFileSync(
        path.join(absGenPath, dirEnt.name),
        {
          encoding: "utf-8",
        },
      );
    }
  });
  yield files;

  // Clean up generated bindings
  // rimrafSync(outputPath);
}
