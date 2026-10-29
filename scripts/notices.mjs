import {
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
copyFileSync("vendor/simpludify/LICENSE", "dist/SIMPLUDIFY-LICENSE.txt");
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const notices = [
  "Run To Exit uses Simpludify (MIT). See SIMPLUDIFY-LICENSE.txt.",
];
const inventory = [];
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location.startsWith("node_modules/") || pkg.dev || pkg.link) continue;
  const meta = JSON.parse(readFileSync(`${location}/package.json`, "utf8"));
  const files = readdirSync(location).filter((name) =>
    /^(license|licence|copying|notice)([.-]|$)/i.test(name),
  );
  if (!files.length && meta.name === "@pixi/colord") {
    notices.push(
      `${meta.name}@${pkg.version} (${meta.license})\n${readFileSync("vendor/simpludify/third-party/colord/LICENSE.md", "utf8")}`,
    );
  } else {
    if (!files.length)
      throw new Error(`Missing license notice for ${meta.name}`);
    notices.push(
      `${meta.name}@${pkg.version} (${meta.license})\n${files.map((file) => readFileSync(`${location}/${file}`, "utf8")).join("\n")}`,
    );
  }
  inventory.push({
    name: meta.name,
    version: pkg.version,
    license: meta.license,
    integrity: pkg.integrity,
  });
}
writeFileSync("dist/THIRD-PARTY-NOTICES.txt", notices.join("\n\n---\n\n"));
writeFileSync("dist/dependencies.json", JSON.stringify(inventory, null, 2));
writeFileSync("dist/.nojekyll", "");
