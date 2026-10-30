import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const blaIndex = process.argv[2];
const files = process.argv.slice(3);
if (!blaIndex || files.length === 0) {
  console.error("usage: node scripts/harden_release.mjs <bla-index.js> <artifact>...");
  process.exit(1);
}

const bla = await import(pathToFileURL(blaIndex).href);

function interfaceDump(module, kind) {
  const items = kind === "export" ? WebAssembly.Module.exports(module) : WebAssembly.Module.imports(module);
  return items
    .map((item) => [kind, item.module || "", item.name, item.kind].join("\0"))
    .sort()
    .join("\n");
}

async function assertWasmInterface(original, hardened) {
  const before = await WebAssembly.compile(readFileSync(original));
  const after = await WebAssembly.compile(readFileSync(hardened));
  const sameExports = interfaceDump(before, "export") === interfaceDump(after, "export");
  const sameImports = interfaceDump(before, "import") === interfaceDump(after, "import");
  if (!sameExports || !sameImports || !WebAssembly.validate(readFileSync(hardened))) {
    throw new Error(`WebAssembly interface changed: ${original}`);
  }
}

function assertServiceWorker(path) {
  const source = readFileSync(path, "utf8").replace(/^export function /gm, "function ");
  writeFileSync(path, source);
  new vm.Script(source, { filename: "sw.js" });
}

for (const file of files) {
  const extension = file.match(/(\.[^.]+)$/)?.[1];
  if (!extension) {
    throw new Error(`Cannot harden ${file}`);
  }
  const output = `${file.slice(0, -extension.length)}.hardened${extension}`;
  const manifest = `${output}.bla-manifest.json`;
  try {
    const report = bla.defendTarget({
      inputPath: file,
      outputPath: output,
      intensity: "bankrupt",
      emitManifest: true,
    });
    if (!report.overallSuccess) {
      const failed = (report.verification?.checks || []).filter((check) => !check.passed).map((check) => check.id);
      throw new Error(`BLA verify failed for ${file}${failed.length ? ` (${failed.join(", ")})` : ""}`);
    }
    if (file.endsWith(".wasm")) {
      await assertWasmInterface(file, output);
    }
    if (basename(file) === "sw.js") {
      assertServiceWorker(output);
      const again = bla.verifyTarget(output, file);
      if (!again.overallPassed) {
        throw new Error("BLA verify failed for the service worker");
      }
    }
    renameSync(output, file);
    console.log(`hardened ${file}`);
  } finally {
    rmSync(manifest, { force: true });
    rmSync(output, { force: true });
  }
}
