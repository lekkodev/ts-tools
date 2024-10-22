import snakeCase from "lodash.snakecase";
import kebabCase from "lodash.kebabcase";
import ts from "typescript";
import { LekkoParseError } from "./errors";
import type { JSONObject, JSONValue, SupportedExpressionName } from "./types";
import { type CheckedFunctionDeclaration, isIntrinsicType } from "./helpers";
import {
  Any as GoogleAny,
  FieldDescriptorProto,
  FileDescriptorProto,
  DescriptorProto,
  FieldDescriptorProto_Type,
  FieldDescriptorProto_Label,
  type FileDescriptorSet,
  BoolValue,
  type Message,
  type IMessageTypeRegistry,
  StringValue,
  DoubleValue,
  type MessageType,
  type PartialMessage,
  type AnyMessage,
  Value as DynamicValue,
  ListValue,
} from "@bufbuild/protobuf";
import { Any, Constraint, Feature, FeatureType } from "./gen/lekko/feature/v1beta1/feature_pb";
import * as rules from "./gen/lekko/rules/v1beta3/rules_pb";

const COMPARISON_TOKEN_TO_OPERATOR: Partial<Record<ts.SyntaxKind, rules.ComparisonOperator>> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: rules.ComparisonOperator.EQUALS,
  [ts.SyntaxKind.LessThanToken]: rules.ComparisonOperator.LESS_THAN,
  [ts.SyntaxKind.LessThanEqualsToken]: rules.ComparisonOperator.LESS_THAN_OR_EQUALS,
  [ts.SyntaxKind.GreaterThanToken]: rules.ComparisonOperator.GREATER_THAN,
  [ts.SyntaxKind.GreaterThanEqualsToken]: rules.ComparisonOperator.GREATER_THAN_OR_EQUALS,
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: rules.ComparisonOperator.NOT_EQUALS,
};

const LOGICAL_TOKEN_TO_OPERATOR: Partial<Record<ts.SyntaxKind, rules.LogicalOperator>> = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: rules.LogicalOperator.AND,
  [ts.SyntaxKind.BarBarToken]: rules.LogicalOperator.OR,
};

const EXPRESSION_NAME_TO_OPERATOR: Partial<Record<SupportedExpressionName, rules.ComparisonOperator>> = {
  includes: rules.ComparisonOperator.CONTAINS,
  startsWith: rules.ComparisonOperator.STARTS_WITH,
  endsWith: rules.ComparisonOperator.ENDS_WITH,
};

function exprToContextKey(expr: ts.Expression): string {
  switch (expr.kind) {
    case ts.SyntaxKind.Identifier:
      return snakeCase(expr.getText());
    case ts.SyntaxKind.PropertyAccessExpression:
      return snakeCase((expr as ts.PropertyAccessExpression).name.getText());
    default:
      throw new LekkoParseError(`Unsupported expression kind: ${ts.SyntaxKind[expr.kind]}`, expr);
  }
}

function matchBooleanIdentifier(checker: ts.TypeChecker, ident: ts.Identifier, value: boolean): rules.Rule | undefined {
  const identType = checker.getTypeAtLocation(ident);
  if (identType.flags & ts.TypeFlags.Boolean) {
    return new rules.Rule({
      rule: {
        case: "atom",
        value: new rules.Atom({
          contextKey: exprToContextKey(ident),
          comparisonOperator: rules.ComparisonOperator.EQUALS,
          comparisonValue: new DynamicValue({
            kind: {
              case: "boolValue",
              value,
            },
          }),
        }),
      },
    });
  }
  return undefined;
}

function expressionToRule(checker: ts.TypeChecker, expression: ts.Expression): rules.Rule {
  switch (expression.kind) {
    // Handle boolean literal condition (e.g. if (true))
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
          return new rules.Rule({
            rule: {
              case: "not",
              value: expressionToRule(checker, prefixExpr.operand),
            },
          });
        }
      }
      throw new LekkoParseError("Unsupported PrefixUnaryExpression", expression);
    }
    case ts.SyntaxKind.BinaryExpression: {
      const binaryExpr = expression as ts.BinaryExpression;
      const tokenKind = binaryExpr.operatorToken.kind;

      if (tokenKind === ts.SyntaxKind.ExclamationEqualsEqualsToken && binaryExpr.right.getText() === "undefined") {
        return new rules.Rule({
          rule: {
            case: "atom",
            value: new rules.Atom({
              contextKey: exprToContextKey(binaryExpr.left),
              comparisonOperator: rules.ComparisonOperator.PRESENT,
            }),
          },
        });
      } else if (tokenKind in COMPARISON_TOKEN_TO_OPERATOR) {
        const value = expressionToJsonValue(binaryExpr.right);
        let comparisonValue: DynamicValue | undefined;
        switch (typeof value) {
          case "boolean": {
            comparisonValue = new DynamicValue({ kind: { case: "boolValue", value } });
            break;
          }
          case "string": {
            comparisonValue = new DynamicValue({ kind: { case: "stringValue", value } });
            break;
          }
          case "number": {
            comparisonValue = new DynamicValue({ kind: { case: "numberValue", value } });
            break;
          }
          default: {
            throw new LekkoParseError(`Unexpected type ${typeof value} for comparison value`, binaryExpr.right);
          }
        }
        return new rules.Rule({
          rule: {
            case: "atom",
            value: new rules.Atom({
              contextKey: exprToContextKey(binaryExpr.left),
              comparisonValue,
              comparisonOperator: COMPARISON_TOKEN_TO_OPERATOR[tokenKind]!,
            }),
          },
        });
      } else if (tokenKind in LOGICAL_TOKEN_TO_OPERATOR) {
        let children: rules.Rule[] = [];
        const left = expressionToRule(checker, binaryExpr.left);
        // If possible, flatten to n-ary rather than only nesting
        if (left.rule.case === "logicalExpression" && left.rule.value.logicalOperator === LOGICAL_TOKEN_TO_OPERATOR[tokenKind]) {
          children = children.concat(left.rule.value.rules);
        } else {
          children.push(left);
        }
        const right = expressionToRule(checker, binaryExpr.right);
        if (right.rule.case === "logicalExpression" && right.rule.value.logicalOperator === LOGICAL_TOKEN_TO_OPERATOR[tokenKind]) {
          children = children.concat(right.rule.value.rules);
        } else {
          children.push(right);
        }

        return new rules.Rule({
          rule: {
            case: "logicalExpression",
            value: new rules.LogicalExpression({
              rules: children,
              logicalOperator: LOGICAL_TOKEN_TO_OPERATOR[tokenKind],
            }),
          },
        });
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

        if (callExpr.arguments.length !== 1) {
          throw new LekkoParseError("Only one argument supported for call expression", callExpr);
        }

        // e.g. [1, 2, 3].includes(ctxKey)
        if (expressionName === "includes" && ts.isArrayLiteralExpression(propertyAccessExpr.expression)) {
          const contextKey = exprToContextKey(callExpr.arguments[0]);

          return new rules.Rule({
            rule: {
              case: "atom",
              value: new rules.Atom({
                contextKey,
                comparisonValue: expressionToDynamicValue(propertyAccessExpr.expression),
                comparisonOperator: rules.ComparisonOperator.CONTAINED_WITHIN,
              }),
            },
          });
        }

        const comparisonOperator = EXPRESSION_NAME_TO_OPERATOR[expressionName];
        const callArg = callExpr.arguments[0];
        if (comparisonOperator !== undefined) {
          return new rules.Rule({
            rule: {
              case: "atom",
              value: new rules.Atom({
                contextKey: exprToContextKey(propertyAccessExpr.expression),
                comparisonValue: expressionToDynamicValue(callArg),
                comparisonOperator,
              }),
            },
          });
        }
      }
      throw new LekkoParseError(`Call expression ${propertyAccessExpr.getText()} is currently not supported`, propertyAccessExpr);
    }
    // TODO other literal types
    default: {
      throw new LekkoParseError(`Unsupported syntax kind ${ts.SyntaxKind[expression.kind]}`, expression);
    }
  }
}

/**
 * Translates an if statement to a list of constraints.
 * In TS, if statemenets are structured recursively where an else statement might not exist, be a regular block, or be another if statement (i.e. else if).
 */
function ifStatementToConstraints(
  checker: ts.TypeChecker,
  ifStatement: ts.IfStatement,
  namespace: string,
  returnType: string,
  typeRegistry: IMessageTypeRegistry,
): Constraint[] {
  const block = ifStatement.thenStatement as ts.Block;
  // TODO: handle nested if statements here
  if (block.statements.length !== 1 || block.statements[0].kind !== ts.SyntaxKind.ReturnStatement) {
    throw new LekkoParseError("Then statement must only contain return statement", block);
  }

  const [value, valueNew] = returnStatementToValue(block.statements[0] as ts.ReturnStatement, namespace, returnType, typeRegistry);
  const ret = [
    new Constraint({
      ruleAstNew: expressionToRule(checker, ifStatement.expression),
      value,
      valueNew,
      // TODO: handle if comments here
    }),
  ];

  if (ifStatement.elseStatement !== undefined) {
    if (ifStatement.elseStatement.kind === ts.SyntaxKind.IfStatement) {
      ret.push(...ifStatementToConstraints(checker, ifStatement.elseStatement as ts.IfStatement, namespace, returnType, typeRegistry));
    } else if (ifStatement.elseStatement.kind === ts.SyntaxKind.Block) {
      throw new LekkoParseError("Unnecessary else statement", ifStatement.elseStatement);
    } else {
      throw new LekkoParseError(`Invalid else statement kind ${ts.SyntaxKind[ifStatement.elseStatement.kind]}`, ifStatement.elseStatement);
    }
  }

  return ret;
}

/**
 * Returns both Google's Any and Lekko's Any representations.
 */
function returnStatementToValue(returnNode: ts.ReturnStatement, namespace: string, returnType: string, typeRegistry: IMessageTypeRegistry): [GoogleAny, Any] {
  const expression = returnNode.expression;
  if (expression === undefined) {
    throw new LekkoParseError("Missing expression for return statement", returnNode);
  }
  return expressionToProtoValue(expression, namespace, returnType, typeRegistry);
}

function expressionToJsonValue(expression: ts.Expression): JSONValue {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  } else if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  } else if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  } else if (ts.isNumericLiteral(expression)) {
    return new Number(expression.text).valueOf();
  } else if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand)) {
    return -1 * new Number(expression.operand.text).valueOf();
  } else if (ts.isArrayLiteralExpression(expression)) {
    if (expression.elements.length === 0) {
      return [];
    }
    const ret = [];
    // For convenience, add check to make sure array elements have the same type here
    // We don't have any places where we allow multi-type arrays
    // TODO: Revisit once support for arrays of objects is needed
    for (const elem of expression.elements) {
      const value = expressionToJsonValue(elem);
      if (ret.length >= 1) {
        if (typeof ret[ret.length - 1] !== typeof value) {
          throw new LekkoParseError("Array elements must have the same type", expression);
        }
      }
      ret.push(value);
    }
    return ret;
  } else if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.reduce((agg, prop) => {
      if (!ts.isPropertyAssignment(prop)) {
        throw new LekkoParseError(`Only property assignments are supported, got ${ts.SyntaxKind[prop.kind]}`, prop);
      }
      if (prop.name === undefined || !ts.isIdentifier(prop.name)) {
        throw new LekkoParseError("Unsupported syntax for object literal key", prop);
      }
      agg[prop.name.text] = expressionToJsonValue(prop.initializer);
      return agg;
    }, {} as JSONObject);
  }
  throw new LekkoParseError(`Unsupported value expression ${ts.SyntaxKind[expression.kind]}`, expression);
}

function getAnyFromGoogleAny(ga: GoogleAny): Any {
  return new Any({
    typeUrl: ga.typeUrl,
    value: ga.value,
  });
}

/**
 * Returns both Google's Any and Lekko's Any representations.
 */
function expressionToProtoValue(expression: ts.Expression, namespace: string, protoType: string, typeRegistry: IMessageTypeRegistry): [GoogleAny, Any] {
  let value: Message;
  switch (expression.kind) {
    case ts.SyntaxKind.FalseKeyword: {
      value = new BoolValue({ value: false });
      break;
    }
    case ts.SyntaxKind.TrueKeyword: {
      value = new BoolValue({ value: true });
      break;
    }
    case ts.SyntaxKind.StringLiteral: {
      value = new StringValue({ value: expressionToJsonValue(expression) as string });
      break;
    }
    case ts.SyntaxKind.NumericLiteral: {
      value = new DoubleValue({ value: new Number(expression.getText()).valueOf() });
      break;
    }
    case ts.SyntaxKind.ObjectLiteralExpression: {
      value = objectLiteralExpressionToMessage(expression as ts.ObjectLiteralExpression, namespace, protoType, typeRegistry);
      break;
    }
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const pue = expression as ts.PrefixUnaryExpression;
      // Handle negative numbers like -1
      if (pue.operator === ts.SyntaxKind.MinusToken) {
        const [gAny] = expressionToProtoValue(pue.operand, namespace, protoType, typeRegistry);
        if (!gAny.is(DoubleValue)) {
          throw new LekkoParseError(`unsupported operand for minus prefix`, pue.operand);
        }
        const dv = new DoubleValue();
        gAny.unpackTo(dv);
        dv.value = dv.value * -1;
        value = dv;
      } else {
        throw new LekkoParseError(`unsupported prefix operator: ${ts.SyntaxKind[pue.operator]}`, expression);
      }
      break;
    }
    case ts.SyntaxKind.CallExpression: {
      const callExpr = expression as ts.CallExpression;
      const functionName = callExpr.expression.getText();
      const configName = kebabCase(functionName.substring(3));
      value = rules.ConfigCall.fromJson({ key: configName });
      break;
    }
    case ts.SyntaxKind.PropertyAccessExpression: {
      const propertyAccessExpression = expression as ts.PropertyAccessExpression;
      if (!ts.isCallExpression(propertyAccessExpression.expression)) {
        throw new LekkoParseError(`Do not know how to parse: `, expression);
      }
      const callExpr = propertyAccessExpression.expression;
      const fieldName = snakeCase(propertyAccessExpression.name.text);
      const functionName = callExpr.expression.getText();
      const configName = kebabCase(functionName.substring(3));
      value = rules.ConfigCall.fromJson({ key: configName, fieldName: fieldName });
      break;
    }
    default:
      throw new LekkoParseError(`Unsupported syntax: ${ts.SyntaxKind[expression.kind]}`, expression);
  }
  const gAny = GoogleAny.pack(value);
  return [gAny, getAnyFromGoogleAny(gAny)];
}

/**
 * Translates an object literal to a Message.
 * Assumes the type of the Message is <namespace>.config.v1beta1.<typeName> which is a reasonable default for now.
 * Currently does not support nested types or type references.
 */
function objectLiteralExpressionToMessage(
  expression: ts.ObjectLiteralExpression,
  namespace: string,
  typeName: string,
  typeRegistry: IMessageTypeRegistry,
): Message {
  let messageType: MessageType | undefined;
  try {
    messageType = typeRegistry.findMessage(`${namespace}.config.v1beta1.${typeName}`);
  } catch (e) {
    if (e instanceof Error) {
      throw new LekkoParseError(`Failed to look up type: ${e.message}`, expression);
    }
  }
  if (messageType === undefined) {
    throw new LekkoParseError(`Type ${typeName} not found in registry`, expression);
  }
  // TODO: Actually parse object's fields instead of eval()-ing
  try {
    return new messageType(expressionToJsonValue(expression) as PartialMessage<AnyMessage>);
  } catch (e) {
    if (e instanceof Error) {
      throw new LekkoParseError(`Failed to construct object of type ${typeName}: ${e.message}`, expression);
    } else {
      throw e;
    }
  }
}

/**
 * Translates an expression to a google.protobuf.Value.
 */
function expressionToDynamicValue(expr: ts.Expression): DynamicValue {
  if (ts.isArrayLiteralExpression(expr)) {
    return new DynamicValue({
      kind: {
        case: "listValue",
        value: new ListValue({
          values: expr.elements.map(expressionToDynamicValue),
        }),
      },
    });
  }
  const value = expressionToJsonValue(expr);
  switch (typeof value) {
    case "boolean": {
      return new DynamicValue({ kind: { case: "boolValue", value } });
    }
    case "string": {
      return new DynamicValue({ kind: { case: "stringValue", value } });
    }
    case "number": {
      return new DynamicValue({ kind: { case: "numberValue", value } });
    }
    default: {
      throw new LekkoParseError(`Unexpected type ${typeof value} for parsed expression`, expr);
    }
  }
}

function getLekkoType(node: ts.Node, returnType: ts.Type, checker: ts.TypeChecker): FeatureType {
  if (returnType.flags & ts.TypeFlags.Boolean) {
    return FeatureType.BOOL;
  }
  if (returnType.flags & ts.TypeFlags.Number) {
    return FeatureType.FLOAT;
  }
  if (returnType.flags & ts.TypeFlags.String) {
    return FeatureType.STRING;
  }
  if (returnType.flags & ts.TypeFlags.Object) {
    return FeatureType.PROTO;
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
  throw new LekkoParseError("JSDoc links are not supported in lekko descriptions", node);
}

/**
 * Translates a lekko function declaration into its canonical proto Feature represenation.
 */
export function functionToProto(
  node: CheckedFunctionDeclaration,
  checker: ts.TypeChecker,
  namespace: string,
  configKey: string,
  returnType: ts.Type,
  typeRegistry: IMessageTypeRegistry,
): Feature {
  let valueType: string;
  if (isIntrinsicType(returnType)) {
    // This is how we check for boolean/number/string
    valueType = returnType.intrinsicName;
  } else {
    valueType = checker.typeToString(returnType, undefined, ts.TypeFormatFlags.None);
  }

  let treeDefault: GoogleAny | undefined;
  let treeDefaultNew: Any | undefined;
  let treeConstraints: Constraint[] | undefined;

  for (const [_, statement] of node.body.statements.entries()) {
    switch (statement.kind) {
      case ts.SyntaxKind.IfStatement: {
        treeConstraints = ifStatementToConstraints(checker, statement as ts.IfStatement, namespace, valueType, typeRegistry);
        break;
      }
      case ts.SyntaxKind.ReturnStatement: {
        [treeDefault, treeDefaultNew] = returnStatementToValue(statement as ts.ReturnStatement, namespace, valueType, typeRegistry);
        break;
      }
      default: {
        throw new LekkoParseError(`Unexpected statement kind ${ts.SyntaxKind[statement.kind]}, only if and return statements are supported`, statement);
      }
    }
  }

  if (treeDefault === undefined) {
    throw new LekkoParseError("Missing default return value", node.body);
  }

  return new Feature({
    key: configKey,
    description: getDescription(node) ?? "",
    tree: {
      default: treeDefault,
      defaultNew: treeDefaultNew,
      constraints: treeConstraints,
    },
    type: getLekkoType(node, returnType, checker),
  });
}

/**
 * Adds the message descriptor to the corresponding namespace file descriptor in the FDS.
 */
export function registerMessage(fds: FileDescriptorSet, namespace: string, md: DescriptorProto) {
  const filePath = `${namespace}/config/v1beta1/${namespace}.proto`;
  // Try to find existing file descriptor
  let fd = fds.file.find((fd) => fd.name === filePath);
  if (fd === undefined) {
    // Create new if necessary
    fd = new FileDescriptorProto({
      syntax: "proto3",
      name: filePath,
      package: `${namespace}.config.v1beta1`,
    });
    fds.file.push(fd);
  }
  // Add message descriptor, checking for duplicates
  if (fd.messageType.find((existing) => existing.name === md.name) !== undefined) {
    throw new Error(`Duplicate registration of message ${md.name}`);
  } else {
    fd.messageType.push(md);
  }
  // TODO: add message dependencies to file descriptor
}

export function interfaceToMessageDescriptor(node: ts.InterfaceDeclaration): DescriptorProto {
  const name = node.name.getText();
  const md = new DescriptorProto({ name });
  node.members.forEach((member, idx) => {
    if (ts.isPropertySignature(member)) {
      md.field.push(propertySignatureToFieldDescriptor(member, idx + 1));
    } else {
      throw new LekkoParseError(`Unsupported member type: ${ts.SyntaxKind[member.kind]} - ${member.getFullText()}`, member);
    }
  });
  return md;
}

/**
 * Does not currently handle nested types, type references, or maps.
 */
function propertySignatureToFieldDescriptor(ps: ts.PropertySignature, number: number): FieldDescriptorProto {
  if (ps.type === undefined) {
    throw new LekkoParseError("Missing type signature", ps);
  }
  if (ps.questionToken === undefined) {
    throw new LekkoParseError("Interface fields must be marked as optional using a question token", ps);
  }
  const fd = new FieldDescriptorProto({ name: snakeCase(ps.name.getText()), number });

  function primitiveTypeToFieldDescriptorType(typeNode: ts.TypeNode): FieldDescriptorProto_Type | undefined {
    switch (typeNode.kind) {
      case ts.SyntaxKind.BooleanKeyword: {
        return FieldDescriptorProto_Type.BOOL;
      }
      case ts.SyntaxKind.StringKeyword: {
        return FieldDescriptorProto_Type.STRING;
      }
      case ts.SyntaxKind.NumberKeyword: {
        return FieldDescriptorProto_Type.DOUBLE;
      }
      // TODO: int fields
      default: {
        return undefined;
      }
    }
  }
  // If array type, treat and parse as repeated
  if (ps.type.kind === ts.SyntaxKind.ArrayType) {
    const fdt = primitiveTypeToFieldDescriptorType((ps.type as ts.ArrayTypeNode).elementType);
    if (fdt === undefined) {
      throw new LekkoParseError("Unsupported array element type", ps.type);
    }
    fd.label = FieldDescriptorProto_Label.REPEATED;
    fd.type = fdt;
    return fd;
  }
  // TODO: type references to other types
  const fdt = primitiveTypeToFieldDescriptorType(ps.type);
  if (fdt === undefined) {
    throw new LekkoParseError(`Unsupported field type ${ts.SyntaxKind[ps.type.kind]}`, ps.type);
  }
  fd.type = fdt;
  return fd;
}
