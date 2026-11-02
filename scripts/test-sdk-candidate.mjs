import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const [core, web, ...testArguments] = process.argv.slice(2);
if (!core || !web || !existsSync(core) || !existsSync(web))
	throw new Error(
		"Usage: npm run test:sdk-candidate -- /absolute/core.tgz /absolute/web.tgz [Playwright arguments]",
	);
const source = resolve(import.meta.dirname, "..");
const target = mkdtempSync(join(tmpdir(), "run-to-exit-sdk-"));
cpSync(source, target, {
	recursive: true,
	filter: (path) =>
		![
			".git",
			"node_modules",
			"dist",
			"test-results",
			"playwright-report",
		].includes(basename(path)),
});
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(args, env = {}) {
	const result = spawnSync(npm, args, {
		cwd: target,
		stdio: "inherit",
		env: { ...process.env, ...env },
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`npm ${args.join(" ")} failed (${result.status}); checkout retained at ${target}`,
		);
}
console.log(`Isolated candidate checkout: ${target}`);
run(["ci"]);
// Candidate dependencies and their integrity are recorded only in the isolated checkout.
run(["install", "--save-exact", resolve(core), resolve(web)]);
const manifest = JSON.parse(
	readFileSync(
		join(target, "node_modules/@simpludify/web/package.json"),
		"utf8",
	),
);
run(["run", "check"]);
run(["test"]);
run(["run", "build"]);
run(["run", "test:e2e", "--", ...testArguments], {
	E2E_SDK_VERSION: manifest.version,
	E2E_REQUIRE_LABELS: "1",
});
writeFileSync(
	join(target, "candidate-result.json"),
	JSON.stringify(
		{
			core: resolve(core),
			web: resolve(web),
			version: manifest.version,
			passed: true,
		},
		null,
		2,
	),
);
console.log(`Candidate passed; result and reports: ${target}`);
