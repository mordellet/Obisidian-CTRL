import { App, PluginSettingTab, Setting } from 'obsidian';

export interface CtrlSettings {
	boardFolder: string;
	eventFolders: string;
	excludeFolders: string;
	staleDays: number;
}

export const DEFAULT_SETTINGS: CtrlSettings = {
	boardFolder: '02-Areas/Group Lead GS-BDA5/Board',
	eventFolders: '00-Inbox, 01-Projects, 02-Areas, 06-Daily',
	excludeFolders: '00-Inbox/screenshots, _templates, _attachments, 04-Archive',
	staleDays: 28,
};

export function list(v: string): string[] {
	return v
		.split(',')
		.map((s) => s.trim().replace(/\/$/, ''))
		.filter(Boolean);
}

export interface SettingsHost {
	settings: CtrlSettings;
	saveSettings(): Promise<void>;
}

export class CtrlSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly host: SettingsHost & import('obsidian').Plugin,
	) {
		super(app, host);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.host.settings;
		const text = (name: string, desc: string, key: 'boardFolder' | 'eventFolders' | 'excludeFolders') =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(s[key]).onChange(async (v) => {
						s[key] = v;
						await this.host.saveSettings();
					}),
				);
		text('Board folder', 'Folder with the board note and one note per topic.', 'boardFolder');
		text('Event folders', 'Comma-separated folders whose notes count as activity.', 'eventFolders');
		text('Excluded folders', 'Comma-separated folders that never count.', 'excludeFolders');
		new Setting(containerEl)
			.setName('Stale after (days)')
			.setDesc('Default if the board note sets no stale_days.')
			.addText((t) =>
				t.setValue(String(s.staleDays)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n > 0) {
						s.staleDays = n;
						await this.host.saveSettings();
					}
				}),
			);
	}
}
