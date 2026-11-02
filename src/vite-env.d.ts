/// <reference types="vite/client" />

interface Navigator {
  /** WebGPU entry; typed loosely so we don't require @webgpu/types. */
  gpu?: unknown;
}
