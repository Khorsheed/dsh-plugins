/** CSS Modules compile to a typed class map in the client bundle (build/tsdown.client.ts). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
