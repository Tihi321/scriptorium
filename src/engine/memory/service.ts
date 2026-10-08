import type { ModelRegistry } from '../models/registry'
import { MemoryIndex, reindex } from './index'
import type { Embedder } from './index'

/** Opens the search index on first use and gives the pipeline an embedder from the model registry. */
export class MemoryService {
  private index: MemoryIndex | undefined

  constructor(
    private readonly dataDir: string,
    private readonly registry: ModelRegistry
  ) {}

  /** True when an embedding model is configured and its provider can be used. */
  available(): boolean {
    const m = this.registry.embeddingModel()
    return !!m && m.provider.available
  }

  readonly embedder: Embedder = (texts, kind) => this.registry.embed(texts, kind)

  getIndex(): MemoryIndex {
    this.index ??= MemoryIndex.open(this.dataDir, this.embedder)
    return this.index
  }

  async reindexAll() {
    return reindex(this.dataDir, this.getIndex())
  }

  close(): void {
    this.index?.close()
    this.index = undefined
  }
}
