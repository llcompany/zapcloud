/**
 * Mock do PrismaClient para testes locais sem banco de dados.
 * Simula as operações básicas em memória.
 */

const store = {
  users: [],
  wabaAccounts: [],
  contacts: [],
  messages: [],
  templates: [],
};

let idCounter = 1;
const genId = () => `mock-id-${idCounter++}`;

const makeMock = (table) => ({
  findUnique: async ({ where }) => {
    const [key, val] = Object.entries(where)[0];
    return store[table].find((r) => r[key] === val) || null;
  },
  findFirst: async ({ where }) => {
    return store[table].find((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v)
    ) || null;
  },
  findMany: async ({ where = {}, orderBy, skip = 0, take = 50 } = {}) => {
    let results = store[table].filter((r) =>
      Object.entries(where).every(([k, v]) => {
        if (typeof v === 'object' && v !== null) return true;
        return r[k] === v;
      })
    );
    return results.slice(skip, skip + take);
  },
  create: async ({ data, select }) => {
    // Defaults por tabela
    const defaults = {
      users: { role: 'USER', isActive: true },
      wabaAccounts: { isActive: true, webhookVerified: false },
      contacts: { isBlocked: false, tags: [] },
      messages: { status: 'PENDING' },
      templates: { status: 'PENDING', language: 'pt_BR' },
    };
    const record = { id: genId(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[table] || {}), ...data };
    store[table].push(record);
    if (select) {
      return Object.fromEntries(Object.keys(select).map((k) => [k, record[k]]));
    }
    return record;
  },
  update: async ({ where, data }) => {
    const idx = store[table].findIndex((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v)
    );
    if (idx === -1) return null;
    store[table][idx] = { ...store[table][idx], ...data, updatedAt: new Date() };
    return store[table][idx];
  },
  updateMany: async ({ where, data }) => {
    store[table].forEach((r, idx) => {
      if (Object.entries(where).every(([k, v]) => r[k] === v)) {
        store[table][idx] = { ...r, ...data };
      }
    });
    return { count: 1 };
  },
  upsert: async ({ where, create, update }) => {
    const [key, val] = Object.entries(
      where.wabaAccountId_phone ? where.wabaAccountId_phone : where
    )[0];
    const idx = store[table].findIndex((r) => r[key] === val);
    if (idx !== -1) {
      store[table][idx] = { ...store[table][idx], ...update, updatedAt: new Date() };
      return store[table][idx];
    }
    const record = { id: genId(), createdAt: new Date(), updatedAt: new Date(), ...create };
    store[table].push(record);
    return record;
  },
  count: async ({ where = {} } = {}) => {
    return store[table].filter((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v)
    ).length;
  },
  delete: async ({ where }) => {
    const idx = store[table].findIndex((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v)
    );
    if (idx !== -1) store[table].splice(idx, 1);
  },
});

class PrismaClient {
  constructor() {
    this.user = makeMock('users');
    this.wabaAccount = makeMock('wabaAccounts');
    this.contact = makeMock('contacts');
    this.message = makeMock('messages');
    this.template = makeMock('templates');
  }

  async $connect() {}
  async $disconnect() {}
}

module.exports = { PrismaClient };
