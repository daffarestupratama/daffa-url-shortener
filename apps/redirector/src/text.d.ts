declare module '*.txt' {
  const content: string;
  export default content;
}

/** Vite raw imports, used by guard.test.ts to read wrangler.jsonc. */
declare module '*?raw' {
  const content: string;
  export default content;
}
