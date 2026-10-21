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
  extra_body: z.record(z.string(), z.unknown()).nullable().optional(),
  /** `load_models` providers (LM Studio): load this model with this context window and parallel count instead of the settings' ones. */
  load_context: z.number().int().min(2048).optional(),
  load_parallel: z.number().int().min(1).max(16).optional(),
  /** `kind: client`: the answering client can look at images. Not used by Scriptorium's own jobs (they send no images); VN Studio's art critic does. */
  vision: z.boolean().optional()
})

export const providerEntrySchema = z.looseObject({
  id: z.string().min(1),
  /** `client`: no model server. A request waits in the engine's client task queue until an MCP client (Claude Code) answers it. */
  kind: z.enum(['openai-compat', 'anthropic', 'gemini', 'mock', 'search', 'client']),
  enabled: z.boolean().default(true),
  local: z.boolean().default(false),
  base_url: z.string().optional(),
  api_key_env: z.string().optional(),
  /**
   * How many requests may run at once. `auto`: as many as the server says it serves (`concurrency.serving` of
   * `GET <base_url>/status`, the Strata status), checked every few seconds; 1 while the server can't be asked.
   */
  concurrency: z.union([z.number().int().positive(), z.literal('auto')]).default(4),
  /** `kind: search` only: which search service this entry talks to (tavily, wikipedia, brave, serpapi, serphouse, duckduckgo). Defaults to the id. */
  engine: z.string().optional(),
  /** `kind: search` only: USD per request, logged to the spend files. */
  price_per_request: z.number().nonnegative().default(0),
  /** `kind: search`, `engine: client`: minutes a web search task waits for an MCP client before the search gives up and the next provider is tried. Default 10. */
  wait_minutes: z.number().positive().optional(),
  rpm: z.number().int().positive().optional(),
  tpm: z.number().int().positive().optional(),
  /**
   * Requests per day, counted from midnight UTC (OpenRouter's free models: 50, or 1000 after buying 10 credits). A provider that
   * reached it is skipped until the next midnight UTC: its jobs go to the next model in their role.
   */
  rpd: z.number().int().positive().optional(),
  /**
   * Ask the provider which models it has (GET /v1/models) and add the unknown ones. `free`: only the ones it lists at price 0
   * (OpenRouter's `:free` models). A paid provider's model that comes without a price is never added, so the budget always sees its cost.
   */
  discover: z.union([z.boolean(), z.literal('free')]).default(false),
  /** Discovery leaves out models whose id contains one of these words (any case), for example `dflash`. */
  discover_skip: z.array(z.string()).default([]),
  /** Send the JSON schema as `response_format`. Set false for servers that reject a bad JSON answer (502) instead of constraining it: the prompt and the repair step handle the JSON then. */
  json_schema: z.boolean().default(true),
  /** LM Studio: the engine loads a model that isn't loaded yet itself, with the parallel, context and idle time from config/settings.md. */
  load_models: z.boolean().default(false),
  models: z.array(providerModelSchema).default([])
})

/**
 * config/models.md: which models the pickers offer, set in the app's Models dialog. `picked`: models a provider lists that are
 * not in providers.md, with the price it listed when you picked them. `hidden`: `provider/model` refs the pickers leave out.
 */
export const modelsConfigSchema = configBase('models').extend({
  picked: z.array(providerModelSchema.extend({ provider: z.string().min(1) })).default([]),
  hidden: z.array(z.string()).default([]),
  /**
   * Per provider id: limits set in the Models panel, over the ones in providers.md. `concurrency`: requests at once (not for a
   * `concurrency: auto` server). `rpm`, `rpd`: requests per minute and per day; 0 means no limit.
   */
  limits: z
    .record(
      z.string(),
      z.object({
        concurrency: z.number().int().positive().optional(),
        rpm: z.number().int().nonnegative().optional(),
        rpd: z.number().int().nonnegative().optional()
      })
    )
    .default({})
})

export const providersSchema = configBase('providers').extend({
  providers: z.array(providerEntrySchema).default([]),
  /** The researcher tries the `kind: search` providers in this order (ids). Providers not listed come after, in file order. */
  search_order: z.array(z.string()).default([])
})

// ---- roles ----

export const rolesSchema = configBase('roles').extend({
  /** Per role: ordered model list, `provider/model` or an alias (`paid`, `strata`, `lmstudio`: the defaults in config/settings.md). The first one is the default, the rest are fallbacks. */
  roles: z.record(z.string(), z.looseObject({ models: z.array(z.string()).default([]) })).default({}),
  /** `provider/model` used for embeddings. */
  embeddings: z.string().optional()
})

// ---- factory ----

export const factorySchema = configBase('factory').extend({
  /** Persisted "pause all": no new jobs start while true. */
  paused: z.boolean().default(false),
  max_books_in_progress: z.number().int().positive().default(3),
  /** How many newspaper articles (formats with `article: true`) are worked on at the same time. They do not count toward max_books_in_progress. */
  max_articles_in_progress: z.number().int().positive().default(3),
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
  /**
   * A visual novel script instead of prose: scene headings, who is on screen, and speaker lines. The writer and the
   * line editor use the `_vn` prompts, and the EPUB lays the chapters out as a script.
   */
  script: z.boolean().default(false),
  /**
   * A story with choices: some chapters end with two or three choices, each leading to a later chapter, and the
   * story has several endings. The engine adds the matching section of `prompts/_choices.md` to the prompts.
   * For short formats only (not `long`).
   */
  choices: z.boolean().default(false),
  /**
   * The humanizer rewrites every chapter once after it is drafted (and again after a rewrite round) so it reads less like a
   * machine and more like a person. Needs a hired humanizer agent; a book can switch it off with `humanize: false` in book.md.
   */
  humanize: z.boolean().default(true),
  /**
   * A newspaper article: one chapter, written like a non-fiction book (research, fact base, numbered sources) but with the `_article`
   * prompts, a recent-news search, its own research notes, and a single styled page (`out/article.html`, `out/article.md`) instead of
   * a cover and an EPUB. Articles have their own slot limit (`max_articles_in_progress` in config/factory.md).
   */
  article: z.boolean().default(false),
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
  smtp_secure: z.boolean().default(false),
  /** What the role aliases in roles.md stand for: `paid`, `strata` and `lmstudio` (each a `provider/model`). */
  default_paid_model: z.string().default('deepseek/deepseek-flash'),
  default_strata_model: z.string().default('strata/qwen3.8-flash-next'),
  default_lmstudio_model: z.string().default('lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic'),
  /** One fallback order for every role: the groups `paid` (any API model), `strata` and `lmstudio`, first one first. Empty: each role keeps the order of its list in roles.md. */
  model_order: z.array(z.enum(['paid', 'strata', 'lmstudio'])).default([]),
  /** How the engine loads LM Studio models that aren't loaded yet: requests at once, context window, idle minutes before LM Studio unloads it. */
  lmstudio_parallel: z.number().int().min(1).max(16).default(4),
  lmstudio_context: z.number().int().min(2048).default(131072),
  lmstudio_ttl_minutes: z.number().int().min(1).default(60)
})
export const mcpSchema = configBase('mcp').extend({
  /** Start the MCP server with the engine. */
  enabled: z.boolean().default(true),
  /** Loopback only: any other host is refused and 127.0.0.1 is used. */
  host: z.string().default('127.0.0.1'),
  /** 0 picks a free port. */
  port: z.number().int().min(0).max(65535).default(7341),
  /** Name of the secret (environment variable or Windows credential store) that holds the bearer token. When it is set, clients must send it. */
  token_env: z.string().default('SCRIPTORIUM_MCP_TOKEN')
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
  /** With `pin`: only the agents assigned to the book this way take its jobs (the job waits for them, even while they are paused). */
  pin_exclusive: z.boolean().default(false),
  max_parallel: z.number().int().positive().default(1),
  paused: z.boolean().default(false)
})

// ---- jobs ----

export const ideaSchema = z.looseObject({
  kind: z.literal('idea').default('idea'),
  title: z.string().optional(),
  /** The owner gave the title: the book keeps it. */
  title_fixed: z.boolean().optional(),
  genre: z.string().optional(),
  /** Topic id from topics.md. Empty means "the editor-in-chief picks". */
  topic: z.string().nullable().default(null),
  status: z.enum(['open', 'used']).default('open'),
  /** `user` ideas are picked before generated ones. */
  source: z.enum(['user', 'generated']).default('user'),
  /** Format id from config/formats.md. Empty means "the editor-in-chief picks". */
  format: z.string().nullable().default(null),
  /** Role -> `provider/model` for the book made from this story (copied to the book's `role_models`). */
  role_models: z.record(z.string(), z.string()).optional(),
  book: z.string().nullable().default(null),
  /** Series slug (a file in series/). The book made from this story is a book of that series. */
  series: z.string().optional(),
  /** Position in the series, 1 for the first book. */
  series_index: z.number().int().positive().optional(),
  /** `false`: the book made from this story gets no humanizer pass. */
  humanize: z.boolean().optional(),
  /** Slug of a published book this story adapts (a visual novel script of a prose book). The story waits until that book is published. */
  source_book: z.string().optional(),
  created: z.string().optional()
})

/** A series: books that continue each other, with shared characters, setting and canon (series/<slug>.md). */
export const seriesSchema = z.looseObject({
  kind: z.literal('series').default('series'),
  title: z.string().optional(),
  genre: z.string().optional(),
  format: z.string().optional(),
  /** Slugs of the books made so far, in order. */
  books: z.array(z.string()).default([]),
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
  /** Series slug and position, copied from the story the book was made from. */
  series: z.string().optional(),
  series_index: z.number().int().positive().optional(),
  /** Slug of the published book this book adapts into a visual novel script (copied from the story). */
  source_book: z.string().optional(),
  /** A newspaper article (copied from the format's `article` flag): no cover and no EPUB, an `out/article.html` page instead. */
  article: z.boolean().optional(),
  /** Articles: the headline and the standfirst (the one-sentence summary under it). Set by the architect, final from the publisher. */
  headline: z.string().optional(),
  standfirst: z.string().optional(),
  /** `false`: no humanizer pass for this book (`add_story {humanize: false}`), whatever the format says. */
  humanize: z.boolean().optional(),
  /** The year the story is set in: the architect's outline sets it, you may set it by hand. The reviewers get the calendar of that year. */
  story_year: z.number().int().optional(),
  age_band: z.string().nullable().default(null),
  target_words: z.number().int().positive(),
  author: z.string().nullable().default(null),
  writer_agent: z.string().nullable().default(null),
  writer_family: z.string().nullable().default(null),
  rewrite_chapters: z.array(z.number().int()).default([]),
  /** Rounds added to the format's `max_rounds` by `reopen_book`, one per reopening. */
  extra_rounds: z.number().int().nonnegative().default(0),
  /**
   * Role -> `provider/model` for this book only (`add_story {models}`, `set_book_model`): a job of the book in that role tries this model first,
   * before the agent's own model, and any agent of the role may take it. The role's list stays the fallback. (`models` in book.md is the
   * count of jobs per model, written by the engine.)
   */
  role_models: z.record(z.string(), z.string()).default({}),
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
  /** The story (idea) slug a job of no book yet is about: a `start_book` job names the story it starts, so the story's `role_models` apply to it. */
  idea: z.string().optional(),
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
export type ModelsConfig = z.output<typeof modelsConfigSchema>
export type FactoryConfig = z.output<typeof factorySchema>
export type AgentFrontmatter = z.output<typeof agentSchema>
export type QualityConfig = z.output<typeof qualitySchema>
export type FormatEntry = z.output<typeof formatEntrySchema>
export type FormatsConfig = z.output<typeof formatsSchema>
export type IdeaFrontmatter = z.output<typeof ideaSchema>
export type SeriesFrontmatter = z.output<typeof seriesSchema>
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
  'archivist',
  'humanizer'
] as const
