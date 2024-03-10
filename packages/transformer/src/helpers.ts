import ts from "typescript";

// TODO: We should allow users to specify location
// **/lekko/<namespace>.ts, namespace must be kebab-case alphanumeric
export const LEKKO_FILENAME_REGEX = /lekko\/([a-z][a-z0-9-]*)\.ts$/;

export function isObjectType(type: ts.Type): type is ts.ObjectType {
  return (type.flags & ts.TypeFlags.Object) === 1 && "objectFlags" in type;
}

export function isIntrinsicType(type: ts.Type): type is ts.IntrinsicType {
  return (type.flags & ts.TypeFlags.Intrinsic) === 1 && "intrinsicName" in type;
}
