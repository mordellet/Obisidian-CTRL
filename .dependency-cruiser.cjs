// Architecture test for Constitution Article I (hexagonal architecture).
// Layers (Art. I.5): domain <- ports <- application <- adapters <- main.ts
/** @type {import('dependency-cruiser').IConfiguration} */
const EXTERNAL = ['core', 'npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown', 'unknown'];

module.exports = {
	forbidden: [
		{
			name: 'domain-depends-on-nothing',
			comment: 'Domain may only depend on domain (Art. I.1, I.5).',
			severity: 'error',
			from: { path: '^src/domain/' },
			to: { path: '^src/(ports|application|adapters)/|^src/main\\.ts$' },
		},
		{
			name: 'ports-depend-on-domain-only',
			comment: 'Ports may only depend on domain (Art. I.5).',
			severity: 'error',
			from: { path: '^src/ports/' },
			to: { path: '^src/(application|adapters)/|^src/main\\.ts$' },
		},
		{
			name: 'application-no-adapters',
			comment: 'Use cases depend on ports and domain, never on adapters (Art. I.5).',
			severity: 'error',
			from: { path: '^src/application/' },
			to: { path: '^src/adapters/|^src/main\\.ts$' },
		},
		{
			name: 'core-no-external-modules',
			comment: 'Domain, ports and application are free of obsidian, network and file-system access (Art. I.1).',
			severity: 'error',
			from: { path: '^src/(domain|ports|application)/' },
			to: { dependencyTypes: EXTERNAL },
		},
		{
			name: 'adapters-no-composition-root',
			comment: 'Only main.ts wires adapters together (Art. I.4).',
			severity: 'error',
			from: { path: '^src/adapters/' },
			to: { path: '^src/main\\.ts$' },
		},
		{
			name: 'no-circular',
			severity: 'error',
			from: {},
			to: { circular: true },
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		tsPreCompilationDeps: true,
		tsConfig: { fileName: 'tsconfig.json' },
	},
};
