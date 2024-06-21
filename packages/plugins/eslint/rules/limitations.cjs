module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Lekko Native Language Limitations",
      category: "Best Practices",
      recommended: true,
    },
    fixable: "code",
    schema: [],
  },
  create(context) {
    return {
      "FunctionDeclaration[id.name=/^(?!get[A-Za-z0-9]+$)/]": function (node) {
        context.report(node, "Function names must be like 'getConfigName'.");
      },
      "IfStatement[consequent.type!=BlockStatement]": function (node) {
        context.report({
          node,
          message: "Must include {} after if.",
          fix(fixer) {
            const sourceCode = context.getSourceCode();
            const consequent = node.consequent;
            const consequentText = sourceCode.getText(consequent);
            const fixedText = `{ ${consequentText} }`;
            return fixer.replaceText(consequent, fixedText);
          },
        });
      },
      "IfStatement > BlockStatement > :not(ReturnStatement)": function (node) {
        context.report(
          node,
          "If statements may only contain return statements.",
        );
      },
      'BinaryExpression[left.type!="Identifier"][left.type!="BinaryExpression"][right.type!="Literal"][right.type!="BinaryExpression"]':
        function (node) {
          context.report(
            node,
            "Literals must be on the right side of binary expressions.",
          );
        },
      'BinaryExpression[right.type="Identifier"]': function (node) {
        const oppositeOperators = {
          "===": "===",
          "!==": "!==",
          "==": "==",
          "!=": "!=",
          "<": ">=",
          ">": "<=",
          "<=": ">",
          ">=": "<",
        };
        context.report({
          node,
          message: "Identifiers can't be on the right side.",
          fix(fixer) {
            if (node.left.type !== "Identifier") {
              const sourceCode = context.getSourceCode();
              const leftText = sourceCode.getText(node.left);
              const rightText = sourceCode.getText(node.right);
              const operator = node.operator;
              const oppositeOperator = oppositeOperators[operator] || operator;
              const fixedText = `${rightText} ${oppositeOperator} ${leftText}`;

              return fixer.replaceText(node, fixedText);
            }
          },
        });
      },
      "FunctionDeclaration > BlockStatement > :not(:matches(IfStatement,  ReturnStatement))":
        function (node) {
          context.report(
            node,
            "Only if and return statements are allowed inside config functions.",
          );
        },
      ":not(ExportNamedDeclaration) > FunctionDeclaration": function (node) {
        context.report({
          node,
          message: "Functions must be exported.",
          fix(fixer) {
            const sourceCode = context.getSourceCode();
            const functionToken = sourceCode.getFirstToken(node);
            return fixer.insertTextBefore(functionToken, "export ");
          },
        });
      },
      "FunctionDeclaration[async=true]": function (node) {
        context.report({
          node,
          message: "Functions must not be async.",
          fix(fixer) {
            const sourceCode = context.getSourceCode();
            const asyncToken = sourceCode.getFirstToken(node, {
              filter: (token) => token.value === "async",
            });
            return fixer.remove(asyncToken);
          },
        });
      },
      'Program > :not(ExportNamedDeclaration[declaration.type="FunctionDeclaration"], ExportNamedDeclaration[declaration.type="TSInterfaceDeclaration"])':
        function (node) {
          context.report(
            node,
            "Invalid top level node: only exported function declarations and interfaces are supported.",
          );
        },
      "FunctionDeclaration:not([returnType])": function (node) {
        context.report(node, "Functions must explicitly specify return types.");
      },
      "FunctionDeclaration[params.length>1]": function (node) {
        context.report(
          node,
          "Functions' parameters must be empty or a single object literal.",
        );
      },
      "FunctionDeclaration > .params > .typeAnnotation > .typeAnnotation > TSPropertySignature > .typeAnnotation > .typeAnnotation:not(:matches(TSBooleanKeyword, TSStringKeyword, TSNumberKeyword))":
        function (node) {
          context.report(
            node,
            "Only concrete primitive types are supported for context variables.",
          );
        },
    };
  },
};
