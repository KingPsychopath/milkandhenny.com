import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = ["components", "features", "src"];
const extensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const nativeDropdownPatterns = [
  { expression: /<\s*select(?:\s|>)/gi, label: "native <select>" },
  {
    expression: /(?:React\.)?createElement\s*\(\s*["']select["']/gi,
    label: 'createElement("select")',
  },
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extensions.has(extname(entry.name)) ? [path] : [];
  });
}

const violations = roots.flatMap((root) =>
  sourceFiles(root).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return nativeDropdownPatterns.flatMap(({ expression, label }) =>
      [...source.matchAll(expression)].map((match) => ({
        path: relative(process.cwd(), path),
        line: source.slice(0, match.index).split("\n").length,
        label,
      })),
    );
  }),
);

if (violations.length > 0) {
  console.error("Native dropdowns are not allowed. Use components/AppSelect.tsx instead.\n");
  for (const violation of violations) {
    console.error(`${violation.path}:${violation.line} ${violation.label}`);
  }
  process.exitCode = 1;
}
