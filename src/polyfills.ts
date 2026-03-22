import { Buffer } from "buffer/";

const globalScope = globalThis as unknown as {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: {
    env: Record<string, string>;
  };
};

globalScope.Buffer = globalScope.Buffer ?? Buffer;
globalScope.global ??= globalThis;
globalScope.process ??= { env: {} };
