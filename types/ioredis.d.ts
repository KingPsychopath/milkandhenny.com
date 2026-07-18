declare module "ioredis" {
  export default class Redis {
    constructor(url: string, options?: Record<string, unknown>);
    brpoplpush(source: string, destination: string, timeout: number): Promise<string | null>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    lrem(key: string, count: number, value: string): Promise<number>;
    on(
      event: "pmessage",
      listener: (pattern: string, channel: string, message: string) => void,
    ): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "message", listener: (channel: string, message: string) => void): this;
    psubscribe(...patterns: string[]): Promise<number>;
    publish(channel: string, message: string): Promise<number>;
    subscribe(...channels: string[]): Promise<number>;
    rpush(key: string, ...values: string[]): Promise<number>;
    del(...keys: string[]): Promise<number>;
    quit(): Promise<string>;
    disconnect(): void;
  }
}
