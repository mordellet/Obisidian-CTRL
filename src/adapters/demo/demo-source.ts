// Demo source: port of the design handoff test data (board-data.js, seed 20261021).
// Read-only; used to compare the plugin with the design reference on identical data.
import type { BoardData, BoardEvent, Goal, Step, Topic } from '../../domain/model';
import type { BoardSource, BoardWriter } from '../../ports/board';

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const DAY = 864e5;
const TODAY = '2026-10-21';
const T0 = Date.parse(TODAY + 'T00:00:00Z');
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthStart = (i: number) => Date.UTC(2025 + (i >= 2 ? 1 : 0), (10 + i) % 12, 1);

const TOPICS = [
	{ id: 'T01', name: 'Plattformstrategie', prio: 1, profile: [22, 20, 26, 24, 22, 20, 18, 16, 14, 12, 12, 11], progress: 0.62, lastDone: 6, goals: 4 },
	{ id: 'T02', name: 'Governance über Dienstleister', prio: 2, profile: [6, 5, 8, 7, 6, 5, 4, 3, 2, 2, 1, 2], progress: 0.18, lastDone: 19, goals: 4 },
	{ id: 'T03', name: 'Kooperationsmodell Standorte', prio: 3, profile: [8, 9, 12, 14, 16, 15, 14, 16, 15, 14, 16, 15], progress: 0.35, lastDone: 9, goals: 5 },
	{ id: 'T04', name: 'Agentische Entwicklung', prio: 4, profile: [30, 28, 34, 36, 32, 30, 26, 22, 18, 16, 15, 14], progress: 0.78, lastDone: 3, goals: 5 },
	{ id: 'T05', name: 'Exekutiv-Mandat Architektur', prio: 5, profile: [10, 8, 12, 14, 12, 14, 12, 13, 12, 11, 12, 10], progress: 0.44, lastDone: 12, goals: 3 },
	{ id: 'T06', name: 'Budget 2027', prio: 6, profile: [2, 2, 1, 2, 3, 4, 6, 8, 14, 22, 30, 28], progress: 0.1, lastDone: 71, goals: 3 },
	{ id: 'T07', name: 'Nachwuchs & Rollen', prio: 7, profile: [6, 6, 8, 8, 7, 9, 8, 7, 8, 8, 7, 8], progress: 0.5, lastDone: 15, goals: 4 },
	{ id: 'T08', name: 'Security-Audit', prio: 8, profile: [8, 10, 12, 14, 10, 8, 4, 2, 2, 1, 1, 1], progress: 0.7, lastDone: 48, goals: 3 },
	{ id: 'T09', name: 'Altsystem-Ablösung', prio: 9, profile: [12, 10, 8, 6, 6, 5, 4, 3, 2, 2, 2, 1], progress: 0.3, lastDone: 63, goals: 4 },
	{ id: 'T10', name: 'Konzernprogramm Reporting', prio: 10, profile: [4, 4, 6, 8, 10, 14, 20, 26, 30, 34, 38, 36], progress: 0.08, lastDone: 95, goals: 3 },
	{ id: 'T11', name: 'Tooling-Migration', prio: 11, profile: [6, 8, 6, 4, 3, 2, 2, 1, 1, 0, 1, 0], progress: 0.55, lastDone: 84, goals: 3 },
	{ id: 'T12', name: 'Konferenz & Außenauftritt', prio: 12, profile: [2, 2, 3, 4, 4, 6, 8, 12, 16, 20, 24, 22], progress: 0.4, lastDone: 8, goals: 3 },
];
const DEPS = [
	{ from: 'T05', to: 'T02', type: 'blockiert', open: true },
	{ from: 'T02', to: 'T03', type: 'braucht', open: true },
	{ from: 'T04', to: 'T01', type: 'braucht', open: false },
	{ from: 'T07', to: 'T04', type: 'braucht', open: true },
	{ from: 'T08', to: 'T09', type: 'braucht', open: false },
];
const GOAL_WORDS = ['Zielbild abstimmen', 'Pilot aufsetzen', 'Betrieb übergeben', 'Kennzahlen belegen', 'Mandat sichern', 'Konzept fertigstellen', 'Partner gewinnen', 'Freigabe einholen'];
const STEP_WORDS = ['Entwurf', 'Abstimmung', 'Review', 'Entscheidung', 'Umsetzung', 'Test', 'Dokumentation', 'Übergabe'];

interface DemoStep {
	step: Step;
	doneAtMs: number | null;
}

export function demoData(): BoardData {
	const r = rng(20261021);
	const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)] as T;
	const topics: Topic[] = [];
	const events: BoardEvent[] = [];
	for (const t of TOPICS) {
		const goals: Goal[] = [];
		const steps: DemoStep[] = [];
		const leafIds: string[] = [];
		for (let g = 0; g < t.goals; g++) {
			const gid = `${t.id}.${g + 1}`;
			const goal: Goal = { id: gid, name: pick(GOAL_WORDS), implicit: false, steps: [] };
			goals.push(goal);
			leafIds.push(gid);
			const ns = 2 + Math.floor(r() * 4);
			for (let s = 0; s < ns; s++) {
				const sid = `${gid}.${s + 1}`;
				const mk = (id: string, level: number): DemoStep => {
					const step: Step = { id, text: pick(STEP_WORDS), done: false, fokus: false, level, line: -1, raw: '', section: 'ziele', goalId: gid };
					goal.steps.push(step);
					leafIds.push(id);
					return { step, doneAtMs: null };
				};
				const st = mk(sid, 0);
				steps.push(st);
				if (r() < 0.25) for (let u = 0; u < 2 + Math.floor(r() * 2); u++) steps.push(mk(`${sid}.${u + 1}`, 1));
			}
		}
		const nDone = Math.round(steps.length * t.progress);
		const order = steps
			.slice()
			.sort(() => r() - 0.5)
			.slice(0, nDone);
		order.forEach((s, i) => {
			s.doneAtMs = i === 0 ? T0 - t.lastDone * DAY : T0 - (t.lastDone + 1 + Math.floor(r() * (340 - t.lastDone))) * DAY;
			s.step.done = true;
			s.step.doneAt = fmt(s.doneAtMs);
		});
		t.profile.forEach((cnt, m) => {
			const m0 = monthStart(m);
			const m1 = m === 11 ? T0 + DAY : monthStart(m + 1);
			for (let i = 0; i < cnt; i++) {
				const at = m0 + r() * (m1 - m0);
				if (at > T0 + DAY) continue;
				const unassigned = r() < 0.1;
				r(); // source
				const node = unassigned ? null : pick(leafIds);
				if (!unassigned) r(); // conf draw keeps the sequence identical to the reference
				const id = `e${events.length}`;
				events.push({
					path: `demo/${id}`,
					title: `${id} · ${node ?? 'ohne thema'}`,
					at: fmt(at),
					topic: unassigned ? null : t.id,
					goal: node ? node.split('.').slice(0, 2).join('.') : undefined,
					conf: unassigned ? 0 : 1,
				});
			}
		});
		topics.push({
			id: t.id,
			name: t.name,
			path: `demo/${t.id}`,
			prio: t.prio,
			status: { kw: 'läuft', text: '' },
			needs: DEPS.filter((d) => d.to === t.id && d.type === 'braucht').map((d) => d.from),
			blockedBy: DEPS.filter((d) => d.to === t.id && d.type === 'blockiert' && d.open).map((d) => d.from),
			returnCondition: '',
			confidential: false,
			goals,
			parallel: [],
			questions: [],
		});
	}
	return { main: { path: 'demo/board', mainTrack: 'Demo · Testdaten aus dem Design-Handoff', staleDays: 28, focus: [], questions: [] }, topics, events };
}

export class DemoSource implements BoardSource {
	private cache: BoardData | null = null;
	load(): Promise<BoardData> {
		this.cache ??= demoData();
		return Promise.resolve(this.cache);
	}
}

export class ReadOnlyWriter implements BoardWriter {
	private fail(): Promise<never> {
		return Promise.reject(new Error('demo · nur lesen'));
	}
	setStatus() {
		return this.fail();
	}
	replaceLine() {
		return this.fail();
	}
	setPrio() {
		return this.fail();
	}
	assignTopic() {
		return this.fail();
	}
}
