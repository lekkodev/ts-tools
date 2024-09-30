export interface AConfig {
  b?: boolean
}

export function getA(): AConfig {
  return { b: false };
}

export function getB(): boolean {
  return getA().b;
}

export function getC(): boolean {
  return getB();
}
