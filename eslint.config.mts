import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		// Claude Design export (interaction design for F4–F6), not plugin code
		'esbuild.config.mjs',
		'version-bump.mjs',
		'scripts',
		'.dependency-cruiser.cjs',
		'versions.json',
		'main.js',
		'package.json',
		'pnpm-lock.yaml',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// "Filavi" is the plugin's proper name and stays capitalised in UI text.
		rules: { 'obsidianmd/ui/sentence-case': ['warn', { brands: ['CTRL'] }] },
	},
	{
		// Constitution Art. I.1: no network access in domain, ports and application.
		files: ['src/domain/**/*.ts', 'src/ports/**/*.ts', 'src/application/**/*.ts'],
		rules: {
			'no-restricted-globals': [
				'error',
				{ name: 'fetch', message: 'Core layers must not access the network (Constitution Art. I.1).' },
				{ name: 'XMLHttpRequest', message: 'Core layers must not access the network (Constitution Art. I.1).' },
				{ name: 'WebSocket', message: 'Core layers must not access the network (Constitution Art. I.1).' },
			],
		},
	},
	{
		// Tests run in Node under vitest, not inside Obsidian: the obsidianmd rules target plugin
		// runtime code (popout windows, console policy) and do not apply. Type-aware rules stay on.
		files: ['tests/**/*.ts'],
		rules: Object.fromEntries(Object.keys(obsidianmd.rules ?? {}).map((rule) => [`obsidianmd/${rule}`, 'off'])),
	},
	{
		// Live-check and eval scripts run in Node (research R9, F3 R12); not part of the plugin.
		files: ['tests/e2e/**/*.mjs', 'tests/evals/**/*.mjs'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			globals: { ...globals.node },
			parserOptions: { projectService: false },
		},
		rules: {
			...Object.fromEntries(Object.keys(obsidianmd.rules ?? {}).map((rule) => [`obsidianmd/${rule}`, 'off'])),
			// Node scripts outside Obsidian: requestUrl does not exist there, fetch is the right tool
			'no-restricted-globals': 'off',
		},
	},
);
