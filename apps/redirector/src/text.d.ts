declare module '*.txt' {
  const content: string;
  export default content;
}

/** Data modules (wrangler.jsonc rules), used by icons.ts. */
declare module '*.ico' {
  const content: ArrayBuffer;
  export default content;
}

declare module '*.png' {
  const content: ArrayBuffer;
  export default content;
}

/** The same files read again in tests, through the plugin in vitest.config.ts. */
declare module '*?source' {
  const content: ArrayBuffer;
  export default content;
}

/** Vite raw imports, used by guard.test.ts to read wrangler.jsonc. */
declare module '*?raw' {
  const content: string;
  export default content;
}
