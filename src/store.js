import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const now = () => new Date().toISOString();
const json = value => JSON.stringify(value ?? []);

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,current_revision_id TEXT);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT,result TEXT,agent_binding TEXT,FOREIGN KEY(document_id) REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,number INTEGER NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT,source_thread_ids TEXT NOT NULL DEFAULT '[]',UNIQUE(document_id,number),FOREIGN KEY(document_id) REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,anchor TEXT NOT NULL,status TEXT NOT NULL,orphaned INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,FOREIGN KEY(document_id) REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,author TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(thread_id) REFERENCES threads(id));
      CREATE TABLE IF NOT EXISTS review_rounds(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,base_revision_id TEXT NOT NULL,result_revision_id TEXT,started_at TEXT NOT NULL,completed_at TEXT,FOREIGN KEY(document_id) REFERENCES documents(id));`);
  }

  open(path, content, binding = null) {
    let doc = this.db.prepare("SELECT * FROM documents WHERE path=?").get(path);
    if (!doc) {
      doc = { id: randomUUID(), path, current_revision_id: null };
      this.db.prepare("INSERT INTO documents(id,path) VALUES(?,?)").run(doc.id, path);
    }
    const revision = this.addRevision(doc.id, content, "Review started", []);
    const session = { id: randomUUID(), documentId: doc.id, status: "open", startedAt: now() };
    this.db.prepare("INSERT INTO sessions(id,document_id,status,started_at,agent_binding) VALUES(?,?,?,?,?)")
      .run(session.id, doc.id, session.status, session.startedAt, binding ? JSON.stringify(binding) : null);
    this.db.prepare("INSERT INTO review_rounds(id,document_id,base_revision_id,started_at) VALUES(?,?,?,?)")
      .run(randomUUID(), doc.id, revision.id, now());
    return { document: { id: doc.id, path }, session, revision };
  }

  addRevision(documentId, content, reason = "Document changed", sourceThreadIds = []) {
    const hash = createHash("sha256").update(content).digest("hex");
    const existing = this.db.prepare("SELECT * FROM revisions WHERE document_id=? AND content_hash=? ORDER BY number DESC LIMIT 1").get(documentId, hash);
    const current = this.currentRevision(documentId);
    if (current?.content_hash === hash) return this.revision(current);
    const number = Number(this.db.prepare("SELECT COALESCE(MAX(number),0)+1 n FROM revisions WHERE document_id=?").get(documentId).n);
    const row = { id: randomUUID(), document_id: documentId, number, content, content_hash: hash, created_at: now(), reason, source_thread_ids: json(sourceThreadIds) };
    this.db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)").run(row.id,row.document_id,row.number,row.content,row.content_hash,row.created_at,row.reason,row.source_thread_ids);
    this.db.prepare("UPDATE documents SET current_revision_id=? WHERE id=?").run(row.id, documentId);
    return this.revision(row);
  }

  currentRevision(documentId) { return this.db.prepare("SELECT r.* FROM documents d JOIN revisions r ON r.id=d.current_revision_id WHERE d.id=?").get(documentId); }
  revision(row) { return { id: row.id, number: row.number, content: row.content, createdAt: row.created_at, reason: row.reason, sourceThreadIds: JSON.parse(row.source_thread_ids) }; }
  revisions(documentId) { return this.db.prepare("SELECT * FROM revisions WHERE document_id=? ORDER BY number").all(documentId).map(r => this.revision(r)); }
  revisionById(id) { const r = this.db.prepare("SELECT * FROM revisions WHERE id=?").get(id); return r && this.revision(r); }

  createThread(documentId, anchor, body) {
    const thread = { id: randomUUID(), documentId, anchor, status: "open", orphaned: false, createdAt: now() };
    this.db.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?)").run(thread.id,documentId,JSON.stringify(anchor),thread.status,0,thread.createdAt);
    this.addMessage(thread.id, "human", body);
    return this.thread(thread.id);
  }
  addMessage(threadId, author, content) {
    const msg = { id: randomUUID(), threadId, author, content: content.trim(), createdAt: now() };
    this.db.prepare("INSERT INTO messages VALUES(?,?,?,?,?)").run(msg.id,msg.threadId,msg.author,msg.content,msg.createdAt); return msg;
  }
  thread(id) {
    const r = this.db.prepare("SELECT * FROM threads WHERE id=?").get(id); if (!r) return null;
    return { id:r.id,documentId:r.document_id,anchor:JSON.parse(r.anchor),status:r.status,orphaned:Boolean(r.orphaned),createdAt:r.created_at,messages:this.db.prepare("SELECT id,thread_id threadId,author,content,created_at createdAt FROM messages WHERE thread_id=? ORDER BY created_at,id").all(id) };
  }
  threads(documentId) { return this.db.prepare("SELECT id FROM threads WHERE document_id=? ORDER BY created_at").all(documentId).map(r=>this.thread(r.id)); }
  setThreadStatus(id, status) { this.db.prepare("UPDATE threads SET status=? WHERE id=?").run(status,id); return this.thread(id); }
  updateAnchor(id, anchor, orphaned) { this.db.prepare("UPDATE threads SET anchor=?,orphaned=? WHERE id=?").run(JSON.stringify(anchor),orphaned?1:0,id); }
  finish(sessionId, result) { const at=now(); this.db.prepare("UPDATE sessions SET status='finished',completed_at=?,result=? WHERE id=?").run(at,result,sessionId); return at; }
  close() { this.db.close(); }
}
