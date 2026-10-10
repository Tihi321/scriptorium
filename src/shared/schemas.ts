import { z } from 'zod'
import type { ZodType } from 'zod'

/**
 * Frontmatter schemas, one per file kind. Later phases add more (books, reviews ...).
 * Config files carry a `kind` field, so a file says what it is.
 * Unknown fields are kept (loose), so you can add your own notes to a file.
 */

/** Any markdown file with a frontmatter mapping. */
export const genericSchema = z.looseObject({})

const configBase = <K extends string>(kind: K) => z.looseObject({ kind: z.literal(kind) })

export const budgetSchema = configBase('budget').extend({
  monthly_cap_usd: z.number().nonnegative(),
  daily_cap_usd: z.number().nonnegative(),
  per_book_cap_usd: z.number().nonnegative().nullable().default(null),
  /** Fraction of a cap at which a warning is shown. */
  warn_at: z.number().min(0).max(1).default(0.8)
})

// ---- providers ----

export const providerModelSchema = z.looseObject({
  id: z.string().min(1),
  family: z.string().default('unknown'),
  context: z.number().int().positive().optional(),
  max_output: z.number().int().positive().optional(),
  /** USD per 1M tokens. */
  price_in: z.number().nonnegative().default(0),
  price_out: z.number().nonnegative().default(0),
  /** USD per 1M cached input tokens. Falls back to price_in when missing. */
  price_cached_in: z.number().nonnegative().optional(),
  embedding: z.boolean().default(false),
  /** Extra JSON fields merged into the request body for this model (for example to switch thinking off). */
  extra_body: z.record(z.string(), z.unknown()).nullable().optional()
})

export const providerEntrySchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['openai-compat', 'anthropic', 'gemini', 'mock', 'search']),
  enabled: z.boolean().default(true),
  local: z.boolean().default(false),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  /** How many requests may run at once. */
  concurrency: z.number().int().positive().default(4),
  /** `kind: search` only: which search service this entry talks to (tavily, wikipedia, brave, serpapi, serphouse, duckduckgo). Defaults to the id. */
  engine: z.string().optional(),
  /** `kind: search` only: USD per request, logged to the spend files. */
  price_per_request: z.number().nonnegative().default(0),
  rpm: z.number().int().positive().optional(),
  tpm: z.number().int().positive().optional(),
  /** Ask the provider which models it has (GET /v1/models) and add the unknown ones. */
  discover: z.boolean().default(false),
  /** Send the JSON schema as `response_format`. Set false for servers that reject a bad JSON answer (502) instead of constraining it: the prompt and the repair step handle the JSON then. */
  json_schema: z.boolean().default(true),
  models: z.array(providerModelSchema).default([])
})

export const providersSchema = configBase('providers').extend({
  providers: z.array(providerEntrySchema).default([]),
  /** The researcher tries the `kind: search` providers in this order (ids). Providers not listed come after, in file order. */
  search_order: z.array(z.string()).default([])
})

// ---- roles ----

export const rolesSchema = configBase('roles').extend({
  /** Per role: ordered model list, `provider/model`. The first one is the default, the rest are fallbacks. */
  roles: z.record(z.string(), z.looseObject({ models: z.array(z.string()).default([]) })).default({}),
  /** `provider/model` used for embeddings. */
  embeddings: z.string().optional()
})

// ---- factory ----

export const factorySchema = configBase('factory').extend({
  /** Persisted "pause all": no new jobs start while true. */
  paused: z.boolean().default(false),
  max_books_in_progress: z.number().int().positive().default(3),
  idea_low_water_mark: z.number().int().nonnegative().default(5),
  /** How many research questions one book may ask in total (0 = none). */
  research_limit_per_book: z.number().int().nonnegative().default(10),
  /** The same limit for non-fiction books, which research every chapter. */
  research_limit_nonfiction: z.number().int().nonnegative().default(40),
  /**
   * Writers list research questions before a chapter (a short prep step) for books whose genre or topic contains one of these words
   * (case-insensitive), even when the format has `research_prep: false`.
   */
  research_prep_genres: z.array(z.string()).default([]),
  /** Attempts before a job moves to failed/. */
  max_attempts: z.number().int().positive().default(3)
})

// Placeholders: the real fields arrive in the phase that uses the file.
export const qualitySchema = configBase('quality').extend({
  /** Weighted average score a book needs to be published (1-10). */
  threshold: z.number().min(0).max(10).default(7),
  /** Rewrite rounds before the publisher decides. */
  max_rounds: z.number().int().nonnegative().default(2),
  /** A new pitch this similar (cosine, 0-1) to an existing pitch or blurb in the library is written again. */
  pitch_similarity_max: z.number().min(0).max(1).default(0.9),
  /** A `revise` from a reviewer that is not in must_pass only counts when one of its scores is below this. */
  revise_below: z.number().min(1).max(10).default(7),
  /** Reviewer roles that must say `pass` (when they review the format at all). */
  must_pass: z.array(z.string()).default(['child-safety-reviewer', 'originality-checker']),
  /** Weight per score dimension. Missing dimensions count as 1. */
  weights: z.record(z.string(), z.number().nonnegative()).default({})
})

export const formatEntrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  enabled: z.boolean().default(false),
  /** Topic kinds this format can be used for. */
  kinds: z.array(z.string()).default([]),
  juvenile: z.boolean().default(false),
  age_band: z.string().nullable().default(null),
  /** [min, max] words for the whole book. */
  words: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** [min, max] chapters. */
  chapters: z.tuple([z.number().int().positive(), z.number().int().positive()]).default([1, 1]),
  read_aloud: z.boolean().default(false),
  /** Long works (novella and up) use the book memory: structured bible, summaries, search, acts. */
  long: z.boolean().default(false),
  /** Writers list research questions before each chapter (a prep step, one model call per chapter). See also factory.research_prep_genres. */
  research_prep: z.boolean().default(false),
  /**
   * The non-fiction variant: research for every chapter, a fact base instead of a story bible, non-fiction prompts,
   * the fact-checker as a reviewer (in place of the continuity checker) and a references section at the end.
   */
  nonfiction: z.boolean().default(false),
  /** Rewrite rounds for this format. Falls back to quality.max_rounds. */
  max_rounds: z.number().int().nonnegative().optional(),
  /** Overrides the default reviewer list. */
  reviewers: z.array(z.string()).optional(),
  /** Instructions for writers and editors, added to the prompts. */
  guidance: z.string().default('')
})

export const formatsSchema = configBase('formats').extend({
  formats: z.array(formatEntrySchema).default([])
})
export const settingsSchema = configBase('settings').extend({
  kindle_address: z.string().default(''),
  from_address: z.string().default(''),
  smtp_host: z.string().default(''),
  smtp_port: z.number().int().default(587),
  smtp_user: z.string().default(''),
  smtp_secure: z.boolean().default(false)
})
export const topicsSchema = configBase('topics')

// ---- agents ----

export const agentSchema = z.looseObject({
  kind: z.literal('agent'),
  role: z.string().min(1),
  name: z.string().min(1),
  /** `provider/model` override. Empty means "use the role default". */
  model: z.string().nullable().default(null),
  /** Prefer jobs for these books or topics. */
  focus: z.array(z.string()).default([]),
  /** Only take jobs for this book. */
  pin: z.string().nullable().default(null),
  max_parallel: z.number().int().positive().default(1),
  paused: z.boolean().default(false)
})

// ---- jobs ----

export const ideaSchema = z.looseObject({
  kind: z.literal('idea').default('idea'),
  title: z.string().optional(),
  /** Topic id from topics.md. Empty means "the editor-in-chief picks". */
  topic: z.string().nullable().default(null),
  status: z.enum(['open', 'used']).default('open'),
  /** `user` ideas are picked before generated ones. */
  source: z.enum(['user', 'generated']).default('user'),
  format: z.string().nullable().default(null),
  book: z.string().nullable().default(null),
  created: z.string().optional()
})

export const bookSchema = z.looseObject({
  kind: z.literal('book').default('book'),
  slug: z.string(),
  title: z.string(),
  stage: z.string().default('new'),
  round: z.number().int().nonnegative().default(0),
  format: z.string(),
  topic: z.string().nullable().default(null),
  topic_name: z.string().nullable().default(null),
  genre: z.string().default(''),
  age_band: z.string().nullable().default(null),
  target_words: z.number().int().positive(),
  author: z.string().nullable().default(null),
  writer_agent: z.string().nullable().default(null),
  writer_family: z.string().nullable().default(null),
  rewrite_chapters: z.array(z.number().int()).default([]),
  uuid: z.string().optional(),
  cover_png: z.string().nullable().default(null),
  cost_usd: z.number().default(0),
  reasons: z.array(z.string()).default([]),
  made: z.array(z.record(z.string(), z.unknown())).default([])
})

export const jobSchema = z.looseObject({
  kind: z.literal('job').default('job'),
  /** Deterministic: book--task--unit--round. */
  id: z.string().min(1),
  book: z.string().nullable().default(null),
  task: z.string().min(1),
  role: z.string().min(1),
  unit: z.string().nullable().default(null),
  round: z.number().int().nonnegative().default(0),
  /** An agent id, `you` or `engine`. */
  requested_by: z.string().default('engine'),
  depends_on: z.array(z.string()).default([]),
  /** Job id (usually research) this job is suspended on. */
  waiting_on: z.string().nullable().default(null),
  /** Short text for the office (the handover line and the agent's bubble) instead of `task unit`. Research jobs use the question. */
  label: z.string().optional(),
  /** Locks that must be free to run, for example `bible:silver-inn`. */
  locks: z.array(z.string()).default([]),
  /** Reviewers prefer a model family different from this one. */
  avoid_family: z.string().nullable().default(null),
  /** Prefer this agent (same writer for a book's chapters). Not strict. */
  agent_hint: z.string().nullable().default(null),
  paid: z.boolean().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  max_attempts: z.number().int().positive().nullable().default(null),
  /** Do not start before this time (ISO). Used for retry backoff. */
  not_before: z.string().nullable().default(null),
  created: z.string().optional()
})

export const schemasByKind = {
  budget: budgetSchema,
  providers: providersSchema,
  roles: rolesSchema,
  quality: qualitySchema,
  formats: formatsSchema,
  factory: factorySchema,
  settings: settingsSchema,
  topics: topicsSchema,
  agent: agentSchema,
  job: jobSchema,
  idea: ideaSchema,
  book: bookSchema,
  generic: genericSchema
} as const satisfies Record<string, ZodType>

export type FileKind = keyof typeof schemasByKind
export type BudgetConfig = z.output<typeof budgetSchema>
export type ProvidersConfig = z.output<typeof providersSchema>
export type ProviderEntry = z.output<typeof providerEntrySchema>
export type ProviderModelEntry = z.output<typeof providerModelSchema>
export type RolesConfig = z.output<typeof rolesSchema>
export type SettingsConfig = z.output<typeof settingsSchema>
export type FactoryConfig = z.output<typeof factorySchema>
export type AgentFrontmatter = z.output<typeof agentSchema>
export type QualityConfig = z.output<typeof qualitySchema>
export type FormatEntry = z.output<typeof formatEntrySchema>
export type FormatsConfig = z.output<typeof formatsSchema>
export type IdeaFrontmatter = z.output<typeof ideaSchema>
export type BookFrontmatter = z.output<typeof bookSchema>
export type JobFrontmatter = z.output<typeof jobSchema>

/** Config files in `config/`, by file name (without `.md`). */
export const CONFIG_FILES = ['providers', 'roles', 'budget', 'quality', 'formats', 'factory', 'settings'] as const

/** Every role in the design's Staff table, plus the archivist. */
export const ROLES = [
  'editor-in-chief',
  'idea-generator',
  'architect',
  'writer',
  'continuity-checker',
  'researcher',
  'fact-checker',
  'developmental-editor',
  'line-editor',
  'copy-editor',
  'beta-reader',
  'originality-checker',
  'child-safety-reviewer',
  'read-aloud-reviewer',
  'publisher',
  'archivist'
] as const
