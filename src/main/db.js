'use strict';
// Banco local em SQLite (sql.js / WebAssembly — sem módulo nativo para compilar).
// O arquivo inteiro é regravado de forma atômica (tmp + rename) a cada alteração.
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);

  CREATE TABLE pacientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL UNIQUE,
    email TEXT,
    telefone TEXT,
    valor_padrao REAL,
    benef_nome TEXT,
    benef_cpf TEXT,
    benef_nasc TEXT,
    cep TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT, municipio_ibge TEXT,
    observacao TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ambiente TEXT NOT NULL,
    paciente_id INTEGER REFERENCES pacientes(id),
    tomador_nome TEXT NOT NULL,
    tomador_cpf TEXT NOT NULL,
    tomador_email TEXT,
    benef_nome TEXT,
    benef_cpf TEXT,
    benef_nasc TEXT,
    data_servico TEXT NOT NULL,
    valor REAL NOT NULL,
    discriminacao TEXT NOT NULL,
    serie TEXT,
    n_dps INTEGER,
    id_dps TEXT,
    status TEXT NOT NULL CHECK (status IN
      ('rascunho','enviando','incerta','autorizada','rejeitada','cancelada')),
    chave_acesso TEXT,
    numero_nfse TEXT,
    codigo_verificacao TEXT,
    xml_path TEXT,
    pdf_path TEXT,
    mensagens TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    atualizado_em TEXT,
    emitida_em TEXT,
    cancelada_em TEXT,
    motivo_cancelamento TEXT,
    UNIQUE (ambiente, serie, n_dps)
  );
  CREATE INDEX idx_notas_data ON notas(ambiente, data_servico);
  CREATE INDEX idx_notas_status ON notas(status);

  CREATE TABLE eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nota_id INTEGER,
    tipo TEXT NOT NULL,
    detalhe TEXT,
    request TEXT,
    response TEXT,
    em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `,
];

class Database {
  static async open(file) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
    const db = new Database();
    db.file = file;
    db.sql = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    db.sql.run('PRAGMA foreign_keys = ON;');
    db.migrate();
    return db;
  }

  migrate() {
    const current = this.sql.exec('PRAGMA user_version;')[0].values[0][0];
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.sql.exec('BEGIN;');
      try {
        this.sql.exec(MIGRATIONS[v]);
        this.sql.exec(`PRAGMA user_version = ${v + 1};`);
        this.sql.exec('COMMIT;');
      } catch (e) {
        this.sql.exec('ROLLBACK;');
        throw e;
      }
    }
    if (current < MIGRATIONS.length) this.persist();
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.sql.export()));
    fs.renameSync(tmp, this.file);
    // sql.js desliga foreign_keys após export(); religa.
    this.sql.run('PRAGMA foreign_keys = ON;');
  }

  all(query, params = []) {
    const stmt = this.sql.prepare(query);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(query, params = []) {
    return this.all(query, params)[0];
  }

  /** Executa um comando de escrita e grava em disco. Retorna o último id inserido. */
  run(query, params = []) {
    this.sql.run(query, params);
    const id = this.sql.exec('SELECT last_insert_rowid();')[0].values[0][0];
    if (!this._inTx) this.persist();
    return id;
  }

  /** Várias escritas atômicas, uma única gravação em disco. */
  tx(fn) {
    if (this._inTx) return fn();
    this.sql.exec('BEGIN;');
    this._inTx = true;
    try {
      const r = fn();
      this.sql.exec('COMMIT;');
      this._inTx = false;
      this.persist();
      return r;
    } catch (e) {
      this._inTx = false;
      try { this.sql.exec('ROLLBACK;'); } catch (_) { /* já revertido */ }
      throw e;
    }
  }

  close() {
    this.sql.close();
  }
}

module.exports = { Database };
