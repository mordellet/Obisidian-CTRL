// Reads topics, board note and activity events from the vault.
import { App, TFile, type FrontMatterCache } from 'obsidian';
import { fromEpoch, toIsoDate } from '../../domain/dates';
import { isStatusKw, type BoardData, type BoardEvent, type MainSection, type Topic } from '../../domain/model';
import { parseBody } from '../../domain/parse';
import type { BoardSource } from '../../ports/board';
import { list, type CtrlSettings } from './settings';

/** Stunden-Äquivalent einer zugeordneten Notiz (thema:) bzw. eines Links. */
const NOTE_H = 0.5;
const LINK_H = 0.25;

const ID_IN = /\b([A-Z]+\d+)(?:\.\d+)*\b/;

function arr(v: unknown): string[] {
	if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
	if (typeof v === 'string' && v.trim()) return v.split(',').map((x) => x.trim());
	return [];
}

function str(v: unknown): string {
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return '';
}

export class VaultBoardSource implements BoardSource {
	constructor(
		private readonly app: App,
		private readonly settings: () => CtrlSettings,
	) {}

	private inFolder(path: string, folder: string) {
		return path === folder || path.startsWith(folder + '/');
	}

	async load(): Promise<BoardData> {
		const s = this.settings();
		const files = this.app.vault.getMarkdownFiles();
		const topics: Topic[] = [];
		let main: MainSection | null = null;
		for (const f of files.filter((x) => this.inFolder(x.path, s.boardFolder))) {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm) continue;
			const type = str(fm.type);
			if (type !== 'thema' && type !== 'board') continue;
			const content = await this.app.vault.cachedRead(f);
			if (type === 'board') {
				const p = parseBody(content, 'main');
				main = {
					path: f.path,
					mainTrack: str(fm.main_track),
					staleDays: Number(fm.stale_days) || s.staleDays,
					focus: [...p.focus, ...p.goals.flatMap((g) => g.steps)],
					questions: p.questions,
				};
				continue;
			}
			topics.push(this.topic(f, fm, content));
		}
		const events = this.events(files, topics, s);
		return { main, topics, events };
	}

	private topic(f: TFile, fm: FrontMatterCache, content: string): Topic {
		const id = str(fm.id) || ID_IN.exec(f.basename)?.[1] || f.basename;
		const p = parseBody(content, id);
		const kw = str(fm.status);
		return {
			id,
			name: f.basename.replace(new RegExp(`^${id}\\s+`), ''),
			path: f.path,
			prio: Number(fm.prio) || 99,
			status: { kw: isStatusKw(kw) ? kw : 'läuft', text: str(fm.status_text), at: toIsoDate(fm.status_at) },
			needs: arr(fm.braucht),
			blockedBy: arr(fm.blockiert_durch),
			returnCondition: str(fm.rueckfuehrung),
			reviewed: toIsoDate(fm.geprueft),
			confidential: fm.confidential === true,
			goals: p.goals,
			goalsEnd: p.goalsEnd,
			parallel: p.parallel,
			questions: p.questions,
		};
	}

	private events(files: TFile[], topics: Topic[], s: CtrlSettings): BoardEvent[] {
		const include = list(s.eventFolders);
		const exclude = [...list(s.excludeFolders), s.boardFolder];
		const byPath = new Map(topics.map((t) => [t.path, t]));
		const ids = new Set(topics.map((t) => t.id));
		const resolved = this.app.metadataCache.resolvedLinks;
		const out: BoardEvent[] = [];
		for (const f of files) {
			if (!include.some((d) => this.inFolder(f.path, d))) continue;
			if (exclude.some((d) => this.inFolder(f.path, d))) continue;
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			const at = toIsoDate(fm?.date) ?? toIsoDate(fm?.created) ?? fromEpoch(f.stat.mtime);
			const base = { path: f.path, title: f.basename, at };
			// Tages-Essenz: `energie: {S8: 2.5, S1: 1}` in der Daily Note = Stunden je Thema (ersetzt thema/Links)
			const en: unknown = fm?.energie;
			if (en && typeof en === 'object' && !Array.isArray(en)) {
				for (const [k, v] of Object.entries(en as Record<string, unknown>)) {
					const h = Number(v);
					const id = ID_IN.exec(k)?.[1] ?? '';
					if (ids.has(id) && h > 0) out.push({ ...base, topic: id, conf: h, hours: true });
				}
				continue;
			}
			const explicit = arr(fm?.thema)
				.map((v) => ID_IN.exec(v)?.[1] ?? '')
				.filter((v) => ids.has(v));
			const goal = str(fm?.ziel) || undefined;
			const linked = Object.keys(resolved[f.path] ?? {})
				.map((p) => byPath.get(p)?.id)
				.filter((v): v is string => !!v && !explicit.includes(v));
			for (const id of explicit) out.push({ ...base, topic: id, goal, conf: NOTE_H });
			for (const id of linked) out.push({ ...base, topic: id, conf: LINK_H });
			const isDaily = fm?.type === 'daily' || f.path.startsWith('06-Daily');
			if (!explicit.length && !linked.length && !isDaily) out.push({ ...base, topic: null, conf: 0 });
		}
		return out;
	}
}
