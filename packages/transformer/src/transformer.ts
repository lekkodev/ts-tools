import path from "path";
import { type TransformerExtras } from "ts-patch";
import ts from "typescript";
import { type LekkoTransformerOptions } from "./types";
import { type CheckedFunctionDeclaration, LEKKO_FILENAME_REGEX, assertIsCheckedFunctionDeclaration } from "./helpers";
import kebabCase from "lodash.kebabcase";
import { LekkoParseError } from "./errors";

const CTX_IDENTIFIER_NAME = "_ctx";
const EXCEPTION_IDENTIFIER_NAME = "e";
const CLIENT_IDENTIFIER_NAME = "_client";

export function checkConfigFunctionDeclaration(
  tsInstance: typeof ts,
  checker: ts.TypeChecker,
  node: ts.FunctionDeclaration,
): {
  checkedNode: CheckedFunctionDeclaration;
  configName: string;
  returnType: ts.Type;
} {
  assertIsCheckedFunctionDeclaration(node);
  // Check name
  const functionName = node.name.getFullText().trim();
  if (!/^\s*get[A-Z][A-Za-z]*$/.test(functionName)) {
    throw new LekkoParseError(`Unparsable function name "${functionName}": lekko function names must start with "get"`, node);
  }
  const configName = kebabCase(functionName.substring(3));
  // Check return type
  if (tsInstance.isAsyncFunction(node)) {
    throw new LekkoParseError("Lekko functions must not be async", node);
  }
  const returnType = checker.getTypeFromTypeNode(node.type);
  if (returnType.getSymbol()?.escapedName?.toString() === "Array") {
    throw new LekkoParseError("Array return types are currently not supported", node);
  }

  return { checkedNode: node, configName, returnType };
}

export function transformer(program: ts.Program, pluginConfig?: LekkoTransformerOptions, extras?: TransformerExtras) {
  const tsInstance = extras?.ts ?? ts;

  const checker = program.getTypeChecker();

  return (context: ts.TransformationContext) => {
    const { factory } = context;

    function transformLocalToRemote(node: CheckedFunctionDeclaration, namespace: string, configName: string): ts.Node | ts.Node[] {
      return [
        factory.updateFunctionDeclaration(
          node,
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              CTX_IDENTIFIER_NAME,
              factory.createToken(tsInstance.SyntaxKind.QuestionToken),
              undefined,
              undefined,
            ),
            // Pass client as second parameter (in body, also try to get global client)
            factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier(CLIENT_IDENTIFIER_NAME), undefined, undefined, undefined),
          ],
          node.type,
          wrapTryCatch(
            factory.createBlock(
              [
                factory.createReturnStatement(
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(factory.createIdentifier("lekko"), factory.createIdentifier("get")),
                    undefined,
                    [
                      factory.createStringLiteral(namespace),
                      factory.createStringLiteral(configName),
                      factory.createIdentifier(CTX_IDENTIFIER_NAME),
                      factory.createIdentifier(CLIENT_IDENTIFIER_NAME),
                    ],
                  ),
                ),
              ],
              true,
            ),
            addDebugLogs(namespace, configName, prependParamVars(node, CTX_IDENTIFIER_NAME, node.body)),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(node.name, factory.createIdentifier("_namespaceName")),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(namespace),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(node.name, factory.createIdentifier("_configName")),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(configName),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(node.name, factory.createIdentifier("_evaluationType")),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            // FIXME: this was always incorrect but only used for certain error logs in the React SDK.
            // We should be able to remove it fully eventually now that we have built-in debug logs.
            factory.createStringLiteral(""),
          ),
        ),
      ];
    }

    function addDebugLogs(ns: string, name: string, block: ts.Block): ts.Block {
      const statements: ts.Statement[] = [
        factory.createIfStatement(
          factory.createPrefixUnaryExpression(
            ts.SyntaxKind.ExclamationToken,
            factory.createParenthesizedExpression(
              factory.createBinaryExpression(
                factory.createIdentifier(EXCEPTION_IDENTIFIER_NAME),
                factory.createToken(ts.SyntaxKind.InstanceOfKeyword),
                factory.createPropertyAccessExpression(factory.createIdentifier("lekko"), factory.createIdentifier("ClientNotInitializedError")),
              ),
            ),
          ),
          factory.createBlock(
            [
              factory.createExpressionStatement(
                factory.createCallExpression(
                  factory.createPropertyAccessExpression(factory.createIdentifier("lekko"), factory.createIdentifier("logError")),
                  undefined,
                  [factory.createStringLiteral(`[lekko] Failed to evaluate ${ns}/${name}: `), factory.createIdentifier(EXCEPTION_IDENTIFIER_NAME)],
                ),
              ),
            ],
            true,
          ),
        ),
        factory.createExpressionStatement(
          factory.createCallExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("lekko"), factory.createIdentifier("logInfo")),
            undefined,
            [factory.createStringLiteral(`[lekko] Using in-code fallback for ${ns}/${name}.`)],
          ),
        ),
      ];
      statements.push(...block.statements);
      return factory.createBlock(statements);
    }

    // Prepend the given body with a variable assignment to make the function's parameters available
    // in the body. No-op if there was no parameter to start.
    // i.e. adds `_ctx ??= {}; const { env } = _ctx ?? {}` to start
    function prependParamVars(fd: ts.FunctionDeclaration, newParamName: string, body: ts.Block): ts.Block {
      const statements: ts.Statement[] = [
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createIdentifier(newParamName),
            factory.createToken(tsInstance.SyntaxKind.QuestionQuestionEqualsToken),
            factory.createObjectLiteralExpression(),
          ),
        ),
      ];
      // Get original first parameter to function
      const param = fd.parameters[0]?.getChildAt(0); // GetChild for discarding type info
      if (param !== undefined) {
        statements.push(
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
              factory.createVariableDeclaration(
                // This is technically probably not a good way to destructure
                param.getFullText(),
                undefined,
                undefined,
                factory.createIdentifier(newParamName),
              ),
            ]),
          ),
        );
      }
      statements.push(...body.statements);
      return factory.createBlock(statements);
    }

    // Use for handling static fallback
    function wrapTryCatch(tryBlock: ts.Block, catchBlock: ts.Block): ts.Block {
      return factory.createBlock([
        factory.createTryStatement(
          tryBlock,
          factory.createCatchClause(
            factory.createVariableDeclaration(factory.createIdentifier(EXCEPTION_IDENTIFIER_NAME), undefined, undefined, undefined),
            catchBlock,
          ),
          undefined,
        ),
      ]);
    }

    // e.g. import * as lekko from "@lekko/js-sdk"
    function addLekkoImports(sourceFile: ts.SourceFile): ts.SourceFile {
      return factory.updateSourceFile(sourceFile, [
        factory.createImportDeclaration(
          undefined,
          factory.createImportClause(false, undefined, factory.createNamespaceImport(factory.createIdentifier("lekko"))),
          factory.createStringLiteral("@lekko/js-sdk"),
          undefined,
        ),
        ...sourceFile.statements,
      ]);
    }

    return (sourceFile: ts.SourceFile): ts.SourceFile => {
      const namespace = path.basename(sourceFile.path, path.extname(sourceFile.path));

      function visit(node: ts.Node): ts.Node | ts.Node[] | undefined {
        if (tsInstance.isSourceFile(node)) {
          const match = node.fileName.match(LEKKO_FILENAME_REGEX);
          if (match) {
            let transformed = addLekkoImports(node);
            transformed = tsInstance.visitEachChild(transformed, visit, context);
            return transformed;
          } else {
            return node;
          }
        } else if (tsInstance.isFunctionDeclaration(node)) {
          const { checkedNode, configName } = checkConfigFunctionDeclaration(tsInstance, checker, node);
          // Transform local (static) to SDK client calls
          return transformLocalToRemote(checkedNode, namespace, configName);
        }
        return node;
      }
      const visited = tsInstance.visitNode(sourceFile, visit) as ts.SourceFile;

      if (pluginConfig?.verbose) {
        const printer = tsInstance.createPrinter();
        console.log("-".repeat(12 + sourceFile.fileName.length));
        console.log(`Transformed ${sourceFile.fileName}:`);
        console.log("-".repeat(12 + sourceFile.fileName.length));
        console.log(printer.printFile(visited));
        console.log("-".repeat(12 + sourceFile.fileName.length));
      }

      return visited;
    };
  };
}
