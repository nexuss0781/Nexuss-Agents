# OpenRouter Free Models

> **Purpose:** Provide a maintained, modular reference for the free models shown in the supplied OpenRouter catalog and guide model selection inside Nexuss-Agent.

**Document status:** Initial catalog transcription
**Catalog source:** User-supplied OpenRouter model listing, captured August 2026
**Official catalog:** [OpenRouter Models](https://openrouter.ai/models) [1]
**Scope:** Models displayed at `$0/M` input and `$0/M` output in the supplied catalog. One adjacent reranking model is documented separately because the supplied listing shows a non-zero price.

## 1. Reading This Document

The document is organized into independent modules so that model-selection logic, product documentation, and future provider adapters can reference only the section they need.

| Module | Focus | Primary use in Nexuss-Agent |
|---|---|---|
| Module A | Catalog and selection matrix | Fast model discovery and Settings UI labels |
| Module B | General agentic and reasoning models | Research, planning, orchestration, and long-running tasks |
| Module C | Coding and software-engineering models | Coding agents, terminal work, and repository changes |
| Module D | Multimodal and document-intelligence models | Images, video, audio, OCR, charts, and visual RAG |
| Module E | Retrieval and reranking models | RAG pipelines and document relevance scoring |
| Module F | Operational guidance | Routing, validation, privacy, licensing, and failure handling |

The catalog provides display names, providers, context windows, prices, usage volume, and descriptive claims. It does **not** provide canonical OpenRouter model IDs for every entry in the supplied capture. Nexuss-Agent should therefore persist and invoke the exact `id` returned by the OpenRouter `/models` endpoint rather than deriving an ID from a display name.

## 2. Module A — Catalog and Selection Matrix

### 2.1 Free-model inventory

The following fifteen entries are marked free in the supplied catalog. “Free” means the displayed list price was `$0/M` for both input and output at capture time; it does not guarantee unlimited throughput, uninterrupted availability, or a permanent free tier.

| # | Display name | Provider | Primary capability | Context shown | Input / output price shown |
|---:|---|---|---|---:|---:|
| 1 | Nemotron 3 Ultra | NVIDIA | Frontier reasoning, orchestration, deep research, coding agents | 1M | $0/M / $0/M |
| 2 | Laguna S 2.1 | Poolside | Software engineering and coding agents | 262K | $0/M / $0/M |
| 3 | Nemotron 3.5 Lightning | NVIDIA | High-throughput agentic workloads, programming, science | 1M | $0/M / $0/M |
| 4 | Nemotron 3 Super | NVIDIA | Complex reasoning, multi-agent planning, cross-document work | 262K | $0/M / $0/M |
| 5 | North Mini Code | Cohere | Agentic coding and terminal tasks | 256K | $0/M / $0/M |
| 6 | Laguna XS 2.1 | Poolside | Compact coding agents, reasoning, and tool calling | 262K | $0/M / $0/M |
| 7 | Dots3-Note Preview | Dots Studio | Reasoning, coding, multimodal understanding, long context | 512K | $0/M / $0/M |
| 8 | Nemotron 3 Nano 30B A3B | NVIDIA | Efficient specialized agentic systems | 256K | $0/M / $0/M |
| 9 | Nemotron 3 Nano Omni | NVIDIA | Text, image, video, and audio perception sub-agent | 256K | $0/M / $0/M |
| 10 | Gemma 4 26B A4B IT | Google | Multimodal reasoning, function calling, structured output | 262K | $0/M / $0/M |
| 11 | Llama Nemotron Rerank VL 1B V2 | NVIDIA | Multimodal reranking for visual document RAG | 10K | $0/M / $0/M |
| 12 | Nemotron Nano 9B V2 | NVIDIA | Reasoning and non-reasoning text tasks | 128K | $0/M / $0/M |
| 13 | LFM2.5-2.6B | LiquidAI | Compact reasoning, extraction, RAG, and long context | 128K | $0/M / $0/M |
| 14 | gpt-oss-20b | OpenAI | Reasoning, function calling, tool use, structured outputs | 131K | $0/M / $0/M |
| 15 | Nemotron Nano 12B 2 VL | NVIDIA | Video understanding, OCR, charts, and document intelligence | 128K | $0/M / $0/M |

### 2.2 Adjacent non-free model in the supplied capture

The following model appeared in the same catalog view but was listed at `$0.02/M tokens`, so it is **not classified as free** in this document.

| Display name | Provider | Capability | Context shown | Price shown |
|---|---|---|---:|---:|
| rerank-2.5-lite | VoyageAI by MongoDB | Low-latency text reranking and instruction-guided relevance scoring | 32K | $0.02/M tokens |

### 2.3 Recommended routing matrix

| Task | First candidate | Alternatives | Why |
|---|---|---|---|
| Deep research and long-running orchestration | Nemotron 3 Ultra | Nemotron 3 Super, Nemotron 3.5 Lightning | Very large context claims, reasoning, planning, and agent orchestration positioning |
| General software engineering | Laguna S 2.1 | North Mini Code, Laguna XS 2.1 | Coding-agent specialization, tool use, terminal-task orientation, and large context |
| Fast coding or high-throughput agent loops | Nemotron 3.5 Lightning | Nemotron 3 Nano 30B A3B, North Mini Code | Smaller active parameter counts and high-throughput positioning |
| Tool calling and structured outputs | Gemma 4 26B A4B IT | gpt-oss-20b, North Mini Code | The catalog explicitly mentions native function calling or structured-output support |
| Multimodal perception | Nemotron 3 Nano Omni | Gemma 4 26B A4B IT | Text, image, video, and audio support in the catalog descriptions |
| OCR, charts, and document intelligence | Nemotron Nano 12B 2 VL | Nemotron Nano Omni, Llama Nemotron Rerank VL 1B V2 | Document, video, OCR, chart, and visual-retrieval orientation |
| Visual RAG reranking | Llama Nemotron Rerank VL 1B V2 | rerank-2.5-lite, if paid usage is acceptable | Cross-encoder-style relevance scoring for mixed text and document-image inputs |
| Lightweight extraction and RAG | LFM2.5-2.6B | Nemotron Nano 9B V2 | Compact footprint and explicit extraction/RAG positioning |
| General open-weight agent work | gpt-oss-20b | Nemotron Nano 9B V2, Gemma 4 26B A4B IT | Reasoning, tools, function calling, and structured-output capabilities |

## 3. Module B — General Agentic and Reasoning Models

### 3.1 NVIDIA Nemotron 3 Ultra — free

**Catalog role:** Open frontier-reasoning and orchestration model.
**Architecture and scale:** The supplied description reports a hybrid Transformer–Mamba mixture-of-experts design with 55B active parameters out of 550B total.
**Context:** Up to 1M tokens shown in the catalog.
**Best suited for:** Long-running agentic workflows, agent orchestration, coding agents, deep research, complex enterprise tasks, multi-step reasoning, and planning.
**Operational profile:** The model is positioned for high-throughput inference and high-volume agent pipelines.
**Nexuss-Agent recommendation:** Use as a primary research and orchestration candidate when the returned OpenRouter model metadata confirms tool-calling and streaming support.

### 3.2 NVIDIA Nemotron 3 Super — free

**Catalog role:** Large open hybrid MoE model for complex reasoning and multi-agent applications.
**Architecture and scale:** The supplied description reports 120B total parameters with 12B activated, a hybrid Mamba–Transformer MoE design, multi-token prediction, and latent expert routing.
**Context:** 262K tokens shown in the catalog. The descriptive text also discusses a 1M-token context window; this discrepancy should be resolved against the live model metadata before routing large prompts.
**Best suited for:** Cross-document reasoning, long-term agent coherence, multi-step planning, science tasks, and multi-agent workflows.
**Nexuss-Agent recommendation:** Treat the live `/models` response as authoritative for context and capability flags because the supplied display contains two context values.

### 3.3 NVIDIA Nemotron 3.5 Lightning — free

**Catalog role:** High-throughput open MoE model.
**Architecture and scale:** The supplied description reports 3B active parameters out of 30B total.
**Context:** 1M tokens shown in the catalog.
**Best suited for:** Fast agent loops, programming, science, and specialized domain tasks that benefit from throughput and customization.
**Nexuss-Agent recommendation:** Prefer for queue-drained background-style analysis where latency and throughput matter more than maximum reasoning depth.

### 3.4 NVIDIA Nemotron Nano 9B V2 — free

**Catalog role:** Unified reasoning and non-reasoning language model.
**Architecture and scale:** The supplied catalog describes a model trained from scratch by NVIDIA; it does not provide an active/total MoE breakdown.
**Context:** 128K tokens shown in the catalog.
**Best suited for:** General text tasks, controllable reasoning, short-to-medium research, summarization, and lightweight agent steps.
**Nexuss-Agent recommendation:** Use as a lower-cost fallback when a larger model is unavailable or when a task does not need a long context.

### 3.5 LiquidAI LFM2.5-2.6B — free

**Catalog role:** Compact reasoning model.
**Context:** 128K tokens shown in the catalog.
**Best suited for:** Agent workflows, data extraction, RAG, and long-context processing.
**Important limitation:** LiquidAI advises against using this model for agentic coding or knowledge-heavy tasks. The supplied listing also states that prompts and outputs may be retained and used to train Liquid models.
**Nexuss-Agent recommendation:** Reserve for extraction and retrieval-support steps, and do not route sensitive workspace content without an explicit data-governance decision.

## 4. Module C — Coding and Software-Engineering Models

### 4.1 Poolside Laguna S 2.1 — free

**Catalog role:** Large coding-agent model.
**Architecture and scale:** The supplied description reports 118B total parameters and 8B active parameters.
**Reported benchmarks:** Terminal-Bench 2.1 at 70.2% and DeepSWE at 40.4%, as stated in the supplied listing. These are catalog-reported claims and should not be treated as Nexuss-Agent acceptance tests.
**Context:** 262K tokens shown in the catalog.
**Best suited for:** Software engineering, agentic coding, repository navigation, terminal tasks, and long coding sessions.
**License and data note:** Open-weight under the OpenMDW-1.1 license. The supplied listing states that free usage may allow Poolside to use inputs and outputs for training and improvement.
**Nexuss-Agent recommendation:** Strong candidate for coding tasks, but require an explicit workspace privacy acknowledgement before routing proprietary code.

### 4.2 Cohere North Mini Code — free

**Catalog role:** Agentic coding model and first model in Cohere’s North family.
**Architecture and scale:** Sparse MoE with 30B total parameters and 3B active parameters, according to the supplied catalog.
**Context and output:** 256K context and up to 64K output tokens are described in the listing.
**Capabilities:** Code generation, agentic software engineering, terminal tasks, interleaved reasoning, JSON-schema tool use, and generalization across agent harnesses.
**License:** Open-weight under Apache 2.0, according to the supplied description.
**Nexuss-Agent recommendation:** Good default coding candidate when structured tool calls and a permissive open-weight license are priorities.

### 4.3 Poolside Laguna XS 2.1 — free

**Catalog role:** Compact coding-agent model in the 33B-A3B class.
**Capabilities:** Tool calling, reasoning, software engineering, and agentic coding.
**Context and output:** 262K context shown in the catalog; the description states up to 32K output tokens.
**Efficiency:** FP8 quantization is described as enabling fast, cost-efficient workflows.
**License and data note:** OpenMDW-1.1 license, Poolside Acceptable Use Policy, and the same free-use training-data warning shown for Laguna S 2.1.
**Nexuss-Agent recommendation:** Use for interactive coding or queued follow-up tasks where a smaller active footprint may improve responsiveness.

### 4.4 OpenAI gpt-oss-20b — free

**Catalog role:** Open-weight general and agentic model.
**Architecture and scale:** The supplied listing reports 21B parameters with 3.6B active parameters per forward pass using MoE.
**Context:** 131K tokens shown in the catalog.
**Capabilities:** Reasoning-level configuration, fine-tuning, function calling, tool use, structured outputs, and the OpenAI Harmony response format.
**License:** Apache 2.0, according to the supplied description.
**Nexuss-Agent recommendation:** Strong general-purpose candidate for tool-enabled workspace actions, provided the OpenRouter adapter preserves the expected response format and tool-call fields.

## 5. Module D — Multimodal and Document-Intelligence Models

### 5.1 Dots Studio Dots3-Note Preview — free

**Catalog role:** Open-weight multimodal and long-context MoE model.
**Architecture and scale:** The supplied description reports 16B active parameters out of 280B total.
**Context:** 512K tokens shown in the catalog.
**Best suited for:** Reasoning, coding, multimodal understanding, long-context processing, and multi-step agent workflows.
**Nexuss-Agent recommendation:** Consider for document-heavy research when the live provider metadata confirms the expected image-input schema.

### 5.2 NVIDIA Nemotron 3 Nano Omni — free

**Catalog role:** Multimodal perception and context sub-agent.
**Architecture and scale:** The supplied listing describes a 30B-A3B open multimodal model with a hybrid MoE Transformer–Mamba architecture, Conv3D video layers, and Efficient Video Sampling.
**Inputs and context:** Text, image, video, and audio inputs; 256K context shown in the catalog. The description also cites approximately 300K context and a 16,384 reasoning budget, so live metadata should be treated as authoritative.
**Best suited for:** Enterprise perception loops, video reasoning, multimodal document analysis, and media-aware agent workflows.
**Nexuss-Agent recommendation:** Route only when the request adapter can preserve multimodal content parts and the workspace has an explicit media-retention policy.

### 5.3 Google Gemma 4 26B A4B IT — free

**Catalog role:** Instruction-tuned multimodal MoE model.
**Architecture and scale:** The supplied description reports approximately 25.2B total parameters with 3.8B active per token.
**Context:** 262K tokens shown in the catalog.
**Capabilities:** Text, image, and video input, including video clips up to 60 seconds at 1 frame per second; native function calling; configurable thinking/reasoning; and structured output support.
**License:** Apache 2.0, according to the supplied description.
**Nexuss-Agent recommendation:** Use for multimodal research and structured agent tasks when OpenRouter exposes the corresponding input and tool schemas.

### 5.4 NVIDIA Nemotron Nano 12B 2 VL — free

**Catalog role:** Multimodal reasoning model for video and document intelligence.
**Architecture and scale:** The supplied listing describes a 12B-parameter hybrid Transformer–Mamba model.
**Context:** 128K tokens shown in the catalog.
**Inputs and capabilities:** Text and multi-image documents, OCR, chart reasoning, document question answering, and long-form video understanding using Efficient Video Sampling.
**License and deployment:** The catalog describes open weights, training data, and fine-tuning recipes under a permissive NVIDIA open license, with deployment support across NVIDIA runtimes and major inference systems.
**Nexuss-Agent recommendation:** Prefer for OCR, chart, document, and video-analysis subtasks rather than general conversational work.

### 5.5 NVIDIA Llama Nemotron Rerank VL 1B V2 — free

**Catalog role:** Multimodal reranking model, not a general chat model.
**Architecture and scale:** The supplied description reports a 1.7B multimodal reranker.
**Context:** 10K tokens shown in the catalog.
**Inputs and capabilities:** Text queries paired with image, text, or combined document inputs; visual RAG relevance scoring for charts, tables, infographics, and mixed-media documents.
**Reported benefit:** The listing claims approximately 6–7% recall improvements over embedding-only baselines on visual document retrieval benchmarks. This is a catalog-reported claim, not a Nexuss-Agent guarantee.
**Nexuss-Agent recommendation:** Do not expose this model as the primary chat model. Use it behind a retrieval adapter that expects relevance scores or ranked candidates.

## 6. Module E — Retrieval and Reranking

### 6.1 VoyageAI rerank-2.5-lite — adjacent paid model

This entry is included for completeness because it appeared in the supplied catalog, but it is not free according to the displayed price.

**Catalog role:** Text reranker optimized for latency and relevance quality.
**Context:** 32K tokens per query–document pair, including up to 8K tokens for the query.
**Reported benchmarks:** The supplied listing claims a 7.16% improvement over Cohere Rerank v3.5 across 93 datasets and a 10.36% improvement on the Massive Instructed Retrieval Benchmark. These claims require independent validation before being used as product commitments.
**Capabilities:** Instruction-following relevance scoring and long-query/document reranking.
**Price shown:** `$0.02/M tokens`.
**Nexuss-Agent recommendation:** Keep disabled in a “free models only” picker. Add only to a paid retrieval-provider module after explicit cost controls are implemented.

### 6.2 Retrieval-routing rules

General chat models and rerankers should not share one undifferentiated model picker. A reranker expects a query–document scoring contract, while a chat model expects conversational messages and returns text or tool calls.

| Model class | Request contract | Response contract | UI treatment |
|---|---|---|---|
| Chat / reasoning | Messages, optional tools, optional multimodal parts | Text stream, tool calls, or structured output | Available in Playground model selector |
| Coding agent | Messages plus repository/tool context | Text stream and tool calls | Mark as Coding / Agentic |
| Vision-language | Messages with image/video/audio content parts | Text or structured output | Show multimodal capability badge |
| Reranker | Query plus candidate documents | Scores or ranked candidates | Hide from standard chat selector |

## 7. Module F — Operational Guidance for Nexuss-Agent

### 7.1 Model identifiers

The display names in the supplied catalog are human-readable labels, not guaranteed API identifiers. At runtime, Nexuss-Agent should use the canonical model `id` returned by OpenRouter’s model-list endpoint and persist that ID in the encrypted Paradox workspace. A display-name-to-ID map should be treated as a cache, not as a source of truth.

### 7.2 Capability negotiation

Before a model is offered in the Playground, the provider adapter should inspect the live model metadata and record at least the following fields:

```ts
type OpenRouterModelCapability = {
  id: string;
  canonicalSlug?: string;
  displayName: string;
  contextLength?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  supportsReasoning?: boolean;
  pricing?: { prompt?: string; completion?: string };
  license?: string;
};
```

The Playground should not assume that a model described as agentic supports the same tool-call schema as another provider. Tool-call arguments, reasoning fields, multimodal content parts, and finish reasons must be normalized by the provider adapter before the UI consumes them.

### 7.3 Free-tier policy

A `$0/M` listing is a pricing observation, not a reliability guarantee. Free routes can be rate-limited, queued, changed, removed, or subject to provider-specific data policies. Nexuss-Agent should show “Free at catalog capture” rather than “unlimited free” and should keep provider metadata timestamps so the UI can distinguish cached information from current availability.

### 7.4 Privacy and training-data controls

The supplied catalog contains explicit provider-specific warnings. Poolside states that free-use inputs and outputs may be used to train and improve its models. LiquidAI states that prompts and outputs may be retained and used to train Liquid models. These warnings must be displayed before routing private research, source code, credentials, or personal data to those models.

The encrypted API key protects the credential at rest and keeps it server-side; it does **not** prevent a provider from retaining request content. Provider privacy policy and acceptable-use requirements remain separate controls.

### 7.5 Streaming and error handling

OpenRouter-compatible streaming should be treated as an SSE protocol rather than as a single JSON response. The adapter must:

1. Preserve the exact model ID selected by the user.
2. Send `stream: true` only when the provider capability supports it.
3. Parse `delta.content`, structured content parts, reasoning fields, tool-call deltas, finish reasons, and `[DONE]` events.
4. Flush a final frame even when the upstream connection closes without a trailing newline.
5. Persist only normalized user and assistant content; never persist API keys or transient hidden control messages.
6. Log bounded, redacted diagnostics to the server console while showing concise recovery text in the UI.
7. Treat cancellation as a normal control path rather than as a provider failure.

### 7.6 Recommended initial Nexuss-Agent defaults

| Default | Recommended model class | Rationale |
|---|---|---|
| Research default | Nemotron 3 Ultra or Nemotron 3 Super | Long context and planning orientation; validate live capability metadata first |
| Coding default | North Mini Code or Laguna S 2.1 | Explicit coding-agent and terminal-task positioning |
| Fast fallback | Nemotron 3.5 Lightning or Nemotron 3 Nano 30B A3B | Throughput-oriented and smaller active parameter counts |
| Multimodal default | Gemma 4 26B A4B IT or Nemotron 3 Nano Omni | Catalog explicitly describes multimodal inputs and reasoning/tool capabilities |
| OCR/document fallback | Nemotron Nano 12B 2 VL | Document, OCR, chart, and video orientation |
| Visual retrieval | Llama Nemotron Rerank VL 1B V2 | Reranking contract rather than general chat |
| Lightweight extraction | LFM2.5-2.6B | Compact extraction/RAG use case, subject to LiquidAI data policy |

## 8. Data Normalization Record

The supplied listing reports catalog usage volumes. These values are included as observational metadata only and should not be used as a performance ranking because they reflect aggregate catalog traffic rather than Nexuss-Agent task quality.

| Model | Usage volume shown |
|---|---:|
| Nemotron 3 Ultra | 3.09T tokens |
| Laguna S 2.1 | 1.83T tokens |
| Nemotron 3.5 Lightning | 909B tokens |
| Nemotron 3 Super | 415B tokens |
| North Mini Code | 236B tokens |
| Laguna XS 2.1 | 166B tokens |
| Dots3-Note Preview | 62.3B tokens |
| Nemotron 3 Nano 30B A3B | 47B tokens |
| Nemotron 3 Nano Omni | 33.5B tokens |
| Gemma 4 26B A4B IT | 16.5B tokens |
| Llama Nemotron Rerank VL 1B V2 | 15.4B tokens |
| Nemotron Nano 9B V2 | 15B tokens |
| LFM2.5-2.6B | 11.3B tokens |
| rerank-2.5-lite | 10.8B tokens |
| gpt-oss-20b | 9.8B tokens |
| Nemotron Nano 12B 2 VL | 9.56B tokens |

## 9. Maintenance Checklist

When refreshing this document, update the capture date, canonical model IDs, context length, input and output modalities, tool and structured-output support, pricing, license, provider data policy, and any provider-specific limits. Reclassify a model if the live catalog changes its price from `$0/M`, and keep rerankers separate from chat models even when both are listed under free or discounted collections.

The model list should be regenerated from the provider API when possible. Human-written model cards should remain focused on routing decisions, privacy, licensing, and operational caveats rather than duplicating every provider metadata field.

## References

[1]: https://openrouter.ai/models "OpenRouter Models catalog"
