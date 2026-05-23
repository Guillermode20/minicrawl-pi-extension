/**
 * MiniCrawl Extension
 *
 * Exposes MiniCrawl's self-hosted Firecrawl-compatible API as pi tools.
 * Requires the MiniCrawl server to be running on port 3000.
 *
 * Tools provided:
 * - minicrawl_scrape  — Scrape a URL into clean markdown with structured TL;DR summaries
 * - minicrawl_search  — Search the web with citation-style output
 * - minicrawl_crawl   — Crawl a website recursively
 * - minicrawl_map     — Discover all URLs on a website
 * - minicrawl_batch   — Scrape multiple URLs concurrently
 *
 * v2 — Enhanced JSON output with sections, token budgets, citations, and page type classification.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MINICRAWL_URL = "http://localhost:3000";
const MAX_MARKDOWN_PREVIEW = 5000;
const MAX_SECTION_PREVIEW = 800;

// ---------------------------------------------------------------------------
// Types matching the enhanced Go server response
// ---------------------------------------------------------------------------

interface ScrapeResult {
	url: string;
	markdown?: string;
	html?: string;
	metadata?: {
		title?: string;
		description?: string;
		language?: string;
		sourceURL?: string;
		statusCode?: number;
		published?: string;
		author?: string;
		siteName?: string;
	};
	json?: unknown;
	type?: string;
	word_count?: number;
	sections?: Array<{ heading: string; line_start: number; summary: string }>;
	content_chunks?: Array<{ index: number; token_estimate: number; content: string; start_line: number; end_line: number }>;
	truncation?: {
		max_tokens: number;
		total_tokens: number;
		remaining_sections?: Array<{ heading: string; char_count: number }>;
	};
}

interface SearchResult {
	url: string;
	title: string;
	markdown?: string;
	content?: string;
	highlight?: string;
	published_date?: string;
	source?: string;
	relevance_score?: number;
}

interface SearchResponse {
	data?: SearchResult[];
	total_results?: number;
	backend_used?: string;
	query?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callMiniCrawl(endpoint: string, body: unknown): Promise<unknown> {
	const res = await fetch(`${MINICRAWL_URL}/v1/${endpoint}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "unknown error");
		throw new Error(`MiniCrawl /v1/${endpoint} returned ${res.status}: ${text}`);
	}
	const json = await res.json();
	if (!json.success) {
		throw new Error(`MiniCrawl /v1/${endpoint} error: ${json.error ?? "unknown"}`);
	}
	return json.data;
}

function formatMarkdownPreview(md: string, maxChars = 2000): string {
	if (!md) return "(no content)";
	return md.length > maxChars ? md.slice(0, maxChars) + "\n\n… (truncated)" : md;
}

function escapeMd(text: string): string {
	return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// ---------------------------------------------------------------------------
// Tool: minicrawl_scrape
// ---------------------------------------------------------------------------

const scrapeTool = defineTool({
	name: "minicrawl_scrape",
	label: "MiniCrawl Scrape",
	description:
		"Scrape a URL into clean, LLM-ready markdown (or HTML, metadata, JSON). Handles JavaScript rendering and dynamic content automatically.",
	promptSnippet: "Scrape a URL into clean markdown",
	promptGuidelines: [
		"Use minicrawl_scrape when you need to extract the full text content of a web page as clean markdown.",
		"Prefer minicrawl_scrape over the read tool for HTML pages — it extracts meaningful content and strips UI chrome.",
	],
	parameters: Type.Object({
		url: Type.String({ description: "The URL to scrape" }),
		formats: Type.Optional(
			Type.Array(Type.String(), {
				description: 'Output formats: "markdown", "html", "metadata", "json". Default: ["markdown"]',
			}),
		),
		onlyMainContent: Type.Optional(
			Type.Boolean({ description: "Extract only the main article content (uses readability)" }),
		),
		timeout: Type.Optional(
			Type.Integer({ description: "Timeout in milliseconds (max 60000, default 30000)" }),
		),
		skipTlsVerification: Type.Optional(
			Type.Boolean({ description: "Skip TLS certificate verification" }),
		),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const data = (await callMiniCrawl("scrape", {
			url: params.url,
			formats: params.formats ?? ["markdown"],
			onlyMainContent: params.onlyMainContent ?? true,
			timeout: params.timeout ?? 30000,
			skipTlsVerification: params.skipTlsVerification ?? false,
		})) as ScrapeResult;

		const parts: string[] = [];

		// --- TL;DR Summary Block ---
		parts.push(`## 📄 ${data.metadata?.title || "(no title)"}`);
		parts.push(`- **URL:** ${data.url}`);
		if (data.metadata?.siteName) parts.push(`- **Site:** ${data.metadata.siteName}`);
		if (data.type) parts.push(`- **Type:** ${data.type}`);
		if (data.word_count) parts.push(`- **Word count:** ${data.word_count.toLocaleString()}`);
		if (data.metadata?.published) parts.push(`- **Published:** ${data.metadata.published}`);
		if (data.metadata?.author) parts.push(`- **Author:** ${data.metadata.author}`);
		if (data.metadata?.language) parts.push(`- **Language:** ${data.metadata.language}`);
		if (data.metadata?.statusCode) parts.push(`- **Status:** ${data.metadata.statusCode}`);
		if (data.metadata?.description) parts.push(`- **Description:** ${data.metadata.description}`);

		// --- Sections Preview (TL;DR first) ---
		if (data.sections && data.sections.length > 0) {
			parts.push("");
			parts.push("### 📑 Sections");
			for (const sec of data.sections) {
				const summary = sec.summary ? ` — ${sec.summary}` : "";
				parts.push(`- **${escapeMd(sec.heading)}** (line ${sec.line_start})${summary}`);
			}
		}

		// --- Truncation Warning ---
		if (data.truncation) {
			parts.push("");
			parts.push(`> ⛔ **Content truncated at ~${data.truncation.max_tokens.toLocaleString()} tokens** (page has ~${data.truncation.total_tokens.toLocaleString()} total)`);
			if (data.truncation.remaining_sections && data.truncation.remaining_sections.length > 0) {
				parts.push("> Remaining sections:");
				for (const rs of data.truncation.remaining_sections) {
					parts.push(`> - "${escapeMd(rs.heading)}" (${rs.char_count.toLocaleString()} chars)`);
				}
			}
			parts.push("> Use `sections: [...]` to fetch specific parts, or increase timeout.");
		}

		// --- Full Markdown Content ---
		if (data.markdown) {
			parts.push("");
			parts.push("---");
			parts.push("### 📝 Markdown Content");
			parts.push(formatMarkdownPreview(data.markdown, MAX_MARKDOWN_PREVIEW));
		}

		if (data.html) {
			parts.push("");
			parts.push(`--- HTML (${data.html.length.toLocaleString()} chars) ---`);
		}

		if (data.json) {
			parts.push("");
			parts.push("--- Structured Data ---");
			parts.push(JSON.stringify(data.json, null, 2).slice(0, 2000));
		}

		return {
			content: [{ type: "text", text: parts.join("\n") }],
			details: {
				url: data.url,
				title: data.metadata?.title,
				type: data.type,
				wordCount: data.word_count,
				sections: data.sections?.length ?? 0,
				contentLength: data.markdown?.length ?? 0,
				truncated: !!data.truncation,
			},
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: minicrawl_search
// ---------------------------------------------------------------------------

const searchTool = defineTool({
	name: "minicrawl_search",
	label: "MiniCrawl Search",
	description:
		"Search the web using SearXNG (if configured) or DuckDuckGo. Optionally scrape full page content from each result.",
	promptSnippet: "Search the web and optionally scrape full page content",
	promptGuidelines: [
		"Use minicrawl_search when you need to find information on the web — it returns live results with snippets.",
		"Set scrape:true when you need the full page content, not just snippets.",
		"Use minicrawl_search instead of web_search when you want more control over the number of results.",
	],
	parameters: Type.Object({
		query: Type.String({ description: "The search query" }),
		limit: Type.Optional(Type.Integer({ description: "Max results (default: 5, max: 20)" })),
		scrape: Type.Optional(
			Type.Boolean({ description: "Scrape the full content of each result (slower but richer)" }),
		),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const raw = (await callMiniCrawl("search", {
			query: params.query,
			limit: params.limit ?? 5,
			scrape: params.scrape ?? false,
		})) as SearchResult[] | SearchResponse;

		// Handle both old format (plain array) and new format (wrapped response)
		let results: SearchResult[];
		let totalResults = 0;
		let backendUsed = "unknown";

		if (Array.isArray(raw)) {
			results = raw;
			totalResults = raw.length;
		} else {
			results = (raw as SearchResponse).data ?? [];
			totalResults = (raw as SearchResponse).total_results ?? results.length;
			backendUsed = (raw as SearchResponse).backend_used ?? "unknown";
		}

		if (!results || results.length === 0) {
			return {
				content: [{ type: "text", text: `No search results found for "${params.query}".` }],
				details: { query: params.query, resultCount: 0 },
			};
		}

		// --- Top summary ---
		const parts: string[] = [
			`## 🔍 Search: "${params.query}"`,
			`- **Backend:** ${backendUsed}`,
			`- **Results shown:** ${results.length} / ${totalResults} total`,
			"",
		];

		// --- Citation-style results ---
		for (let i = 0; i < results.length; i++) {
			const r = results[i];
			const resultNum = i + 1;

			// Citation header
			parts.push(`### [${resultNum}] ${r.title}`);
			parts.push(`> **Source:** [${escapeMd(r.source || r.url)}](${r.url})`);

			if (r.published_date) parts.push(`> **Published:** ${r.published_date}`);
			if (r.relevance_score !== undefined) {
				parts.push(`> **Relevance:** ${(r.relevance_score * 100).toFixed(0)}%`);
			}

			// Snippet/content
			const snippet = r.content || r.highlight || "";
			if (snippet) {
				// Clean up and format the snippet
				const cleanSnippet = snippet.replace(/\s+/g, " ").trim();
				if (cleanSnippet.length > 0) {
					parts.push(">");
					parts.push(`> ${cleanSnippet.slice(0, 500)}`);
				}
			}

			// Citation inline reference
			parts.push(`> — [${escapeMd(r.source || r.url)}](${r.url})`);
			parts.push("");

			// Full scraped content (if scrape:true)
			if (r.markdown) {
				parts.push(`<details><summary>📄 Full content (${r.markdown.split(" ").length} words)</summary>`);
				parts.push("");
				parts.push(formatMarkdownPreview(r.markdown, 1500));
				parts.push("");
				parts.push("</details>");
				parts.push("");
			}
		}

		return {
			content: [{ type: "text", text: parts.join("\n").trim() }],
			details: {
				query: params.query,
				resultCount: results.length,
				totalResults,
				backendUsed,
			},
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: minicrawl_crawl
// ---------------------------------------------------------------------------

const crawlTool = defineTool({
	name: "minicrawl_crawl",
	label: "MiniCrawl Crawl",
	description:
		"Crawl a website starting from a URL, following links up to a configured depth and page limit. Returns scraped markdown for each page.",
	promptSnippet: "Crawl a website and extract content from multiple pages",
	promptGuidelines: [
		"Use minicrawl_crawl when you need content from multiple pages of a documentation site or blog.",
		"Start with depth:1 and increase if the first pass doesn't find enough content.",
		"Use minicrawl_map first to discover URLs, then scrape specific ones with minicrawl_scrape.",
	],
	parameters: Type.Object({
		url: Type.String({ description: "Starting URL to crawl" }),
		limit: Type.Optional(Type.Integer({ description: "Maximum pages to crawl (default: 10)" })),
		maxDepth: Type.Optional(Type.Integer({ description: "Maximum link depth to follow (default: 2)" })),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const pages = (await callMiniCrawl("crawl", {
			url: params.url,
			limit: params.limit ?? 10,
			maxDepth: params.maxDepth ?? 2,
		})) as Array<{ url: string; markdown: string; title: string; depth: number }>;

		if (!pages || pages.length === 0) {
			return {
				content: [{ type: "text", text: "No pages crawled." }],
				details: {},
			};
		}

		const parts: string[] = [
			`## 🕷️ Crawl Results`,
			`- **Start URL:** ${params.url}`,
			`- **Pages crawled:** ${pages.length}`,
			`- **Max depth:** ${params.maxDepth ?? 2}`,
			"",
		];

		// Summary table
		parts.push("| Depth | Title | URL |");
		parts.push("|-------|-------|-----|");
		for (const page of pages) {
			const shortUrl = page.url.length > 60 ? page.url.slice(0, 57) + "..." : page.url;
			parts.push(`| ${page.depth} | ${escapeMd(page.title || "(no title)")} | ${shortUrl} |`);
		}
		parts.push("");

		// Detailed content
		for (const page of pages) {
			parts.push(`### 📄 ${page.title || "(no title)"}`);
			parts.push(`- **URL:** ${page.url}`);
			parts.push(`- **Depth:** ${page.depth}`);
			if (page.markdown) {
				parts.push("");
				parts.push(formatMarkdownPreview(page.markdown, MAX_SECTION_PREVIEW));
			}
			parts.push("");
		}

		return {
			content: [{ type: "text", text: parts.join("\n").trim() }],
			details: { pagesCrawled: pages.length, startURL: params.url },
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: minicrawl_map
// ---------------------------------------------------------------------------

const mapTool = defineTool({
	name: "minicrawl_map",
	label: "MiniCrawl Map",
	description:
		"Discover all URLs on a website. Parses HTML links and attempts to read sitemap.xml.",
	promptSnippet: "Discover all URLs on a website",
	promptGuidelines: [
		"Use minicrawl_map to discover the URL structure of a website before crawling or scraping specific pages.",
		"Useful for documentation sites to find all available pages.",
	],
	parameters: Type.Object({
		url: Type.String({ description: "The website URL to map" }),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const urls = (await callMiniCrawl("map", {
			url: params.url,
		})) as string[];

		if (!urls || urls.length === 0) {
			return {
				content: [{ type: "text", text: `No URLs discovered on ${params.url}.` }],
				details: { url: params.url, discovered: 0 },
			};
		}

		// Organize URLs by path prefix for readability
		const categorized: Record<string, string[]> = {};
		for (const u of urls) {
			try {
				const parsed = new URL(u);
				const parts = parsed.pathname.split("/").filter(Boolean);
				const category = parts[0] || "(root)";
				if (!categorized[category]) categorized[category] = [];
				categorized[category].push(u);
			} catch {
				if (!categorized["(other)"]) categorized["(other)"] = [];
				categorized["(other)"].push(u);
			}
		}

		const parts: string[] = [
			`## 🗺️ Site Map: ${params.url}`,
			`- **Total URLs discovered:** ${urls.length}`,
			"",
		];

		for (const [category, categoryUrls] of Object.entries(categorized)) {
			parts.push(`### /${category}/`);
			for (const u of categoryUrls) {
				parts.push(`  • ${u}`);
			}
			parts.push("");
		}

		return {
			content: [{ type: "text", text: parts.join("\n") }],
			details: { url: params.url, discovered: urls.length, categories: Object.keys(categorized).length },
		};
	},
});

// ---------------------------------------------------------------------------
// Tool: minicrawl_batch
// ---------------------------------------------------------------------------

const batchTool = defineTool({
	name: "minicrawl_batch",
	label: "MiniCrawl Batch Scrape",
	description:
		"Scrape multiple URLs concurrently in one call. Returns markdown content for each URL.",
	promptSnippet: "Scrape multiple URLs at once",
	promptGuidelines: [
		"Use minicrawl_batch when you need to scrape several URLs at once instead of calling minicrawl_scrape repeatedly.",
		"Good for scraping a handful of known pages from a site map.",
	],
	parameters: Type.Object({
		urls: Type.Array(Type.String(), { description: "Array of URLs to scrape" }),
		formats: Type.Optional(
			Type.Array(Type.String(), {
				description: 'Output formats. Default: ["markdown"]',
			}),
		),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const raw = (await callMiniCrawl("batch-scrape", {
			urls: params.urls,
			formats: params.formats ?? ["markdown"],
		})) as ScrapeResult[] | { data?: ScrapeResult[]; total?: number };

		// Handle both old (plain array) and new (wrapped) response format
		let results: ScrapeResult[];
		let totalScraped = 0;

		if (Array.isArray(raw)) {
			results = raw;
			totalScraped = raw.length;
		} else {
			results = (raw as { data?: ScrapeResult[] }).data ?? [];
			totalScraped = (raw as { total?: number }).total ?? results.length;
		}

		if (!results || results.length === 0) {
			return {
				content: [{ type: "text", text: "No results from batch scrape." }],
				details: {},
			};
		}

		const parts: string[] = [
			`## 📚 Batch Scrape Results`,
			`- **Requested:** ${params.urls.length} URLs`,
			`- **Scraped:** ${totalScraped} pages`,
			"",
		];

		for (const r of results) {
			const title = r.metadata?.title || r.url;
			parts.push(`### 📄 ${escapeMd(title)}`);
			parts.push(`- **URL:** ${r.url}`);
			if (r.type) parts.push(`- **Type:** ${r.type}`);
			if (r.word_count) parts.push(`- **Words:** ${r.word_count.toLocaleString()}`);
			if (r.sections && r.sections.length > 0) {
				parts.push(`- **Sections:** ${r.sections.map(s => `"${s.heading}"`).join(", ")}`);
			}
			if (r.markdown) {
				parts.push("");
				parts.push(formatMarkdownPreview(r.markdown, 2000));
			}
			parts.push("");
		}

		return {
			content: [{ type: "text", text: parts.join("\n").trim() }],
			details: { scraped: totalScraped, requested: params.urls.length },
		};
	},
});

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool(scrapeTool);
	pi.registerTool(searchTool);
	pi.registerTool(crawlTool);
	pi.registerTool(mapTool);
	pi.registerTool(batchTool);

	// Silently verify MiniCrawl is reachable on startup (no console.log noise)
	fetch(`${MINICRAWL_URL}/health`, { signal: AbortSignal.timeout(2000) })
		.then((res) => res.json())
		.then((data) => {
			if (data.status !== "ok") {
				console.warn("[minicrawl] Server at localhost:3000 returned non-ok status");
			}
		})
		.catch(() => {
			// Silent fail — tools will show a clear error at runtime if server is down
		});
}
