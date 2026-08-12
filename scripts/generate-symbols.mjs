import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, "..");
const memoFile = join(repoRoot, "src", "plugins", "supportka", "memo.ts");
const resizedDir = join(repoRoot, ".symbol-resized");
const outFile = join(repoRoot, "src", "plugins", "supportka", "symbols.ts");

function normalize(s) {
    return s.toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[\u2014\u2013\u2015]/g, " ")
        .replace(/[()|/]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const memo = readFileSync(memoFile, "utf8");
const section = memo.match(/#{2} Запрещённая символика[\r\n]+([\s\S]*?)(?=[\r\n]+#{2} |$)/)?.[1] ?? "";
const titles = [...section.matchAll(/^- \*\*([^*]+)\*\*/gm)].map(m => m[1].trim());

const byKey = new Map(
    readdirSync(resizedDir)
        .filter(f => f.endsWith(".png"))
        .map(f => [normalize(f.slice(0, -4)), f])
);

const overrides = { "свастика": "卍" };

const lines = [];
lines.push("// Автогенерация: scripts/resize-symbols.ps1 + scripts/generate-symbols.mjs. Не редактировать вручную.");
lines.push("export const SYMBOL_IMAGES: Record<string, string> = {");
for (const title of titles) {
    const key = normalize(title);
    const file = key.includes("свастика") ? overrides["свастика"] + ".png" : byKey.get(key);
    if (!file) {
        console.warn("Нет картинки для:", title);
        continue;
    }
    const b64 = readFileSync(join(resizedDir, file)).toString("base64");
    lines.push(`    "${key}": "data:image/png;base64,${b64}",`);
}
lines.push("};");
lines.push("");
lines.push("export function getSymbolImage(title: string): string | undefined {");
lines.push('    return SYMBOL_IMAGES[title.toLowerCase().replace(/ё/g, "е").replace(/[\\u2014\\u2013\\u2015]/g, " ").replace(/[()|/]/g, " ").replace(/\\s+/g, " ").trim()];');
lines.push("}");

writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
console.log("Wrote", outFile, `(${titles.length} titles)`);
