import ts from "typescript";

export function isObjectType(type: ts.Type): type is ts.ObjectType {
  return (type.flags & ts.TypeFlags.Object) === 1 && "objectFlags" in type;
}

export function isIntrinsicType(type: ts.Type): type is ts.IntrinsicType {
  return (type.flags & ts.TypeFlags.Intrinsic) === 1 && "intrinsicName" in type;
}
