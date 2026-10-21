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
	private hint = '';
	private draft = '';

	constructor(
		leaf: WorkspaceLeaf,
		private readonly service: BoardService,
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
			this.render();
			return false;
		});
		await this.refresh();
	}

	async refresh() {
		try {
			this.data = await this.service.load();
		} catch (e) {
			this.hint = `load failed · ${(e as Error).message}`;
		}
		this.render();
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
	private open(path: string) {
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

	render() {
		const root = this.contentEl;
		root.empty();
		root.addClass('ctrl');
		const data = this.data;
		if (!data) {
			root.createDiv({ cls: 'ctrl-empty', text: this.hint || 'lade …' });
			return;
		}
		const topics = this.visibleTopics();
		this.sig = computeSignals(topics, data.events, { ref: this.clock.today(), win: this.win, staleDays: this.staleDays });
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
			this.render();
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
				this.render();
			};
		}
		const r = right.createEl('button', { text: this.runde ? 'runde · an' : 'runde · aus', cls: 'ctrl-btn' + (this.runde ? ' is-active' : '') });
		r.onclick = () => {
			this.runde = !this.runde;
			if (this.sel && !this.topic(this.sel)) this.sel = null;
			this.render();
		};
		right.createSpan({ text: this.clock.today(), cls: 'ctrl-mono ctrl-small' });
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
		const s = svg('svg', { viewBox: '0 0 860 780', class: 'ctrl-net' }, card);
		const defs = svg('defs', {}, s);
		const pat = svg('pattern', { id: 'ctrl-grain', width: 4, height: 4, patternUnits: 'userSpaceOnUse' }, defs);
		svg('circle', { cx: 2, cy: 2, r: 0.8, class: 'ctrl-grain-dot' }, pat);
		for (const p of [0.25, 0.5, 0.75, 1]) svg('circle', { cx: C.x, cy: C.y, r: R0 + (RMAX - R0) * p, class: 'ctrl-ring' }, s);
		svg('circle', { cx: C.x, cy: C.y, r: R0, class: 'ctrl-ring' }, s);

		const n = topics.length;
		if (!n) {
			const t = svg('text', { x: C.x, y: C.y, class: 'ctrl-center', 'text-anchor': 'middle' }, s);
			t.textContent = 'Keine Themen im Board-Ordner';
			return;
		}
		const step = 360 / n;
		const gap = n > 8 ? 5 : 8;
		const maxE = Math.max(1, ...topics.map((t) => this.sig.get(t.id)?.energy ?? 0));
		const rOf = (e: number) => R0 + 14 + (RMAX - R0 - 14) * (e / maxE);
		const byRank = new Map(topics.map((t) => [this.sig.get(t.id)?.energyRank ?? 0, this.sig.get(t.id)?.energy ?? 0]));
		const mid = new Map(topics.map((t, i) => [t.id, i * step]));

		// dependencies (under sectors)
		const depG = svg('g', { class: 'ctrl-deps' }, s);
		for (const t of topics) {
			for (const need of new Set([...t.needs, ...t.blockedBy])) {
				const a = mid.get(need);
				const b = mid.get(t.id);
				if (a === undefined || b === undefined) continue;
				const [x0, y0] = pol(R0, a);
				const [x1, y1] = pol(R0, b);
				const blocked = t.blockedBy.includes(need);
				svg('path', { d: `M${x0},${y0} Q${C.x},${C.y} ${x1},${y1}`, class: 'ctrl-dep' + (blocked ? ' is-blocked' : ''), 'data-from': need, 'data-to': t.id }, depG);
				svg('circle', { cx: x1, cy: y1, r: 2.4, class: 'ctrl-dep-end' + (blocked ? ' is-blocked' : '') }, depG);
			}
		}

		const groups: SVGGElement[] = [];
		topics.forEach((t, i) => {
			const sg = this.sig.get(t.id);
			if (!sg) return;
			const m = i * step;
			const a0 = m - step / 2 + gap / 2;
			const a1 = m + step / 2 - gap / 2;
			const rE = rOf(sg.energy);
			const g = svg('g', { class: 'ctrl-sector' + (this.sel === t.id ? ' is-selected' : '') + (sg.stale ? ' is-stale' : ''), 'data-id': t.id }, s);
			groups.push(g);
			svg('path', { d: sectorPath(R0, rE, a0, a1), class: 'ctrl-sector-fill' }, g);

			// slices per goal (only explicit goals)
			const goals = t.goals.filter((x) => !x.implicit);
			const parts: { a0: number; a1: number; progress: number }[] = [];
			if (goals.length > 1) {
				const w = goals.map((go) => {
					const e = sg.events.filter((ev) => ev.goal === go.id).length;
					return e || go.steps.length || 1;
				});
				const sum = w.reduce((x, y) => x + y, 0);
				const span = a1 - a0;
				const min = span * 0.08;
				const rest = span - min * goals.length;
				let cur = a0;
				goals.forEach((go, k) => {
					const width = min + (rest * (w[k] ?? 0)) / sum;
					const done = go.steps.filter((x) => x.done).length;
					parts.push({ a0: cur, a1: cur + width, progress: go.steps.length ? done / go.steps.length : 0 });
					cur += width;
				});
			} else parts.push({ a0, a1, progress: sg.progress });
			for (const p of parts) {
				if (p.progress > 0) svg('path', { d: sectorPath(R0, R0 + (rE - R0) * p.progress, p.a0, p.a1), class: 'ctrl-progress' }, g);
			}
			for (const p of parts.slice(1)) {
				const [x0, y0] = pol(R0, p.a0);
				const [x1, y1] = pol(rE, p.a0);
				svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'ctrl-slice-sep' }, g);
			}
			if (sg.slop) svg('path', { d: sectorPath(R0, rE, a0, a1), fill: 'url(#ctrl-grain)', class: 'ctrl-slop' }, g);
			svg('path', { d: sectorPath(R0, rE, a0, a1), class: 'ctrl-outline' + (sg.blocked ? ' is-blocked' : '') }, g);

			// Soll-Marke + Δ
			if (sg.misalloc !== 0) {
				const rS = rOf(byRank.get(t.prio) ?? 0);
				svg('path', { d: arcPath(rS, a0 + 1, a1 - 1), class: 'ctrl-soll' }, g);
				if (sg.misallocFlag) {
					const [x, y] = pol(Math.max(rS, rE) + 12, m + 7);
					const tx = svg('text', { x, y, class: 'ctrl-delta', 'text-anchor': 'middle' }, g);
					tx.textContent = sg.misalloc > 0 ? `▲ +${sg.misalloc}` : `▼ ${sg.misalloc}`;
				}
			}
			// direction
			if (Math.abs(sg.trend) < 0.12) {
				const [x0, y0] = pol(rE + 6, m - 2);
				const [x1, y1] = pol(rE + 6, m + 2);
				svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'ctrl-trend' }, g);
			} else {
				const len = 6 + 12 * Math.abs(sg.trend);
				const from = sg.trend > 0 ? rE + 4 : rE + 4 + len;
				const to = sg.trend > 0 ? rE + 4 + len : rE + 4;
				const [x0, y0] = pol(from, m);
				const [x1, y1] = pol(to, m);
				const [hx0, hy0] = pol(to + (sg.trend > 0 ? -4 : 4), m - 1.5);
				const [hx1, hy1] = pol(to + (sg.trend > 0 ? -4 : 4), m + 1.5);
				svg('path', { d: `M${x0},${y0} L${x1},${y1} M${hx0},${hy0} L${x1},${y1} L${hx1},${hy1}`, class: 'ctrl-trend' }, g);
			}
			// label
			const [lx, ly] = pol(RMAX + 30, m);
			const anchor = Math.abs(lx - C.x) < 8 ? 'middle' : lx > C.x ? 'start' : 'end';
			const label = svg('text', { x: lx, y: ly + 4, class: 'ctrl-label' + (sg.stale ? ' is-stale' : ''), 'text-anchor': anchor }, g);
			const idSpan = svg('tspan', { class: 'ctrl-label-id' }, label);
			idSpan.textContent = `${t.id}  `;
			const nm = svg('tspan', {}, label);
			nm.textContent = short(t.name, 26) + (t.status.kw !== 'läuft' ? ` · ${t.status.kw}` : '');
			const flags = [sg.blocked ? 'blockiert' : '', sg.slop ? 'slop' : '', sg.stale ? 'stale' : '', t.confidential ? 'vertraulich' : ''].filter(Boolean);
			if (flags.length) {
				const fl = svg('text', { x: lx, y: ly + 17, class: 'ctrl-label-flags' + (sg.blocked ? ' is-blocked' : ''), 'text-anchor': anchor }, g);
				fl.textContent = flags.join(' · ');
			}
			// hit area
			const hit = svg('path', { d: sectorPath(R0, RMAX + 20, a0, a1), class: 'ctrl-hit' }, g);
			hit.onclick = () => {
				this.sel = this.sel === t.id ? null : t.id;
				this.render();
			};
			hit.ondblclick = () => this.open(t.path);
			const related = new Set([t.id, ...t.needs, ...t.blockedBy, ...topics.filter((x) => x.needs.includes(t.id) || x.blockedBy.includes(t.id)).map((x) => x.id)]);
			hit.onmouseenter = () => {
				s.addClass('has-hover');
				for (const gg of groups) gg.toggleClass('is-related', related.has(gg.getAttribute('data-id') ?? ''));
				depG.querySelectorAll('.ctrl-dep').forEach((d) => d.toggleClass('is-related', d.getAttribute('data-from') === t.id || d.getAttribute('data-to') === t.id));
			};
			hit.onmouseleave = () => s.removeClass('has-hover');
		});

		const evs = this.windowEvents();
		const c1 = svg('text', { x: C.x, y: C.y - 2, class: 'ctrl-center', 'text-anchor': 'middle' }, s);
		c1.textContent = `${evs.filter((e) => e.topic).length} ereignisse · ${this.win} d`;
		const c2 = svg('text', { x: C.x, y: C.y + 12, class: 'ctrl-center ctrl-center-2', 'text-anchor': 'middle' }, s);
		c2.textContent = `${evs.filter((e) => !e.topic).length} nicht zugeordnet`;

		const legend = card.createDiv({ cls: 'ctrl-legend ctrl-mono' });
		legend.createDiv({ text: 'radius = energie (notizen mit thema/link im fenster) · füllung = fortschritt · bogen = soll laut priorität · pfeil = richtung' });
		legend.createDiv({ text: 'gepunktet = stale · körnung = slop (aktivität ohne fortschritt) · farbe = nur blockiert' });
		legend.createDiv({ text: 'klick = detail · doppelklick = notiz öffnen · esc = übersicht' });
	}

	private windowEvents(): BoardEvent[] {
		const ref = this.clock.today();
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
		name.onclick = () => this.open(t.path);

		const actions = card.createDiv({ cls: 'ctrl-actions' });
		const btn = (label: string, fn: () => void) => {
			const b = actions.createEl('button', { text: label, cls: 'ctrl-btn' });
			b.onclick = fn;
		};
		btn('▲ priorität', () => this.data && void this.write(() => this.service.movePrio(this.data as BoardData, t.id, -1)));
		btn('▼ priorität', () => this.data && void this.write(() => this.service.movePrio(this.data as BoardData, t.id, 1)));
		btn('↗ notiz', () => this.open(t.path));

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
		row('Geprüft', t.reviewed ? `vor ${daysBetween(t.reviewed, this.clock.today())} d` : '—');
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
					this.render();
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
			r.onclick = () => this.open(e.path);
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
				this.render();
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
				this.render();
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
			lbl.onclick = () => this.open(e.path);
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
