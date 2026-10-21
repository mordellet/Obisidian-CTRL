import { Plugin, debounce } from 'obsidian';
import { BoardService } from './application/board-service';
import { CtrlView, VIEW_TYPE_CTRL } from './adapters/obsidian/ctrl-view';
import { CtrlSettingTab, DEFAULT_SETTINGS, type CtrlSettings, type SettingsHost } from './adapters/obsidian/settings';
import { VaultBoardSource } from './adapters/obsidian/vault-source';
import { SystemClock, VaultBoardWriter } from './adapters/obsidian/vault-writer';
import { DemoSource, ReadOnlyWriter } from './adapters/demo/demo-source';

// Composition root: wires adapters to ports. No domain logic here.
export default class CtrlPlugin extends Plugin implements SettingsHost {
	settings: CtrlSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<CtrlSettings> | null) };
		this.addSettingTab(new CtrlSettingTab(this.app, this));
		const clock = new SystemClock();
		const service = new BoardService(new VaultBoardSource(this.app, () => this.settings), new VaultBoardWriter(this.app), clock);
		const demo = new BoardService(new DemoSource(), new ReadOnlyWriter(), clock);
		this.registerView(VIEW_TYPE_CTRL, (leaf) => new CtrlView(leaf, service, demo, clock, () => this.settings.staleDays));
		this.addRibbonIcon('radar', 'Open CTRL board', () => void this.activate());
		this.addCommand({ id: 'open', name: 'Open board', callback: () => void this.activate() });

		const refresh = debounce(
			() => {
				for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CTRL)) {
					if (leaf.view instanceof CtrlView) void leaf.view.refresh();
				}
			},
			600,
			true,
		);
		this.registerEvent(this.app.metadataCache.on('resolved', refresh));
		this.registerEvent(this.app.vault.on('rename', refresh));
		this.registerEvent(this.app.vault.on('delete', refresh));
	}

	async activate() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CTRL)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_CTRL, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
