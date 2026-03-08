declare module "ioredis" {
  export default class Redis {
    constructor(url: string, options?: Record<string, unknown>);
    brpoplpush(source: string, destination: string, timeout: number): Promise<string | null>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    lrem(key: string, count: number, value: string): Promise<number>;
    rpush(key: string, ...values: string[]): Promise<number>;
    del(...keys: string[]): Promise<number>;
    quit(): Promise<string>;
    disconnect(): void;
  }
}
