import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";

await rm("./dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  minify: true,
  splitting: true,
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
console.log(`Built ${result.outputs.length} assets`);
