import { LRUCache } from "lru-cache";

export class Cache<T extends {}> {
  private readonly cache: LRUCache<string, T>;

  constructor(max: number, ttl: number) {
    this.cache = new LRUCache<string, T>({ max, ttl });
  }

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: T): void {
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}
