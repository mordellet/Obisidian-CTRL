import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { alias: { obsidian: fileURLToPath(new URL('./tests/sim/obsidian-mock.ts', import.meta.url)) } },
	test: {
		include: ['tests/**/*.test.ts'],
		passWithNoTests: true,
	},
});
