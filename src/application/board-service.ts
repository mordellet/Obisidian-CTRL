// Use cases of the board. Depend on ports and domain only.
import type { BoardData, Question, Step, Topic } from '../domain/model';
import { toggleTaskLine } from '../domain/parse';
import { parseStatusInput } from '../domain/status-input';
import type { BoardSource, BoardWriter, Clock } from '../ports/board';

export class BoardService {
	constructor(
		private readonly source: BoardSource,
		private readonly writer: BoardWriter,
		private readonly clock: Clock,
	) {}

	load(): Promise<BoardData> {
		return this.source.load();
	}

	/** Applies the status line to `fallback` unless the input names another topic. */
	async applyStatus(data: BoardData, input: string, fallback: string | null): Promise<string> {
		const cmd = parseStatusInput(
			input,
			data.topics.map((t) => t.id),
		);
		if (!cmd) throw new Error('leere eingabe');
		const id = cmd.id ?? fallback;
		const topic = data.topics.find((t) => t.id === id);
		if (!topic) throw new Error('kein thema gewählt');
		const kw = cmd.kw ?? topic.status.kw;
		const text = cmd.text || topic.status.text;
		await this.writer.setStatus(topic.path, kw, text, this.clock.today());
		return topic.id;
	}

	async toggle(path: string, item: Step | Question, done: boolean): Promise<boolean> {
		const next = toggleTaskLine(item.raw, done, this.clock.today());
		return this.writer.replaceLine(path, item.line, item.raw, next);
	}

	/** Swap priority with the neighbour (dir -1 = up). */
	async movePrio(data: BoardData, id: string, dir: -1 | 1): Promise<void> {
		const sorted = [...data.topics].sort((a, b) => a.prio - b.prio);
		const i = sorted.findIndex((t) => t.id === id);
		const j = i + dir;
		const a = sorted[i];
		const b = sorted[j];
		if (!a || !b) return;
		await this.writer.setPrio(a.path, b.prio);
		await this.writer.setPrio(b.path, a.prio);
	}

	assign(notePath: string, topic: Topic): Promise<void> {
		return this.writer.assignTopic(notePath, topic.id);
	}
}
