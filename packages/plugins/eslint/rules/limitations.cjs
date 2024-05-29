module.exports = {
  create(context) {
    return {
      "FunctionDeclaration[id] > Identifier[name=/^(?!get[A-Za-z0-9]+$)/]":
        function (node) {
          context.report(node, "Function names must be like 'getConfigName'.");
        },
      "IfStatement[consequent.type!=BlockStatement]": function (node) {
        context.report(node, "Must include {} after if.");
      },
      "IfStatement > BlockStatement > :not(ReturnStatement)": function (node) {
        context.report(
          node,
          "If statements may only contain return statements.",
        );
      },
      'BinaryExpression[left.type!="Identifier"][left.type!="BinaryExpression"][right.type!="Literal"][right.type!="BinaryExpression"]':
        function (node) {
          context.report({
            node,
            message: "Literals must be on the right side of binary expressions.",
            fix(fixer) {
              console.log(node);
              console.log([node.right.name, node.operator, node.left.raw].join(" "))
              console.log(fixer.replaceText(node, [node.right.name, node.operator, node.left.raw].join(" ")));
              fixer.replaceText(node, [node.right.name, node.operator, node.left.raw].join(" "))
            }
          });
        },
      "FunctionDeclaration > BlockStatement > :not(:matches(IfStatement,  ReturnStatement))":
        function (node) {
          context.report({
            node,
            message: "Only if and return statements are allowed inside config functions.",
            fix(fixer) {
            }
          });
        },
      ":not(ExportNamedDeclaration) > FunctionDeclaration": function (node) {
        context.report(node, "Functions must be exported.");
      },
      "FunctionDeclaration[async=true]": function (node) {
        context.report(node, "Functions must not be async.");
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
    };
  },
};
