import type { BoardData, StatusKw } from '../domain/model';

export interface BoardSource {
	load(): Promise<BoardData>;
}

export interface BoardWriter {
	setStatus(topicPath: string, kw: StatusKw, text: string, at: string): Promise<void>;
	/** Rewrites one line if it still equals `expected`; returns false on conflict. */
	replaceLine(path: string, line: number, expected: string, next: string): Promise<boolean>;
	setPrio(topicPath: string, prio: number): Promise<void>;
	assignTopic(notePath: string, topicId: string): Promise<void>;
}

export interface Clock {
	today(): string;
}
