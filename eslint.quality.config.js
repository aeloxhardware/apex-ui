// Règles de qualité « cliquet » : chaque violation est comptée par scripts/check-quality.cjs, comparée à
// scripts/quality-baseline.json et ne peut qu'augmenter l'échec (jamais la dette). Voir CLAUDE.md, « Quality gate ».
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  { ignores: ["dist", "src/components/ui", "icons-main", "slicer_engine", "**/*.test.ts", "**/*.test.tsx"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin, sonarjs },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "sonarjs/cognitive-complexity": ["error", 15],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
);
