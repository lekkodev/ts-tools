module.exports = {
  create(context) {
    return {
      "FunctionDeclaration[id] > Identifier[name=/^(?!get[A-Za-z0-9]+$)/]":
        function (node) {
          context.report(node, "function names must be like: getFlagName");
        },
      "IfStatement[consequent.type!=BlockStatement]": function (node) {
        context.report(node, "Must include {} after if");
      },
      "IfStatement > BlockStatement > :not(ReturnStatement)": function (node) {
        context.report(
          node,
          "If statements may only contain return statements",
        );
      },
      'BinaryExpression[left.type!="Identifier"][left.type!="BinaryExpression"][right.type!="Literal"][right.type!="BinaryExpression"]':
        function (node) {
          context.report(node, "Please follow if statement formatting rules");
        },
      "FunctionDeclaration > BlockStatement > :not(:matches(IfStatement,  ReturnStatement))":
        function (node) {
          context.report(
            node,
            "Only if and return statements inside of functions",
          );
        },
      ":not(ExportNamedDeclaration) > FunctionDeclaration": function (node) {
        context.report(node, "Only top level, exported functions allowed");
      },
      "FunctionDeclaration[async!=true]": function (node) {
        context.report(node, "functions must be async");
      },
      "Program > :not(ExportNamedDeclaration)": function (node) {
        context.report(node, "Invalid top level node");
      },
    };
  },
};
