import { App, TFile } from 'obsidian';
import type { StatusKw } from '../../domain/model';
import type { BoardWriter, Clock } from '../../ports/board';
import { fromEpoch } from '../../domain/dates';

export class SystemClock implements Clock {
	today(): string {
		return fromEpoch(Date.now());
	}
}

export class VaultBoardWriter implements BoardWriter {
	constructor(private readonly app: App) {}

	private file(path: string): TFile {
		const f = this.app.vault.getFileByPath(path);
		if (!f) throw new Error(`not found · ${path}`);
		return f;
	}

	async setStatus(topicPath: string, kw: StatusKw, text: string, at: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.file(topicPath), (fm: Record<string, unknown>) => {
			fm.status = kw;
			fm.status_text = text;
			fm.status_at = at;
		});
	}

	async replaceLine(path: string, line: number, expected: string, next: string): Promise<boolean> {
		let ok = false;
		await this.app.vault.process(this.file(path), (data) => {
			const lines = data.split('\n');
			if (lines[line] !== expected) return data;
			lines[line] = next;
			ok = true;
			return lines.join('\n');
		});
		return ok;
	}

	async setPrio(topicPath: string, prio: number): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.file(topicPath), (fm: Record<string, unknown>) => {
			fm.prio = prio;
		});
	}

	async assignTopic(notePath: string, topicId: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(this.file(notePath), (fm: Record<string, unknown>) => {
			const cur = fm.thema;
			const list = Array.isArray(cur) ? cur.map(String) : typeof cur === 'string' && cur ? [cur] : [];
			if (!list.includes(topicId)) list.push(topicId);
			fm.thema = list.length === 1 ? list[0] : list;
		});
	}
}
