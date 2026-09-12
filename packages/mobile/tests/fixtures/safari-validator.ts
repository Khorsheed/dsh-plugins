// Complete published validator, pinned by the adapter's SHA-256 fingerprint.
export const validator = `function hasIntrinsicConstructor(prototype, name) {
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (typeof constructor !== "function") return false;
  try {
    return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === \`function \${name}() { [native code] }\`;
  } catch {
    return false;
  }
}`
