// Copies the built plugin into the vault. Target: CTRL_VAULT or the Cortex vault.
import { copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const vault = process.env.CTRL_VAULT ?? join(homedir(), 'Library/CloudStorage/OneDrive-BoschGroup/Cortex');
const dir = join(vault, '.obsidian/plugins/ctrl-board');
mkdirSync(dir, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(f, join(dir, f));
console.log(`installed → ${dir}`);
