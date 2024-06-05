import assert from "assert";
import { spawnSync } from "child_process";
import camelCase from "lodash.camelcase";
import snakeCase from "lodash.snakecase";
import upperFirst from "lodash.upperfirst";
import fs from "node:fs";
import path from "node:path";
import ts, { type TypeChecker } from "typescript";
import { LekkoParseError } from "./errors";
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
  type SupportedExpressionName,
  LEKKO_CLI_NOT_FOUND,
} from "./types";
import { type CheckedFunctionDeclaration, isIntrinsicType, LEKKO_FILENAME_REGEX } from "./helpers";
import { checkConfigFunctionDeclaration } from "./transformer";
import { FieldDescriptorProto, FileDescriptorProto, DescriptorProto } from "@bufbuild/protobuf";

const COMPARISON_TOKEN_TO_OPERATOR: Partial<Record<ts.SyntaxKind, LekkoComparisonOperator>> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "COMPARISON_OPERATOR_EQUALS",
  [ts.SyntaxKind.LessThanToken]: "COMPARISON_OPERATOR_LESS_THAN",
  [ts.SyntaxKind.LessThanEqualsToken]: "COMPARISON_OPERATOR_LESS_THAN_OR_EQUALS",
  [ts.SyntaxKind.GreaterThanToken]: "COMPARISON_OPERATOR_GREATER_THAN",
  [ts.SyntaxKind.GreaterThanEqualsToken]: "COMPARISON_OPERATOR_GREATER_THAN_OR_EQUALS",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "COMPARISON_OPERATOR_NOT_EQUALS",
};

const LOGICAL_TOKEN_TO_OPERATOR: Partial<Record<ts.SyntaxKind, LekkoLogicalOperator>> = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: "LOGICAL_OPERATOR_AND",
  [ts.SyntaxKind.BarBarToken]: "LOGICAL_OPERATOR_OR",
};

const EXPRESSION_NAME_TO_OPERATOR: Partial<Record<SupportedExpressionName, LekkoComparisonOperator>> = {
  includes: "COMPARISON_OPERATOR_CONTAINS",
  startsWith: "COMPARISON_OPERATOR_STARTS_WITH",
  endsWith: "COMPARISON_OPERATOR_ENDS_WITH",
};

function exprToContextKey(expr: ts.Expression): string {
  switch (expr.kind) {
    case ts.SyntaxKind.Identifier:
      return snakeCase(expr.getText());
    case ts.SyntaxKind.PropertyAccessExpression:
      return snakeCase((expr as ts.PropertyAccessExpression).name.getText());
    default:
      throw new LekkoParseError(`need to be able to handle: ${ts.SyntaxKind[expr.kind]}`, expr);
  }
}

function matchBooleanIdentifier(checker: ts.TypeChecker, ident: ts.Identifier, value: boolean): LekkoConfigJSONRule | undefined {
  const identType = checker.getTypeAtLocation(ident);
  if (identType.flags & ts.TypeFlags.Boolean) {
    return {
      atom: {
        contextKey: exprToContextKey(ident),
        comparisonOperator: "COMPARISON_OPERATOR_EQUALS",
        comparisonValue: value,
      },
    };
  }
  return undefined;
}

function expressionToRule(checker: ts.TypeChecker, expression: ts.Expression): LekkoConfigJSONRule {
  switch (expression.kind) {
    case ts.SyntaxKind.Identifier: {
      const rule = matchBooleanIdentifier(checker, expression as ts.Identifier, true);
      if (rule) {
        return rule;
      }
      throw new LekkoParseError("Not a boolean expression", expression);
    }
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const prefixExpr = expression as ts.PrefixUnaryExpression;
      if (prefixExpr.operator === ts.SyntaxKind.ExclamationToken) {
        if (prefixExpr.operand.kind === ts.SyntaxKind.Identifier) {
          const rule = matchBooleanIdentifier(checker, prefixExpr.operand as ts.Identifier, false);
          if (rule) {
            return rule;
          }
        } else {
          return {
            not: expressionToRule(checker, prefixExpr.operand),
          };
        }
      }
      throw new LekkoParseError("Unsupported PrefixUnaryExpression", expression);
    }
    case ts.SyntaxKind.BinaryExpression: {
      const binaryExpr = expression as ts.BinaryExpression;
      const tokenKind = binaryExpr.operatorToken.kind;

      if (tokenKind === ts.SyntaxKind.ExclamationEqualsEqualsToken && binaryExpr.right.getText() === "undefined") {
        return {
          atom: {
            contextKey: exprToContextKey(binaryExpr.left),
            comparisonOperator: "COMPARISON_OPERATOR_PRESENT",
          },
        };
      } else if (tokenKind in COMPARISON_TOKEN_TO_OPERATOR) {
        return {
          atom: {
            contextKey: exprToContextKey(binaryExpr.left),
            comparisonValue: expressionToJsonValue(binaryExpr.right) as boolean | string | number,
            comparisonOperator: COMPARISON_TOKEN_TO_OPERATOR[tokenKind]!,
          },
        };
      } else if (tokenKind in LOGICAL_TOKEN_TO_OPERATOR) {
        let rules: LekkoConfigJSONRule[] = [];
        const left = expressionToRule(checker, binaryExpr.left);
        if ("logicalExpression" in left && left.logicalExpression.logicalOperator === LOGICAL_TOKEN_TO_OPERATOR[tokenKind]) {
          rules = rules.concat(left.logicalExpression.rules);
        } else {
          rules.push(left);
        }
        const right = expressionToRule(checker, binaryExpr.right);
        if ("logicalExpression" in right && right.logicalExpression.logicalOperator === LOGICAL_TOKEN_TO_OPERATOR[tokenKind]) {
          rules = rules.concat(right.logicalExpression.rules);
        } else {
          rules.push(right);
        }

        return {
          logicalExpression: {
            rules,
            logicalOperator: LOGICAL_TOKEN_TO_OPERATOR[tokenKind]!,
          },
        };
      } else {
        throw new LekkoParseError(`Operator ${ts.SyntaxKind[binaryExpr.operatorToken.kind]} is currently not supported`, binaryExpr.operatorToken);
      }
    }
    case ts.SyntaxKind.ParenthesizedExpression: {
      const expr = expression as ts.ParenthesizedExpression;
      return expressionToRule(checker, expr.expression);
    }
    case ts.SyntaxKind.CallExpression: {
      const callExpr = expression as ts.CallExpression;
      const propertyAccessExpr = callExpr.expression;

      if (ts.isPropertyAccessExpression(propertyAccessExpr)) {
        const expressionName = propertyAccessExpr.name.text as SupportedExpressionName;

        if (callExpr.arguments.length > 1) {
          throw new LekkoParseError(
            `Call expression ${propertyAccessExpr.getText()} with more than one argument is currently not supported`,
            propertyAccessExpr,
          );
        }

        if (expressionName === "includes" && ts.isArrayLiteralExpression(propertyAccessExpr.expression)) {
          const contextKey = exprToContextKey(callExpr.arguments[0]);
          const arrayElements = processArrayElements(propertyAccessExpr.expression.elements);

          return {
            atom: {
              contextKey,
              comparisonValue: arrayElements,
              comparisonOperator: "COMPARISON_OPERATOR_CONTAINED_WITHIN",
            },
          };
        }

        const comparisonOperator = EXPRESSION_NAME_TO_OPERATOR[expressionName];

        if (comparisonOperator !== undefined) {
          return {
            atom: {
              contextKey: exprToContextKey(propertyAccessExpr.expression),
              comparisonValue: expressionToJsonValue(callExpr.arguments[0]) as string | number | boolean,
              comparisonOperator: comparisonOperator,
            },
          };
        }
      }
      throw new LekkoParseError(`Call expression ${propertyAccessExpr.getText()} is currently not supported`, propertyAccessExpr);
    }
    // TODO other literal types
    default: {
      throw new LekkoParseError(`need to be able to handle: ${ts.SyntaxKind[expression.kind]}`, expression);
    }
  }
}

function ifStatementToRule(checker: ts.TypeChecker, ifStatement: ts.IfStatement, namespace: string, returnType: string) {
  const block = ifStatement.thenStatement as ts.Block;
  if (block.statements.length != 1) {
    throw new LekkoParseError(`Must only contain return statement: ${block.getFullText()}`, block);
  }
  const ret = [
    {
      rule: expressionToRule(checker, ifStatement.expression),
      value: returnStatementToValue(block.statements[0] as ts.ReturnStatement, namespace, returnType),
    },
  ];

  if (ifStatement.elseStatement) {
    if (ifStatement.elseStatement.kind === ts.SyntaxKind.IfStatement) {
      ret.push(...ifStatementToRule(checker, ifStatement.elseStatement as ts.IfStatement, namespace, returnType));
    } else {
      throw new LekkoParseError(`invalid else statement: ${block.getFullText()}`, block);
    }
  }

  return ret;
}

function returnStatementToValue(returnNode: ts.ReturnStatement, namespace: string, returnType: string): LekkoConfigJSONValue {
  const expression = returnNode.expression;
  assert(expression);
  return expressionToProtoValue(expression, namespace, returnType);
}

// HACK: Essential eval(), it's an easy way to handle string literals, etc.
function expressionToJsonValue(expression: ts.Expression): JSONValue {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-implied-eval
  return Function(`return ${expression.getFullText().trim()}`)();
}

function expressionToProtoValue(expression: ts.Expression, namespace: string, protoType?: string): LekkoConfigJSONValue {
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
      throw new LekkoParseError(`need to be able to handle: ${ts.SyntaxKind[expression.kind]}`, expression);
  }
}

function getLekkoType(node: ts.Node, returnType: ts.Type, checker: ts.TypeChecker): LekkoConfigType {
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
  throw new LekkoParseError(`Unsupported TypeScript type: ${returnType.flags} - ${checker.typeToString(returnType)}`, node);
}

function getDescription(node: ts.FunctionDeclaration): string | undefined {
  if (node.jsDoc === undefined || node.jsDoc.length === 0) {
    return undefined;
  }
  const comment = node.jsDoc[node.jsDoc.length - 1].comment;
  if (comment === undefined || typeof comment === "string") {
    return comment;
  }
  // If the comment has jsdoc links, it will be a node array composed of multiple sections.
  // It's JS-specific, so for now let's not support it.
  throw new Error("JSDoc links are not supported in Lekko config descriptions");
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
  const configType = getLekkoType(node, returnType, checker);

  let valueType: string;
  if (isIntrinsicType(returnType)) {
    // This is how we check for boolean/number/string
    valueType = returnType.intrinsicName;
  } else {
    valueType = checker.typeToString(returnType, undefined, ts.TypeFormatFlags.None);
  }
  assert(node.body);

  let configTreeDefault: LekkoConfigJSONTree<typeof configType>["default"] | undefined;
  let configTreeConstraints: LekkoConfigJSONTree<typeof configType>["constraints"] | undefined;

  for (const [_, statement] of node.body.statements.entries()) {
    switch (statement.kind) {
      case ts.SyntaxKind.IfStatement: {
        const ruleValPairs = ifStatementToRule(checker, statement as ts.IfStatement, namespace, valueType);
        if (configTreeConstraints === undefined) {
          configTreeConstraints = [];
        }
        for (const { value, rule } of ruleValPairs) {
          configTreeConstraints.push({
            value: value,
            ruleAstNew: rule,
          });
        }
        break;
      }
      case ts.SyntaxKind.ReturnStatement: {
        // TODO check that it's only 3
        // TODO refactor for all return types
        configTreeDefault = returnStatementToValue(statement as ts.ReturnStatement, namespace, valueType);
        break;
      }
      default: {
        throw new LekkoParseError(`Unable to handle: ${ts.SyntaxKind[statement.kind]}`, statement);
      }
    }
  }

  assert(configTreeDefault, "Missing default value, check for return statement");

  const config: LekkoConfigJSON<typeof configType> = {
    key: configKey,
    // TODO: Handle descriptions
    description: getDescription(node) ?? "",
    tree: {
      default: configTreeDefault,
      constraints: configTreeConstraints,
    },
    type: configType,
  };
  return config;
}

function functionToDescriptor(node: CheckedFunctionDeclaration, checker: ts.TypeChecker): DescriptorProto {
  const param = node.parameters[0];
  const propertyType = checker.getTypeAtLocation(param.type as ts.TypeReferenceNode);
  const symbol = propertyType.getSymbol();
  assert(symbol);
  return symbolToDescriptorProto(
    symbol,
    checker,
    `${new ProtoName(node.name.text).messageName()}.Signature`,
    `${path}.${new ProtoName(node.name.text).messageName()}`,
  );
}

/**
 * Generates starlark files in local config repo based on function declarations.
 * Depends on the Lekko CLI.
 */
export function genStarlark(repoPath: string, namespace: string, config: LekkoConfigJSON) {
  const configJSON = JSON.stringify(config, null, 2);
  const jsonDir = path.join(repoPath, namespace, "gen", "json");
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.writeFileSync(path.join(jsonDir, `${config.key}.json`), configJSON);
  const spawnReturns = spawnSync("lekko", ["gen", "starlark", "-n", namespace, "-c", config.key], {
    encoding: "utf-8",
    cwd: repoPath,
  });
  if (spawnReturns.error !== undefined || spawnReturns.status !== 0) {
    throw new Error(`Failed to generate starlark for ${config.key}: ${spawnReturns.stdout}${spawnReturns.stderr}`);
  }
}

/**
 * Mutates the proto builder based on the interface declaration node.
 */
export function interfaceToProto(node: ts.InterfaceDeclaration, checker: TypeChecker, builder: ProtoFileBuilder) {
  const name = node.name.getText();
  const fields = node.members.map((member, idx) => {
    if (ts.isPropertySignature(member)) {
      const propertyName = snakeCase(member.name.getText());
      assert(member.type);
      const propertyType = checker.getTypeAtLocation(member.type);
      const protoType = getProtoTypeFromTypeScriptType(checker, propertyType, propertyName, name, builder);
      return `${protoType} ${propertyName} = ${idx + 1};`;
    } else {
      throw new LekkoParseError(`Unsupported member type: ${ts.SyntaxKind[member.kind]} - ${member.getFullText()}`, member);
    }
  });
  builder.messages[name] = fields;
}

function symbolToFields(node: ts.Symbol, typeChecker: ts.TypeChecker, name: string, builder: ProtoFileBuilder) {
  if (node.members == undefined) {
    throw new Error(`Error: Programmer is incompetent.  Replace with ChatGPT.`);
  }
  return Array.from(node.members).map(([propertyName, symbol], idx) => {
    const propertyType = typeChecker.getTypeOfSymbol(symbol);
    const fieldName = snakeCase(propertyName.toString());
    const protoType = getProtoTypeFromTypeScriptType(typeChecker, propertyType, fieldName, name, builder);
    return `${protoType} ${fieldName} = ${idx + 1};`;
  });
}

function getProtoTypeFromTypeScriptType(checker: TypeChecker, type: ts.Type, propertyName: string, name: string, builder: ProtoFileBuilder): string {
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
    // But specifically for optional booleans, there are 3 types - true, false, and undefined
    if (unionType.types.length === 3) {
      if (
        unionType.types.some((t) => isIntrinsicType(t) && t.intrinsicName === "false") &&
        unionType.types.some((t) => isIntrinsicType(t) && t.intrinsicName === "true") &&
        unionType.types.some((t) => t.flags & ts.TypeFlags.Undefined)
      ) {
        return "bool";
      } else {
        throw new Error("Union types are currently not fully supported.");
      }
    } else if (unionType.types.length === 2) {
      let definedType: ts.Type;
      const [typeA, typeB] = unionType.types;
      if (typeA.flags & ts.TypeFlags.Undefined) {
        definedType = typeB;
      } else if (typeB.flags & ts.TypeFlags.Undefined) {
        definedType = typeA;
      } else {
        throw new Error("Union types are currently not fully supported.");
      }
      return getProtoTypeFromTypeScriptType(checker, definedType, propertyName, name, builder);
    }
    // If all the types are ObjectLiteral - do we want to use that type, or make an enum?  Do we want to do oneOf for the others?
    throw new Error("Union types are currently not fully supported.");
  }
  if (type.flags & ts.TypeFlags.Object) {
    // Need to turn nested objects in interface to protos as well
    const camelCasePropertyName = camelCase(propertyName);
    const childName = name + camelCasePropertyName.charAt(0).toUpperCase() + camelCasePropertyName.slice(1);
    const symbol = type.getSymbol();
    assert(symbol);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (symbol.escapedName === "Array") {
      const typeArgs = (type as ts.TypeReference).typeArguments;
      assert(typeArgs);
      const innerType = typeArgs[0];
      return "repeated " + getProtoTypeFromTypeScriptType(checker, innerType, propertyName, name, builder);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    } else if (symbol.escapedName === "Date") {
      return "int32"; // TODO dates are stupid
    } else {
      const symbol = type.getSymbol();
      assert(symbol);
      builder.messages[childName] ||= [];
      builder.messages[childName].push(...symbolToFields(symbol, checker, childName, builder));
    }
    return childName;
  }
  throw new Error(`Unsupported TypeScript type: ${type.flags} - ${checker.typeToString(type)}`);
}

/**
 * Check for presence of lekko and buf CLIs. Also creates a default repo for now.
 * TODO: Add version range checks.
 */
export function checkCLIDeps() {
  const lekkoCmd = spawnSync("lekko", ["--version"]);
  const bufCmd = spawnSync("buf", ["--version"]);
  if (lekkoCmd.error !== undefined || lekkoCmd.status !== 0 || bufCmd.error !== undefined || bufCmd.status !== 0) {
    throw new Error(LEKKO_CLI_NOT_FOUND);
  }
  const defaultInitCmd = spawnSync("lekko", ["repo", "init-default"], {
    encoding: "utf-8",
  });
  if (defaultInitCmd.error !== undefined || defaultInitCmd.status !== 0) {
    throw new Error("Failed to initialize default Lekko repo");
  }
}

/**
 * Returns list of config names under specified namespace in the config repo
 */
export function listConfigs(repoPath: string, namespace: string) {
  const listCmd = spawnSync("lekko", ["config", "list", "-n", namespace], {
    encoding: "utf-8",
    cwd: repoPath,
  });
  if (listCmd.error !== undefined || listCmd.status !== 0) {
    throw new Error(`Failed to list current configs: ${listCmd.stdout}${listCmd.stderr}`);
  }
  return listCmd.stdout
    .trim()
    .split("\n")
    .map((nsConfigPair) => nsConfigPair.split("/")[1]);
}

export function removeConfig(repoPath: string, namespace: string, configKey: string) {
  const removeCmd = spawnSync("lekko", ["config", "remove", "-n", namespace, "-c", configKey, "--force"], {
    encoding: "utf-8",
    cwd: repoPath,
  });
  if (removeCmd.error !== undefined || removeCmd.status !== 0) {
    throw new Error(`Failed to remove config ${namespace}/${configKey}: ${removeCmd.stdout}${removeCmd.stderr}`);
  }
}

function getProtoPath(repoPath: string, namespace: string) {
  return path.join(repoPath, "proto", namespace, "config", "v1beta1", `${namespace}.proto`);
}

/**
 * Generate .proto files in local config repo.
 * TODO: Switch to using proto fds when we want to add more advanced features
 * and be more error-proof instead of manually constructing file contents
 */
export function genProtoFile(sourceFile: ts.SourceFile, repoPath: string, builder: ProtoFileBuilder) {
  // Nothing to write?
  if (Object.keys(builder.messages).length === 0) {
    return;
  }
  const namespace = path.basename(sourceFile.path, path.extname(sourceFile.path));
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
    throw new Error(`Failed to generate well-formed protobuf files: ${formatCmd.stdout}${formatCmd.stderr}.`);
  }
}

/**
 * Generate TS proto bindings. Depends on the buf CLI. Returns a map of
 * relative paths to generated ts contents.
 * This is a generator function - it can be reentered to trigger cleanup logic.
 */
export function* genProtoBindings(repoPath: string, outputPath: string, namespace: string) {
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
  const cmd = spawnSync("buf", ["generate", "--template", bufGenTemplate, repoPath, "--path", protoPath, "--output", outputPath], {
    encoding: "utf-8",
  });

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
      files[path.join(relGenPath, dirEnt.name)] = fs.readFileSync(path.join(absGenPath, dirEnt.name), {
        encoding: "utf-8",
      });
    }
  });
  yield files;

  // Clean up generated bindings
  // rimrafSync(outputPath);
}

function processArrayElement(element: ts.Expression) {
  if (ts.isStringLiteral(element)) {
    return element.text;
  } else if (ts.isNumericLiteral(element)) {
    return Number(element.text);
  } else if (element.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  } else if (element.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  } else {
    return element.getText();
  }
}

function processArrayElements(elements: ts.NodeArray<ts.Expression>): Array<string | number | boolean> {
  if (elements.length === 0) {
    return [];
  }
  let elementsType: "string" | "number" | "boolean" | undefined = undefined;
  const processed = elements.map((element) => {
    const processedElement = processArrayElement(element);
    const processedElementType = typeof processedElement;
    // I don't understand how `processedElementType` can be any of these,
    // but TypeScript made me do it.
    if (
      processedElementType === "bigint" ||
      processedElementType === "symbol" ||
      processedElementType === "object" ||
      processedElementType === "function" ||
      processedElementType === "undefined"
    ) {
      throw new LekkoParseError(`${processedElementType} is not supported`, element);
    }
    if (elementsType === undefined) {
      elementsType = processedElementType;
    } else if (processedElementType !== elementsType) {
      throw new LekkoParseError("Array elements must be of the same type", element);
    }
    return processedElement;
  });
  return processed;
}

/*
 * Proto naming convention
 * MessageNames in UpperCamel
 * field_names in snake_case
 * tsVariables in camelCase
 * TsInterfaces in UpperCamel
 * config-names in kebab-case
 */
class ProtoName {
  raw: string;
  constructor(raw: string) {
    this.raw = raw;
  }

  public messageName() {
    return upperFirst(camelCase(this.raw));
  }
  public fieldName() {
    return snakeCase(this.raw);
  }
}

export function paramArrayToDescriptorProto(
  params: ts.NodeArray<ts.ParameterDeclaration>,
  checker: TypeChecker,
  messageName: string,
  path: string,
): DescriptorProto {
  const ret = new DescriptorProto({ name: messageName });
  for (let idx = 0; idx < params.length; ++idx) {
    const param = params[idx];
    //const propertyName = (param.name as ts.Identifier).text;
    const propertyType = checker.getTypeAtLocation(param.type as ts.TypeReferenceNode);
    //const fieldName = new ProtoName(propertyName.toString());
    const fieldName = new ProtoName(""); // always going to be an object
    tsTypeToProtoFieldDescription(ret, checker, propertyType, fieldName, `${path}.${messageName}`, idx + 1);
    const symbol = propertyType.getSymbol();
    assert(symbol);
    return symbolToDescriptorProto(symbol, checker, fieldName.messageName(), `${path}.${messageName}`);
  }
  return ret;
}

export function interfaceToDescriptorProto(namespace: string, node: ts.InterfaceDeclaration, checker: TypeChecker): DescriptorProto {
  const ret = new DescriptorProto();
  const interfaceName = new ProtoName(node.name.getText());
  ret.name = interfaceName.messageName();
  ret.field = [];
  for (let idx = 0; idx < node.members.length; ++idx) {
    const member = node.members[idx];
    if (ts.isPropertySignature(member)) {
      const fieldName = new ProtoName(member.name.getText());
      assert(member.type);
      const propertyType = checker.getTypeAtLocation(member.type);
      tsTypeToProtoFieldDescription(ret, checker, propertyType, fieldName, `.lekko.${namespace}.${interfaceName.messageName()}`, idx + 1);

      // the inner thing always returns a field, and may return a nested type
    } else {
      throw new LekkoParseError(`Unsupported member type: ${ts.SyntaxKind[member.kind]} - ${member.getFullText()}`, member);
    }
  }
  return ret;
}

export function symbolToDescriptorProto(node: ts.Symbol, checker: TypeChecker, messageName: string, path: string): DescriptorProto {
  if (node.members == undefined) {
    throw new Error(`Error: Programmer is incompetent.  Replace with ChatGPT.`);
  }
  const ret = new DescriptorProto({ name: messageName });

  const members = Array.from(node.members);
  for (let idx = 0; idx < members.length; ++idx) {
    const [propertyName, symbol] = members[idx];
    const propertyType = checker.getTypeOfSymbol(symbol);
    const fieldName = new ProtoName(propertyName.toString());

    tsTypeToProtoFieldDescription(ret, checker, propertyType, fieldName, path, idx + 1);
  }
  return ret;
}

// todo - I think we want PATH not message name
// namespace.MessageName as path
function tsTypeToProtoFieldDescription(d: DescriptorProto, checker: TypeChecker, type: ts.Type, fieldName: ProtoName, path: string, fieldNumber: number) {
  // TODO handle Sub-Messages
  const fd = {
    name: fieldName.fieldName(),
    number: fieldNumber,
    type: "",
    typeName: "",
  };
  if (type.flags & ts.TypeFlags.String) {
    fd.type = "TYPE_STRING";
    d.field.push(FieldDescriptorProto.fromJson(fd));
    return;
  }
  if (type.flags & ts.TypeFlags.Number) {
    fd.type = "TYPE_DOUBLE";
    d.field.push(FieldDescriptorProto.fromJson(fd));
    return;
  }
  // TODO: Int fields
  if (type.flags & ts.TypeFlags.Boolean) {
    fd.type = "TYPE_BOOL";
    d.field.push(FieldDescriptorProto.fromJson(fd));
    return;
  }
  if (type.flags & ts.TypeFlags.Union) {
    const unionType: ts.UnionType = type as ts.UnionType;
    // If optional or undefined and another type, handle - proto fields are all optional
    // But specifically for optional booleans, there are 3 types - true, false, and undefined
    if (unionType.types.length === 3) {
      if (
        unionType.types.some((t) => isIntrinsicType(t) && t.intrinsicName === "false") &&
        unionType.types.some((t) => isIntrinsicType(t) && t.intrinsicName === "true") &&
        unionType.types.some((t) => t.flags & ts.TypeFlags.Undefined)
      ) {
        fd.type = "TYPE_BOOL";
        d.field.push(FieldDescriptorProto.fromJson(fd));
        return;
      } else {
        throw new Error("Union types are currently not fully supported.");
      }
    } else if (unionType.types.length === 2) {
      let definedType: ts.Type;
      const [typeA, typeB] = unionType.types;
      if (typeA.flags & ts.TypeFlags.Undefined) {
        definedType = typeB;
      } else if (typeB.flags & ts.TypeFlags.Undefined) {
        definedType = typeA;
      } else {
        throw new Error("Union types are currently not fully supported.");
      }
      tsTypeToProtoFieldDescription(d, checker, definedType, fieldName, path, fieldNumber);
      return;
    }
    // If all the types are ObjectLiteral - do we want to use that type, or make an enum?  Do we want to do oneOf for the others?
    throw new Error("Union types are currently not fully supported.");
  }
  if (type.flags & ts.TypeFlags.Object) {
    // Need to turn nested objects in interface to protos as well
    const symbol = type.getSymbol();
    assert(symbol);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (symbol.escapedName === "Array") {
      const typeArgs = (type as ts.TypeReference).typeArguments;
      assert(typeArgs);
      const innerType = typeArgs[0];
      tsTypeToProtoFieldDescription(d, checker, innerType, fieldName, path, fieldNumber);
      d.field[d.field.length - 1].label = 3; // repeated
      return;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    } else if (symbol.escapedName === "Date") {
      fd.type = "TYPE_INT32"; // TODO dates are stupid
      d.field.push(FieldDescriptorProto.fromJson(fd));
      return;
    } else {
      const symbol = type.getSymbol();
      assert(symbol);
      fd.type = "TYPE_MESSAGE";
      fd.typeName = path + "." + fieldName.messageName(); // TODO need to differentiate between embedded and referenced stuff
      d.field.push(FieldDescriptorProto.fromJson(fd));
      d.nestedType.push(symbolToDescriptorProto(symbol, checker, fieldName.messageName(), path));
      return;
    }
  }
  throw new Error(`Unsupported TypeScript type: ${type.flags} - ${checker.typeToString(type)}`);
}

export function sourceFileToJson(sourceFile: ts.SourceFile, program: ts.Program) {
  const namespace = path.basename(sourceFile.fileName, path.extname(sourceFile.fileName));
  const configs: { static_feature: LekkoConfigJSON }[] = [];
  const tsInstance = ts;
  const checker = program.getTypeChecker();
  const fds = new FileDescriptorProto({
    package: `lekko.${namespace}`,
    // TODO
  });

  function visit(node: ts.Node): ts.Node | ts.Node[] | undefined {
    if (tsInstance.isSourceFile(node)) {
      const match = node.fileName.match(LEKKO_FILENAME_REGEX);
      if (match) {
        tsInstance.visitEachChild(node, visit, undefined);
      }
    } else if (tsInstance.isFunctionDeclaration(node)) {
      const { checkedNode, configName, returnType } = checkConfigFunctionDeclaration(tsInstance, checker, node);
      // Apply changes to config repo
      const configJSON = functionToConfigJSON(checkedNode, checker, namespace, configName, returnType);
      fds.messageType.push(functionToDescriptor(checkedNode, checker));
      configs.push({ static_feature: configJSON });
    } else if (tsInstance.isInterfaceDeclaration(node)) {
      fds.messageType.push(interfaceToDescriptorProto(namespace, node, checker));
    }
    return undefined;
  }

  tsInstance.visitNode(sourceFile, visit);

  return { name: namespace, configs, file_descriptor_set: fds };
}
