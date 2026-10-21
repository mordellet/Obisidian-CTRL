// Board view (Stufe 0 radial + Detail + Statuszeile + Nicht zugeordnet).
import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { daysBetween } from '../../domain/dates';
import type { BoardData, BoardEvent, Question, Step, Topic } from '../../domain/model';
import { STATUS_KWS } from '../../domain/model';
import { allSteps, chain, computeSignals, type Signals } from '../../domain/signals';
import { parseStatusInput } from '../../domain/status-input';
import type { BoardService } from '../../application/board-service';
import type { Clock } from '../../ports/board';

export const VIEW_TYPE_CTRL = 'ctrl-board';

const SVGNS = 'http://www.w3.org/2000/svg';
const C = { x: 430, y: 390 };
const R0 = 60;
const RMAX = 196;

type Attrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent?: Element): SVGElementTagNameMap[K] {
	const e = document.createElementNS(SVGNS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
	parent?.appendChild(e);
	return e;
}

function pol(r: number, deg: number): [number, number] {
	const a = (deg * Math.PI) / 180;
	return [C.x + r * Math.sin(a), C.y - r * Math.cos(a)];
}

function sectorPath(r1: number, r2: number, a0: number, a1: number): string {
	const large = a1 - a0 > 180 ? 1 : 0;
	const [x0, y0] = pol(r2, a0);
	const [x1, y1] = pol(r2, a1);
	const [x2, y2] = pol(r1, a1);
	const [x3, y3] = pol(r1, a0);
	return `M${x0},${y0} A${r2},${r2} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r1},${r1} 0 ${large} 0 ${x3},${y3} Z`;
}

function arrow(x: number, y: number, ang: number, len: number): string {
	const a = (ang * Math.PI) / 180;
	const ex = x + len * Math.cos(a);
	const ey = y + len * Math.sin(a);
	const h = 4;
	const l = a + Math.PI * 0.8;
	const r = a - Math.PI * 0.8;
	return `M ${x} ${y} L ${ex} ${ey} M ${ex + h * Math.cos(l)} ${ey + h * Math.sin(l)} L ${ex} ${ey} L ${ex + h * Math.cos(r)} ${ey + h * Math.sin(r)}`;
}

function arcPath(r: number, a0: number, a1: number): string {
	const [x0, y0] = pol(r, a0);
	const [x1, y1] = pol(r, a1);
	return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const mmdd = (d: string) => d.slice(5);
const KIND_MARK: Record<Question['kind'], string> = { entscheidung: '!', frage: '?', risiko: 'r' };

export class CtrlView extends ItemView {
	private data: BoardData | null = null;
	private sig = new Map<string, Signals>();
	private sel: string | null = null;
	private mode: 'jahr' | '28' = 'jahr';
	private runde = false;
	private demo = false;
	private hint = '';
	private draft = '';

	constructor(
		leaf: WorkspaceLeaf,
		private readonly live: BoardService,
		private readonly demoService: BoardService,
		private readonly clock: Clock,
		private readonly defaultStale: () => number,
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_CTRL;
	}
	getDisplayText() {
		return 'CTRL';
	}
	getIcon() {
		return 'radar';
	}

	async onOpen() {
		this.scope?.register([], 'Escape', () => {
			this.sel = null;
			this.draw();
			return false;
		});
		await this.refresh();
	}

	private get service(): BoardService {
		return this.demo ? this.demoService : this.live;
	}
	private get today(): string {
		return this.demo ? '2026-10-21' : this.today;
	}

	async refresh() {
		try {
			this.data = await this.service.load();
		} catch (e) {
			this.hint = `load failed · ${(e as Error).message}`;
		}
		this.draw();
	}

	private get win() {
		return this.mode === 'jahr' ? 365 : 28;
	}
	private get staleDays() {
		return this.data?.main?.staleDays ?? this.defaultStale();
	}
	private visibleTopics(): Topic[] {
		return (this.data?.topics ?? []).filter((t) => !(this.runde && t.confidential)).sort((a, b) => a.prio - b.prio);
	}
	private topic(id: string | null) {
		return this.visibleTopics().find((t) => t.id === id);
	}
	private openNote(path: string) {
		if (this.demo) return;
		void this.app.workspace.openLinkText(path, '', 'tab');
	}

	private async write(fn: () => Promise<unknown>) {
		try {
			const r = await fn();
			if (r === false) this.hint = 'write conflict · datei geändert · neu laden';
		} catch (e) {
			this.hint = `write failed · ${(e as Error).message}`;
		}
		await this.refresh();
	}

	draw() {
		const root = this.contentEl;
		root.empty();
		root.addClass('ctrl');
		const data = this.data;
		if (!data) {
			root.createDiv({ cls: 'ctrl-empty', text: this.hint || 'lade …' });
			return;
		}
		const topics = this.visibleTopics();
		this.sig = computeSignals(topics, data.events, { ref: this.today, win: this.win, staleDays: this.staleDays });
		this.renderHeader(root);
		this.renderStatusLine(root);
		const stage = root.createDiv({ cls: 'ctrl-stage' });
		this.renderNet(stage.createDiv({ cls: 'ctrl-card ctrl-net-card' }), topics);
		this.renderDetail(stage.createDiv({ cls: 'ctrl-card ctrl-detail' }), topics);
		this.renderUnassigned(root);
	}

	// ── header ─────────────────────────────────────────────
	private renderHeader(root: HTMLElement) {
		const h = root.createDiv({ cls: 'ctrl-head' });
		const crumbs = h.createDiv({ cls: 'ctrl-crumbs' });
		const t = this.topic(this.sel);
		const all = crumbs.createSpan({ text: 'Alle Themen', cls: t ? 'ctrl-link' : 'ctrl-strong' });
		all.onclick = () => {
			this.sel = null;
			this.draw();
		};
		if (t) {
			crumbs.createSpan({ text: ' › ', cls: 'ctrl-mono ctrl-muted' });
			crumbs.createSpan({ text: `${t.id} ${t.name}`, cls: 'ctrl-strong' });
		}
		const main = this.data?.main?.mainTrack;
		if (main) crumbs.createSpan({ text: `   main · ${main}`, cls: 'ctrl-mono ctrl-muted ctrl-small' });
		const right = h.createDiv({ cls: 'ctrl-head-right' });
		const seg = right.createDiv({ cls: 'ctrl-seg' });
		for (const [m, label] of [
			['28', '28 d'],
			['jahr', 'jahr'],
		] as const) {
			const b = seg.createEl('button', { text: label, cls: this.mode === m ? 'is-active' : '' });
			b.onclick = () => {
				this.mode = m;
				this.draw();
			};
		}
		const r = right.createEl('button', { text: this.runde ? 'runde · an' : 'runde · aus', cls: 'ctrl-btn' + (this.runde ? ' is-active' : '') });
		r.onclick = () => {
			this.runde = !this.runde;
			if (this.sel && !this.topic(this.sel)) this.sel = null;
			this.draw();
		};
		const d = right.createEl('button', { text: this.demo ? 'demo · an' : 'demo · aus', cls: 'ctrl-btn' + (this.demo ? ' is-active' : '') });
		d.onclick = () => {
			this.demo = !this.demo;
			this.sel = null;
			this.hint = '';
			void this.refresh();
		};
		right.createSpan({ text: this.today, cls: 'ctrl-mono ctrl-small' });
		const re = right.createEl('button', { text: '↻', cls: 'ctrl-btn' });
		re.onclick = () => void this.refresh();
	}

	// ── status line ────────────────────────────────────────
	private renderStatusLine(root: HTMLElement) {
		const line = root.createDiv({ cls: 'ctrl-statusline' });
		line.createSpan({ text: `status · ${this.sel ?? '—'}`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const input = line.createEl('input', { type: 'text', placeholder: '[ID] [kw:] ein satz – enter setzt' });
		input.value = this.draft;
		const hint = line.createSpan({ cls: 'ctrl-mono ctrl-small ctrl-muted ctrl-hint' });
		const showHint = () => {
			const cmd = parseStatusInput(input.value, this.visibleTopics().map((t) => t.id));
			if (this.hint && !input.value) hint.setText(this.hint);
			else if (cmd?.kw || cmd?.id) hint.setText(`→ ${cmd.id ?? this.sel ?? '?'} ${cmd.kw ?? ''}`);
			else hint.setText(STATUS_KWS.join(' · '));
			hint.toggleClass('ctrl-energy', this.hint.startsWith('write') && !input.value);
		};
		showHint();
		input.oninput = () => {
			this.draft = input.value;
			showHint();
		};
		input.onkeydown = (ev) => {
			if (ev.key === 'Escape') {
				input.value = this.draft = '';
				showHint();
				ev.stopPropagation();
			}
			if (ev.key !== 'Enter' || !this.data) return;
			const data = this.data;
			const value = input.value;
			this.hint = '';
			void this.write(async () => {
				const id = await this.service.applyStatus(data, value, this.sel);
				this.draft = '';
				this.sel = id;
			});
		};
	}

	// ── radial net (Stufe 0) ───────────────────────────────
	private renderNet(card: HTMLElement, topics: Topic[]) {
		// geometry and encoding follow the design reference (Board Phase 5) 1:1
		const s = svg('svg', { viewBox: '0 0 860 780', class: 'ctrl-net' }, card);
		const defs = svg('defs', {}, s);
		const pat = svg('pattern', { id: 'ctrl-grain', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, defs);
		svg('circle', { cx: 2, cy: 2, r: 0.8, class: 'ctrl-grain-dot' }, pat);
		const n = topics.length;
		for (const f of [0.25, 0.5, 0.75, 1]) svg('circle', { cx: C.x, cy: C.y, r: R0 + f * (RMAX - R0), class: 'ctrl-ring' }, s);
		if (!n) {
			const t = svg('text', { x: C.x, y: C.y, class: 'ctrl-center', 'text-anchor': 'middle' }, s);
			t.textContent = 'Keine Themen im Board-Ordner';
			return;
		}
		const step = 360 / n;
		const gap = n > 8 ? 5 : 8;
		const sigOf = (id: string) => this.sig.get(id) as Signals;
		const maxE = Math.max(1, ...topics.map((t) => sigOf(t.id).energy));
		const rOf = (e: number) => R0 + (e / maxE) * (RMAX - R0);
		const energyByRank = [...topics].map((t) => sigOf(t.id).energy).sort((a, b) => b - a);
		const pos = new Map(topics.map((t, i) => [t.id, i * step]));
		const neighbours = (id: string) => {
			const t = topics.find((x) => x.id === id);
			return new Set([id, ...(t?.needs ?? []), ...(t?.blockedBy ?? []), ...topics.filter((x) => x.needs.includes(id) || x.blockedBy.includes(id)).map((x) => x.id)]);
		};

		const hitG = svg('g', {}, s);
		const depG = svg('g', {}, s);
		const bodyG = svg('g', {}, s);
		const labelG = svg('g', {}, s);
		const groups = new Map<string, SVGElement[]>();
		const add = (id: string, e: SVGElement) => {
			const l = groups.get(id) ?? [];
			l.push(e);
			groups.set(id, l);
			return e;
		};

		topics.forEach((t, i) => {
			const k = sigOf(t.id);
			const ang = i * step;
			const a0 = ang - step / 2 + gap / 2;
			const a1 = ang + step / 2 - gap / 2;
			const rE = rOf(k.energy);
			const g = add(t.id, svg('g', { class: 'ctrl-sector' + (k.stale ? ' is-stale' : '') + (this.sel === t.id ? ' is-selected' : '') }, bodyG));
			const outline = k.blocked ? 'is-blocked' : k.stale ? 'is-stale' : '';
			svg('path', { d: sectorPath(R0, rE, a0, a1), class: 'ctrl-sector-fill ctrl-outline ' + outline }, g);

			// slices = goals: width = 8 % minimum + rest proportional to goal energy
			const goals = t.goals.filter((x) => x.steps.length || !x.implicit);
			const ge = goals.map((go) => k.events.filter((e) => e.goal === go.id).reduce((a, e) => a + e.conf, 0));
			const ssum = ge.reduce((a, b) => a + b, 0) || 1;
			const span = a1 - a0;
			const minW = goals.length ? span * 0.08 : 0;
			const free = span - minW * goals.length;
			let ga = a0;
			const bounds: number[] = [];
			goals.forEach((go, j) => {
				const gw = minW + (free * (ge[j] ?? 0)) / ssum;
				const done = go.steps.filter((x) => x.done).length;
				const pr = go.steps.length ? done / go.steps.length : 0;
				if (pr > 0 && rE > R0 + 1) svg('path', { d: sectorPath(R0, R0 + (rE - R0) * pr, ga + 0.6, ga + gw - 0.6), class: 'ctrl-progress' }, g);
				// step dots in the core on hover / selection (● done, ○ open)
				const dots = svg('g', { class: 'ctrl-dots' }, g);
				go.steps.slice(0, 9).forEach((st, q) => {
					const [x, y] = pol(R0 + 7 + q * 8, ga + gw / 2);
					svg('circle', { cx: x, cy: y, r: 2.4, class: 'ctrl-dot' + (st.done ? ' is-done' : '') }, dots);
				});
				ga += gw;
				bounds.push(ga);
			});
			for (const b of bounds.slice(0, -1)) {
				const [x1, y1] = pol(R0, b);
				const [x2, y2] = pol(Math.max(rE, R0 + 2), b);
				svg('line', { x1, y1, x2, y2, class: 'ctrl-slice-sep' }, g);
			}
			if (k.slop) svg('path', { d: sectorPath(R0, rE, a0, a1), fill: 'url(#ctrl-grain)' }, g);

			// Soll-Marke + Δ (only when flagged, as in the design)
			if (k.misallocFlag) {
				const rS = rOf(energyByRank[t.prio - 1] ?? 0);
				svg('path', { d: arcPath(rS, a0, a1), class: 'ctrl-soll' }, g);
				const [lx, ly] = pol(Math.max(rS, rE) + 12, ang + 7);
				const tx = svg('text', { x: lx, y: ly + 3, class: 'ctrl-delta', 'text-anchor': 'middle' }, g);
				tx.textContent = (k.misalloc > 0 ? '▲ +' : '▼ ') + String(k.misalloc);
			}
			// direction
			const [tx, ty] = pol(rE + (k.misallocFlag ? 22 : 6), ang);
			if (Math.abs(k.trend) < 0.12) svg('path', { d: `M ${tx} ${ty} m -3 0 l 6 0`, class: 'ctrl-trend is-flat' }, g);
			else svg('path', { d: arrow(tx, ty, ang - 90 + (k.trend > 0 ? 0 : 180), 6 + 12 * Math.abs(k.trend)), class: 'ctrl-trend' }, g);

			// radial label, mirrored on the left half
			const flip = ang > 180 && ang < 360;
			const [lx, ly] = pol(RMAX + 14, ang);
			const label = add(
				t.id,
				svg('text', { x: lx, y: ly + 3, class: 'ctrl-label' + (k.stale ? ' is-stale' : ''), 'text-anchor': flip ? 'end' : 'start', transform: `rotate(${flip ? ang + 90 : ang - 90} ${lx} ${ly})` }, labelG),
			);
			const kw = t.status.kw !== 'läuft' ? ` · ${t.status.kw}` : '';
			label.textContent = `${t.id}  ${short(t.name, 26)}${kw}`;

			const hit = svg('path', { d: sectorPath(R0, RMAX + 130, a0, a1), class: 'ctrl-hit' }, hitG);
			hit.onclick = () => {
				this.sel = this.sel === t.id ? null : t.id;
				this.draw();
			};
			hit.ondblclick = () => this.openNote(t.path);
			hit.onmouseenter = () => {
				const rel = neighbours(t.id);
				s.addClass('has-hover');
				g.addClass('is-hover');
				for (const [id, els] of groups) for (const e of els) e.toggleClass('is-related', rel.has(id));
				depG.querySelectorAll('[data-a]').forEach((d) => {
					const on = d.getAttribute('data-a') === t.id || d.getAttribute('data-b') === t.id;
					d.toggleClass('is-related', on);
				});
			};
			hit.onmouseleave = () => {
				s.removeClass('has-hover');
				g.removeClass('is-hover');
			};
		});

		// dependencies: hairline through the core; full band with arrow on hover
		for (const t of topics) {
			for (const from of new Set([...t.needs, ...t.blockedBy])) {
				const a = pos.get(from);
				const b = pos.get(t.id);
				if (a === undefined || b === undefined) continue;
				const supplier = topics.find((x) => x.id === from);
				const open = !supplier || supplier.status.kw !== 'fertig';
				const blk = t.blockedBy.includes(from) && open;
				const rr = R0 - 2;
				const [ax, ay] = pol(rr, a);
				const [bx, by] = pol(rr, b);
				const cls = (blk ? ' is-blocked' : '') + (open ? '' : ' is-closed');
				const line = svg('path', { d: `M ${ax} ${ay} Q ${C.x} ${C.y} ${bx} ${by}`, class: 'ctrl-dep' + cls, 'data-a': from, 'data-b': t.id }, depG);
				line.onclick = () => {
					this.sel = from;
					this.draw();
				};
				const w = 3;
				const [a0x, a0y] = pol(rr, a - w);
				const [a1x, a1y] = pol(rr, a + w);
				const [b0x, b0y] = pol(rr, b - w);
				const [b1x, b1y] = pol(rr, b + w);
				const band = `M ${a0x} ${a0y} A ${rr} ${rr} 0 0 1 ${a1x} ${a1y} Q ${C.x} ${C.y} ${b0x} ${b0y} A ${rr} ${rr} 0 0 1 ${b1x} ${b1y} Q ${C.x} ${C.y} ${a0x} ${a0y} Z`;
				svg('path', { d: band, class: 'ctrl-dep-band' + cls, 'data-a': from, 'data-b': t.id }, depG);
				const mx = ((ax + bx) / 2) * 0.5 + C.x * 0.5;
				const my = ((ay + by) / 2) * 0.5 + C.y * 0.5;
				svg('path', { d: arrow(mx, my, (Math.atan2(by - my, bx - mx) * 180) / Math.PI, 8), class: 'ctrl-dep-arrow' + cls, 'data-a': from, 'data-b': t.id }, depG);
			}
		}

		const evs = this.windowEvents();
		const c1 = svg('text', { x: C.x, y: C.y - 2, class: 'ctrl-center', 'text-anchor': 'middle' }, s);
		c1.textContent = `${evs.filter((e) => e.topic).length} ereignisse · ${this.win} d`;
		const c2 = svg('text', { x: C.x, y: C.y + 12, class: 'ctrl-center ctrl-center-2', 'text-anchor': 'middle' }, s);
		c2.textContent = `${evs.filter((e) => !e.topic).length} nicht zugeordnet`;

		const foot = card.createDiv({ cls: 'ctrl-legend ctrl-mono' });
		const legend = foot.createDiv();
		legend.createDiv({ text: 'radius = energie · slice = ziel (breite = anteil, füllung = fortschritt)' });
		legend.createDiv({ text: '▮ soll-marke + Δ = fehlallokation · pfeil = richtung · körnung = slop' });
		legend.createDiv({ text: 'gepunktet + blass = stale · farbe = nur blockiert' });
		foot.createDiv({ text: 'klick = detail · doppelklick = notiz · esc = übersicht', cls: 'ctrl-gesture' });
	}
	private windowEvents(): BoardEvent[] {
		const ref = this.today;
		return (this.data?.events ?? []).filter((e) => {
			const d = daysBetween(e.at, ref);
			return d >= 0 && d < this.win;
		});
	}

	// ── detail card ────────────────────────────────────────
	private renderDetail(card: HTMLElement, topics: Topic[]) {
		const t = this.topic(this.sel);
		if (!t) return this.renderOverview(card, topics);
		const sg = this.sig.get(t.id);
		if (!sg) return;
		const head = card.createDiv({ cls: 'ctrl-detail-head' });
		head.createSpan({ text: `${t.id} · thema`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const flags = [sg.blocked ? 'blockiert' : '', sg.slop ? 'slop' : '', sg.stale ? 'stale' : '', sg.misallocFlag ? `Δ ${sg.misalloc > 0 ? '+' : ''}${sg.misalloc}` : '', t.confidential ? 'vertraulich' : '']
			.filter(Boolean)
			.join(' · ');
		head.createSpan({ text: flags, cls: 'ctrl-mono ctrl-small' + (sg.blocked ? ' ctrl-energy' : ' ctrl-muted') });
		const name = card.createDiv({ text: t.name, cls: 'ctrl-name ctrl-link' });
		name.onclick = () => this.openNote(t.path);

		const actions = card.createDiv({ cls: 'ctrl-actions' });
		const btn = (label: string, fn: () => void) => {
			const b = actions.createEl('button', { text: label, cls: 'ctrl-btn' });
			b.onclick = fn;
		};
		btn('▲ priorität', () => this.data && void this.write(() => this.service.movePrio(this.data as BoardData, t.id, -1)));
		btn('▼ priorität', () => this.data && void this.write(() => this.service.movePrio(this.data as BoardData, t.id, 1)));
		btn('↗ notiz', () => this.openNote(t.path));

		const box = card.createDiv({ cls: 'ctrl-statusbox' });
		box.createDiv({ text: 'STATUS · MANUELL', cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		box.createDiv({ text: t.status.text || '—' });
		box.createDiv({ text: `${t.status.kw} · ${t.status.at ?? '—'}`, cls: 'ctrl-mono ctrl-small ctrl-muted' });

		const rows = card.createDiv({ cls: 'ctrl-rows' });
		const row = (k: string, v: string) => {
			const r = rows.createDiv({ cls: 'ctrl-row' });
			r.createSpan({ text: k });
			r.createSpan({ text: v, cls: 'ctrl-mono' });
		};
		row('Energie', `${sg.energy} · ${this.win} d`);
		row('Richtung', `${sg.trend > 0.12 ? '▲' : sg.trend < -0.12 ? '▼' : '–'} ${sg.prevEnergy} → ${sg.energy}`);
		row('Fortschritt', `${sg.done}/${sg.total} · ${Math.round(sg.progress * 100)} %`);
		row('Letzter Fortschritt', sg.staleDays === null ? 'nie datiert' : `vor ${sg.staleDays} d`);
		row('Priorität · Energie-Rang', `${t.prio} · ${sg.energyRank}`);
		row('Geprüft', t.reviewed ? `vor ${daysBetween(t.reviewed, this.today)} d` : '—');
		row('Rückführung', t.returnCondition || 'unbekannt');

		for (const g of t.goals) {
			this.section(card, g.implicit ? 'Schritte' : `${g.id} ${g.name}`);
			const list = card.createDiv({ cls: 'ctrl-list' });
			for (const st of g.steps) this.stepItem(list, t.path, st);
		}
		if (t.parallel.length) {
			this.section(card, 'Parallel');
			const list = card.createDiv({ cls: 'ctrl-list' });
			for (const st of t.parallel) this.stepItem(list, t.path, st);
		}
		const qs = t.questions.filter((q) => !q.done);
		if (qs.length) {
			this.section(card, 'Zu klären');
			const list = card.createDiv({ cls: 'ctrl-list' });
			for (const q of this.sortQuestions(qs)) this.questionItem(list, t, q, false);
		}

		const ch = chain(topics, t.id);
		if (ch.suppliers.length || ch.consumers.length) {
			this.section(card, 'Kette');
			const k = card.createDiv({ cls: 'ctrl-chain ctrl-mono' });
			const link = (id: string) => {
				const sp = k.createSpan({ text: id, cls: 'ctrl-link' + (t.blockedBy.includes(id) ? ' ctrl-energy' : '') });
				sp.onclick = () => {
					this.sel = id;
					this.draw();
				};
				k.createSpan({ text: ' ' });
			};
			ch.suppliers.forEach(link);
			k.createSpan({ text: '← ● → ', cls: 'ctrl-muted' });
			ch.consumers.forEach(link);
		}

		this.section(card, `Ereignisse · ${sg.events.length}`);
		const ev = card.createDiv({ cls: 'ctrl-list' });
		for (const e of sg.events.slice(0, 6)) {
			const r = ev.createDiv({ cls: 'ctrl-item ctrl-link' });
			r.createSpan({ text: `${mmdd(e.at)} · ${short(e.title, 32)}` });
			r.createSpan({ text: e.conf >= 1 ? 'thema' : 'link', cls: 'ctrl-mono ctrl-small ctrl-muted' });
			r.onclick = () => this.openNote(e.path);
		}
	}

	private renderOverview(card: HTMLElement, topics: Topic[]) {
		card.createDiv({ text: 'ÜBERSICHT', cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		const sigs = topics.map((t) => this.sig.get(t.id)).filter((x): x is Signals => !!x);
		const counts = card.createDiv({ cls: 'ctrl-counts' });
		const cnt = (n: number, label: string, hot = false) => {
			const c = counts.createDiv({ cls: 'ctrl-count' });
			c.createDiv({ text: String(n), cls: 'ctrl-mono ctrl-big' + (hot && n ? ' ctrl-energy' : '') });
			c.createDiv({ text: label, cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		};
		cnt(sigs.filter((s) => s.misallocFlag).length, 'Δ prio');
		cnt(sigs.filter((s) => s.slop).length, 'slop');
		cnt(sigs.filter((s) => s.stale).length, 'stale');
		cnt(sigs.filter((s) => s.blocked).length, 'blockiert', true);

		// Fokus
		const main = this.data?.main;
		const focus: { path: string; tag: string; step: Step }[] = [];
		for (const t of topics) for (const st of [...allSteps(t), ...t.parallel]) if (st.fokus && !st.done) focus.push({ path: t.path, tag: t.id, step: st });
		if (main) for (const st of main.focus) if (!st.done) focus.push({ path: main.path, tag: 'main', step: st });
		this.section(card, `Fokus · ${focus.length}`);
		const fl = card.createDiv({ cls: 'ctrl-list' });
		for (const f of focus) this.stepItem(fl, f.path, f.step, f.tag);
		if (!focus.length) fl.createDiv({ text: '#fokus an Schritten setzen', cls: 'ctrl-muted ctrl-small' });

		// Zu klären
		const qs: { t: Topic | null; q: Question; path: string }[] = [];
		for (const t of topics) for (const q of t.questions) if (!q.done) qs.push({ t, q, path: t.path });
		if (main) for (const q of main.questions) if (!q.done) qs.push({ t: null, q, path: main.path });
		const order: Question['kind'][] = ['entscheidung', 'frage', 'risiko'];
		qs.sort((a, b) => order.indexOf(a.q.kind) - order.indexOf(b.q.kind) || (a.t?.prio ?? 0) - (b.t?.prio ?? 0));
		this.section(card, `Zu klären · ${qs.length}`);
		const ql = card.createDiv({ cls: 'ctrl-list' });
		for (const x of qs) this.questionItem(ql, x.t, x.q, true, x.path);

		const evs = this.windowEvents();
		const un = evs.filter((e) => !e.topic).length;
		const rows = card.createDiv({ cls: 'ctrl-rows' });
		const row = (k: string, v: string) => {
			const r = rows.createDiv({ cls: 'ctrl-row' });
			r.createSpan({ text: k });
			r.createSpan({ text: v, cls: 'ctrl-mono' });
		};
		row('Ereignisse', `${evs.length - un} · ${this.win} d`);
		row('Nicht zugeordnet', `${un} · ${evs.length ? Math.round((un / evs.length) * 100) : 0} %`);
		row('Erledigt im Fenster', String(sigs.reduce((a, s) => a + s.doneInWindow, 0)));
	}

	private sortQuestions(qs: Question[]) {
		const order: Question['kind'][] = ['entscheidung', 'frage', 'risiko'];
		return [...qs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
	}

	private section(card: HTMLElement, title: string) {
		card.createDiv({ text: title.toUpperCase(), cls: 'ctrl-section ctrl-mono ctrl-tiny ctrl-muted' });
	}

	private stepItem(list: HTMLElement, path: string, st: Step, tag?: string) {
		const r = list.createDiv({ cls: 'ctrl-item' + (st.level ? ' is-sub' : '') });
		const box = r.createSpan({ text: st.done ? '☑' : '☐', cls: 'ctrl-box' });
		box.onclick = () => void this.write(() => this.service.toggle(path, st, !st.done));
		if (tag) {
			const tg = r.createSpan({ text: tag, cls: 'ctrl-mono ctrl-small ctrl-link' });
			tg.onclick = () => {
				this.sel = tag === 'main' ? null : tag;
				this.draw();
			};
		}
		r.createSpan({ text: st.text, cls: 'ctrl-grow' + (st.done ? ' is-done' : '') });
		r.createSpan({ text: [st.fokus ? 'fokus' : '', st.doneAt ? mmdd(st.doneAt) : ''].filter(Boolean).join(' · '), cls: 'ctrl-mono ctrl-small ctrl-muted' });
	}

	private questionItem(list: HTMLElement, t: Topic | null, q: Question, withTag: boolean, path = t?.path ?? '') {
		const r = list.createDiv({ cls: 'ctrl-item' });
		const box = r.createSpan({ text: KIND_MARK[q.kind], cls: 'ctrl-box ctrl-mono ctrl-kind-' + q.kind, attr: { 'aria-label': `${q.kind} erledigen` } });
		box.onclick = () => void this.write(() => this.service.toggle(path, q, true));
		if (withTag) {
			const tg = r.createSpan({ text: t?.id ?? 'main', cls: 'ctrl-mono ctrl-small ctrl-link' });
			tg.onclick = () => {
				this.sel = t?.id ?? null;
				this.draw();
			};
		}
		r.createSpan({ text: q.text.replace(/@\S+/g, '').trim(), cls: 'ctrl-grow' });
		if (q.persons.length) r.createSpan({ text: q.persons.map((p) => '@' + p).join(' '), cls: 'ctrl-mono ctrl-small ctrl-muted' });
	}

	// ── unassigned ─────────────────────────────────────────
	private renderUnassigned(root: HTMLElement) {
		const evs = this.windowEvents()
			.filter((e) => !e.topic)
			.sort((a, b) => b.at.localeCompare(a.at));
		const box = root.createDiv({ cls: 'ctrl-unassigned' });
		const left = box.createDiv();
		left.createDiv({ text: 'NICHT ZUGEORDNET', cls: 'ctrl-mono ctrl-tiny ctrl-muted' });
		left.createDiv({ text: String(evs.length), cls: 'ctrl-mono ctrl-big ctrl-secondary' });
		left.createDiv({ text: `notizen · ${this.win} d`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const t = this.topic(this.sel);
		left.createDiv({ text: t ? `→ ${t.id} setzt thema: ${t.id}` : 'thema wählen, dann → zuordnen', cls: 'ctrl-mono ctrl-small ctrl-muted' });
		const grid = box.createDiv({ cls: 'ctrl-ua-grid' });
		for (const e of evs.slice(0, 60)) {
			const it = grid.createDiv({ cls: 'ctrl-ua-item' });
			const lbl = it.createSpan({ text: `${mmdd(e.at)} · ${short(e.title, 28)}`, cls: 'ctrl-link ctrl-grow', attr: { title: e.path } });
			lbl.onclick = () => this.openNote(e.path);
			const b = it.createEl('button', { text: t ? `→ ${t.id}` : '→', cls: 'ctrl-btn ctrl-btn-xs' });
			b.disabled = !t;
			b.onclick = () => {
				if (!t) return;
				void this.write(() => this.service.assign(e.path, t)).then(() => new Notice(`${short(e.title, 30)} → ${t.id}`));
			};
		}
		if (evs.length > 60) grid.createDiv({ text: `+ ${evs.length - 60} weitere`, cls: 'ctrl-mono ctrl-small ctrl-muted' });
	}
}
