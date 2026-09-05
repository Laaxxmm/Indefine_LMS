// ESLint 9 flat config. eslint-config-next 15.5 still ships legacy configs, so they are
// loaded through FlatCompat. `next build` runs this; `npm run lint` runs it alone.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: [".next/**", "node_modules/**", "neo-centra-extension/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
