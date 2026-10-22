// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { installDomHelpers } from './sim/obsidian-mock';
import { CtrlView } from '../src/adapters/obsidian/ctrl-view';
import { BoardService } from '../src/application/board-service';
import { DemoSource, ReadOnlyWriter } from '../src/adapters/demo/demo-source';

type Internals = { demo: boolean; mode: string; t: number; sel: string | null; focus: string | null; stage: number; refresh(): Promise<void>; deeper(id: string | null): void; back(): void; drawBody(): void };

beforeAll(() => {
	installDomHelpers();
	window.requestAnimationFrame = (f: FrameRequestCallback) => window.setTimeout(() => f(0), 0);
});

async function view() {
	const clock = { today: () => '2026-10-21' };
	const svc = new BoardService(new DemoSource(), new ReadOnlyWriter(), clock);
	const v = new CtrlView({} as never, svc, svc, clock, () => 28);
	const x = v as unknown as Internals & { contentEl: HTMLElement };
	x.demo = true;
	await x.refresh();
	return x;
}

describe('CtrlView (sim)', () => {
	it('renders all zoom stages without throwing', async () => {
		const v = await view();
		expect(v.contentEl.querySelectorAll('.ctrl-sector').length).toBe(12);
		v.deeper('T02');
		expect(v.contentEl.querySelector('.is-exploded')).not.toBeNull();
		v.deeper(null);
		expect(v.contentEl.querySelector('.ctrl-graph')).not.toBeNull();
		expect(v.contentEl.querySelectorAll('.ctrl-commit').length).toBeGreaterThan(0);
		v.back();
		v.back();
		expect(v.stage).toBe(0);
		expect(v.focus).toBeNull();
	});
	it('shows goal-level ports in the graph', async () => {
		const v = await view();
		v.focus = v.sel = 'T03';
		v.drawBody();
		expect([...v.contentEl.querySelectorAll('.ctrl-port-label')].map((e) => e.textContent)).toContain('braucht T02.1');
	});
	it('moves the reference with the time series', async () => {
		const v = await view();
		v.mode = '28';
		v.t = 200;
		v.drawBody();
		expect(v.contentEl.querySelector('.ctrl-ref')?.textContent).toBe('2026-04-04 · 28 d');
	});
});
