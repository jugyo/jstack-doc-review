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
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,author TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,agent_status TEXT,FOREIGN KEY(thread_id) REFERENCES threads(id));
      CREATE TABLE IF NOT EXISTS agent_events(id TEXT PRIMARY KEY,message_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(message_id) REFERENCES messages(id));
      CREATE TABLE IF NOT EXISTS review_rounds(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,base_revision_id TEXT NOT NULL,result_revision_id TEXT,started_at TEXT NOT NULL,completed_at TEXT,FOREIGN KEY(document_id) REFERENCES documents(id));`);
    this.ensureColumn("messages", "agent_status", "TEXT");
    this.migrateAgentMessages();
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
    const msg = { id: randomUUID(), threadId, author, content: content.trim(), createdAt: now(), agentStatus: author === "human" ? "received" : null };
    this.db.prepare("INSERT INTO messages(id,thread_id,author,content,created_at,agent_status) VALUES(?,?,?,?,?,?)")
      .run(msg.id,msg.threadId,msg.author,msg.content,msg.createdAt,msg.agentStatus);
    if (author === "human") this.db.prepare("INSERT INTO agent_events VALUES(?,?,?,?)").run(randomUUID(),msg.id,"pending",msg.createdAt);
    return msg;
  }
  thread(id) {
    const r = this.db.prepare("SELECT * FROM threads WHERE id=?").get(id); if (!r) return null;
    return { id:r.id,documentId:r.document_id,anchor:JSON.parse(r.anchor),status:r.status,orphaned:Boolean(r.orphaned),createdAt:r.created_at,messages:this.db.prepare("SELECT id,thread_id threadId,author,content,created_at createdAt,agent_status agentStatus FROM messages WHERE thread_id=? ORDER BY created_at,id").all(id) };
  }
  threads(documentId) { return this.db.prepare("SELECT id FROM threads WHERE document_id=? ORDER BY created_at").all(documentId).map(r=>this.thread(r.id)); }
  threadBelongsToDocument(documentId, threadId) { return Boolean(this.db.prepare("SELECT 1 FROM threads WHERE id=? AND document_id=?").get(threadId,documentId)); }
  setThreadStatus(id, status) { this.db.prepare("UPDATE threads SET status=? WHERE id=?").run(status,id); return this.thread(id); }
  updateAnchor(id, anchor, orphaned) { this.db.prepare("UPDATE threads SET anchor=?,orphaned=? WHERE id=?").run(JSON.stringify(anchor),orphaned?1:0,id); }
  agentEvents(documentId) { return this.db.prepare("SELECT e.id,e.message_id messageId,e.status,m.thread_id threadId FROM agent_events e JOIN messages m ON m.id=e.message_id JOIN threads t ON t.id=m.thread_id WHERE t.document_id=? AND e.status!='completed' ORDER BY e.created_at,e.id").all(documentId); }
  agentEventForMessage(messageId) { return this.db.prepare("SELECT e.id,e.message_id messageId,e.status,m.thread_id threadId FROM agent_events e JOIN messages m ON m.id=e.message_id WHERE e.message_id=?").get(messageId); }
  setAgentStatus(documentId, threadId, messageId, status) {
    const message = this.db.prepare("SELECT m.id,m.thread_id threadId,m.author,m.content,m.created_at createdAt,m.agent_status agentStatus FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.id=? AND m.thread_id=? AND t.document_id=? AND m.author='human'").get(messageId,threadId,documentId);
    if (!message) return null;
    const eventStatus = status === "received" ? "pending" : status === "processing" ? "processing" : "completed";
    this.db.prepare("UPDATE messages SET agent_status=? WHERE id=?").run(status,messageId);
    this.db.prepare("UPDATE agent_events SET status=? WHERE message_id=?").run(eventStatus,messageId);
    return {...message,agentStatus:status};
  }
  finish(sessionId, result) { const at=now(); this.db.prepare("UPDATE sessions SET status='finished',completed_at=?,result=? WHERE id=?").run(at,result,sessionId); return at; }
  close() { this.db.close(); }
  ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  migrateAgentMessages() {
    this.db.prepare("UPDATE messages SET agent_status='received' WHERE author='human' AND agent_status IS NULL").run();
    const messages = this.db.prepare("SELECT m.id,m.created_at createdAt FROM messages m LEFT JOIN agent_events e ON e.message_id=m.id WHERE m.author='human' AND e.id IS NULL").all();
    const insert = this.db.prepare("INSERT OR IGNORE INTO agent_events VALUES(?,?,?,?)");
    for (const message of messages) insert.run(randomUUID(),message.id,"pending",message.createdAt);
  }
}
