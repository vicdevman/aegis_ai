import { logger } from "../utils/logger.js";

/**
 * ModelSimulator mimics a Mongoose model for in-memory data storage.
 * It provides a subset of the Mongoose API used in the project.
 */
export class ModelSimulator<T extends { id: string }> {
  private data: Map<string, T> = new Map();
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  async create(doc: T): Promise<T> {
    const newDoc = { ...doc };
    this.data.set(newDoc.id, newDoc);
    logger.debug(`[Simulator][${this.name}] Created: ${newDoc.id}`);
    return newDoc;
  }

  async findOneAndUpdate(query: any, update: any): Promise<T | null> {
    const id = query.id;
    if (!id) return null;
    
    const existing = this.data.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...update };
    this.data.set(id, updated);
    logger.debug(`[Simulator][${this.name}] Updated: ${id}`);
    return updated;
  }

  find(query: any = {}) {
    let results = Array.from(this.data.values());

    // Simple status filter (common in the codebase)
    if (query.status) {
      results = results.filter(d => (d as any).status === query.status);
    }

    // Mocking the chainable API
    const chain = {
      lean: () => Promise.resolve(results),
      sort: (sortObj: any) => {
        const key = Object.keys(sortObj)[0];
        const dir = sortObj[key];
        results.sort((a, b) => {
          const valA = (a as any)[key];
          const valB = (b as any)[key];
          if (valA < valB) return dir === -1 ? 1 : -1;
          if (valA > valB) return dir === -1 ? -1 : 1;
          return 0;
        });
        return chain;
      },
      limit: (n: number) => {
        results = results.slice(0, n);
        return chain;
      },
      exec: () => Promise.resolve(results),
      then: (resolve: any) => Promise.resolve(results).then(resolve),
    };

    return chain as any;
  }
}
