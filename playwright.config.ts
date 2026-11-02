import { defineConfig } from "@playwright/test";
const external = process.env.E2E_BASE_URL;
export default defineConfig({
	testDir: "./tests/e2e",
	timeout: process.env.CHROMIUM_PATH ? 180000 : 60000,
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: external ?? "http://127.0.0.1:4173/Run-To-Exit/",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		launchOptions: {
			executablePath: process.env.CHROMIUM_PATH,
			args: [
				"--no-sandbox",
				"--enable-unsafe-swiftshader",
				"--use-gl=angle",
				"--use-angle=swiftshader",
			],
		},
	},
	projects: [
		{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
		{
			name: "compact",
			use: {
				viewport: { width: 320, height: 740 },
				isMobile: true,
				hasTouch: true,
			},
		},
		{
			name: "narrow",
			use: {
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			},
		},
	].flatMap((project) => [
		project,
		{
			...project,
			name: `${project.name}-canvas2d`,
			metadata: { renderer: "canvas2d" },
		},
	]),
	webServer: external
		? undefined
		: {
				command: "npm run preview -- --host 127.0.0.1",
				url: "http://127.0.0.1:4173/Run-To-Exit/",
				reuseExistingServer: !process.env.CI,
			},
});
