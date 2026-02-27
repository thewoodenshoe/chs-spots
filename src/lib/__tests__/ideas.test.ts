/**
 * @jest-environment node
 */

const mockDb = {
  statements: new Map<string, { run: jest.Mock; get: jest.Mock; all: jest.Mock }>(),
  prepare(sql: string) {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, { run: jest.fn(), get: jest.fn(), all: jest.fn() });
    }
    return this.statements.get(sql)!;
  },
  reset() {
    this.statements.clear();
  },
};

jest.mock('../db', () => {
  const actual: Record<string, unknown> = {};

  const getDb = () => mockDb;

  const ideas = {
    add(text: string) {
      const stmt = getDb().prepare('INSERT INTO ideas (text) VALUES (?)');
      const result = stmt.run(text);
      return getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(result.lastInsertRowid);
    },
    getOpen() {
      return getDb().prepare("SELECT * FROM ideas WHERE status = 'open' ORDER BY created_at ASC").all();
    },
    getAll() {
      return getDb().prepare('SELECT * FROM ideas ORDER BY created_at DESC').all();
    },
    resolve(id: number) {
      const result = getDb().prepare("UPDATE ideas SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(id);
      return result.changes > 0;
    },
    setStatus(id: number, status: string) {
      const result = getDb().prepare('UPDATE ideas SET status = ? WHERE id = ?').run(status, id);
      return result.changes > 0;
    },
  };

  return { ...actual, getDb, ideas };
});

import { ideas } from '../db';

describe('ideas DAL', () => {
  beforeEach(() => {
    mockDb.reset();
  });

  it('add() inserts and returns the new idea', () => {
    const insertStmt = mockDb.prepare('INSERT INTO ideas (text) VALUES (?)');
    insertStmt.run.mockReturnValue({ lastInsertRowid: 42 });
    const selectStmt = mockDb.prepare('SELECT * FROM ideas WHERE id = ?');
    selectStmt.get.mockReturnValue({ id: 42, text: 'Build dark mode', status: 'open', created_at: '2026-02-27', resolved_at: null });

    const result = ideas.add('Build dark mode');
    expect(insertStmt.run).toHaveBeenCalledWith('Build dark mode');
    expect(selectStmt.get).toHaveBeenCalledWith(42);
    expect(result).toEqual({ id: 42, text: 'Build dark mode', status: 'open', created_at: '2026-02-27', resolved_at: null });
  });

  it('getOpen() returns only open ideas ordered by date', () => {
    const stmt = mockDb.prepare("SELECT * FROM ideas WHERE status = 'open' ORDER BY created_at ASC");
    const openIdeas = [
      { id: 1, text: 'Idea A', status: 'open', created_at: '2026-02-25', resolved_at: null },
      { id: 3, text: 'Idea C', status: 'open', created_at: '2026-02-27', resolved_at: null },
    ];
    stmt.all.mockReturnValue(openIdeas);

    expect(ideas.getOpen()).toEqual(openIdeas);
    expect(stmt.all).toHaveBeenCalled();
  });

  it('getOpen() returns empty array when no ideas exist', () => {
    const stmt = mockDb.prepare("SELECT * FROM ideas WHERE status = 'open' ORDER BY created_at ASC");
    stmt.all.mockReturnValue([]);
    expect(ideas.getOpen()).toEqual([]);
  });

  it('resolve() marks an idea as resolved', () => {
    const stmt = mockDb.prepare("UPDATE ideas SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?");
    stmt.run.mockReturnValue({ changes: 1 });
    expect(ideas.resolve(5)).toBe(true);
    expect(stmt.run).toHaveBeenCalledWith(5);
  });

  it('resolve() returns false for nonexistent idea', () => {
    const stmt = mockDb.prepare("UPDATE ideas SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?");
    stmt.run.mockReturnValue({ changes: 0 });
    expect(ideas.resolve(999)).toBe(false);
  });

  it('setStatus() updates the status field', () => {
    const stmt = mockDb.prepare('UPDATE ideas SET status = ? WHERE id = ?');
    stmt.run.mockReturnValue({ changes: 1 });
    expect(ideas.setStatus(3, 'in_progress')).toBe(true);
    expect(stmt.run).toHaveBeenCalledWith('in_progress', 3);
  });

  it('getAll() returns all ideas in descending order', () => {
    const stmt = mockDb.prepare('SELECT * FROM ideas ORDER BY created_at DESC');
    const allIdeas = [
      { id: 3, text: 'Idea C', status: 'open', created_at: '2026-02-27', resolved_at: null },
      { id: 2, text: 'Idea B', status: 'resolved', created_at: '2026-02-26', resolved_at: '2026-02-27' },
    ];
    stmt.all.mockReturnValue(allIdeas);
    expect(ideas.getAll()).toEqual(allIdeas);
  });
});
