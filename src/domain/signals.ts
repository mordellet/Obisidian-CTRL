// Signal computation (spec: design handoff, "Signale"). One signal = one channel.
import { addDays, daysBetween } from './dates';
import type { BoardEvent, IsoDate, Step, Topic } from './model';

export interface Signals {
	energy: number;
	prevEnergy: number;
	trend: number;
	energyRank: number;
	misalloc: number;
	misallocFlag: boolean;
	total: number;
	done: number;
	progress: number;
	doneInWindow: number;
	lastDone?: IsoDate;
	staleDays: number | null;
	stale: boolean;
	slop: boolean;
	blocked: boolean;
	events: BoardEvent[];
}

export interface SignalOptions {
	ref: IsoDate;
	win: number;
	staleDays: number;
}

export function allSteps(t: Topic): Step[] {
	return t.goals.flatMap((g) => g.steps);
}

function inWindow(at: IsoDate, ref: IsoDate, win: number): boolean {
	const d = daysBetween(at, ref);
	return d >= 0 && d < win;
}

export function computeSignals(topics: Topic[], events: BoardEvent[], o: SignalOptions): Map<string, Signals> {
	const out = new Map<string, Signals>();
	const prevRef = addDays(o.ref, -o.win);
	const byId = new Map(topics.map((t) => [t.id, t]));
	for (const t of topics) {
		const own = events.filter((e) => e.topic === t.id && daysBetween(e.at, o.ref) >= 0);
		const win = own.filter((e) => inWindow(e.at, o.ref, o.win));
		const energy = round1(win.reduce((s, e) => s + e.conf, 0));
		const prevEnergy = round1(own.filter((e) => inWindow(e.at, prevRef, o.win)).reduce((s, e) => s + e.conf, 0));
		const trend = clamp((energy - prevEnergy) / Math.max(prevEnergy, 4), -1, 1);
		const steps = allSteps(t);
		const doneSteps = steps.filter((s) => s.done && (!s.doneAt || daysBetween(s.doneAt, o.ref) >= 0));
		const dated = doneSteps.map((s) => s.doneAt).filter((d): d is string => !!d).sort();
		const lastDone = dated[dated.length - 1];
		const staleDays = lastDone ? daysBetween(lastDone, o.ref) : null;
		const doneInWindow = dated.filter((d) => inWindow(d, o.ref, o.win)).length;
		const blocked =
			t.status.kw === 'blockiert' ||
			t.blockedBy.some((id) => {
				const s = byId.get(id);
				return !s || s.status.kw !== 'fertig';
			});
		out.set(t.id, {
			energy,
			prevEnergy,
			trend,
			energyRank: 0,
			misalloc: 0,
			misallocFlag: false,
			total: steps.length,
			done: doneSteps.length,
			progress: steps.length ? doneSteps.length / steps.length : 0,
			doneInWindow,
			lastDone,
			staleDays,
			stale: t.status.kw !== 'fertig' && t.status.kw !== 'pausiert' && (staleDays === null || staleDays > o.staleDays),
			slop: false,
			blocked,
			events: win.sort((a, b) => b.at.localeCompare(a.at)),
		});
	}
	// ranks, misallocation, slop
	const ranked = [...topics].sort((a, b) => (out.get(b.id)?.energy ?? 0) - (out.get(a.id)?.energy ?? 0) || a.prio - b.prio);
	const n = topics.length;
	const flagAt = n >= 10 ? 4 : Math.max(2, Math.round(n / 3));
	ranked.forEach((t, i) => {
		const s = out.get(t.id);
		if (!s) return;
		s.energyRank = i + 1;
		s.misalloc = t.prio - s.energyRank;
		s.misallocFlag = Math.abs(s.misalloc) >= flagAt;
		s.slop = s.energyRank <= Math.ceil(n / 3) && s.energy >= 3 && s.doneInWindow === 0;
	});
	return out;
}

/** Transitive supplier / consumer chain via `needs`. */
export function chain(topics: Topic[], id: string): { suppliers: string[]; consumers: string[] } {
	const needs = new Map(topics.map((t) => [t.id, [...new Set([...t.needs, ...t.blockedBy])]]));
	const walk = (start: string, next: (x: string) => string[]) => {
		const seen = new Set<string>();
		const stack = [...next(start)];
		while (stack.length) {
			const x = stack.pop() as string;
			if (seen.has(x) || x === id) continue;
			seen.add(x);
			stack.push(...next(x));
		}
		return [...seen];
	};
	return {
		suppliers: walk(id, (x) => needs.get(x) ?? []),
		consumers: walk(id, (x) => topics.filter((t) => (needs.get(t.id) ?? []).includes(x)).map((t) => t.id)),
	};
}

function clamp(v: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, v));
}
function round1(v: number) {
	return Math.round(v * 10) / 10;
}
