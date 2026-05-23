# MiniCrawl Pi Extension 🔍

A [pi](https://pi.dev) extension that exposes [MiniCrawl](https://github.com/your-org/minicrawl)'s self-hosted API as LLM-callable tools. Works with any Firecrawl-compatible API.

## Tools Provided

| Tool | Description |
|------|-------------|
| `minicrawl_scrape` | Scrape a URL into clean, LLM-ready markdown (or HTML, metadata, JSON). Handles JavaScript rendering. |
| `minicrawl_search` | Search the web via SearXNG or DuckDuckGo, optionally scrape full page content from each result. |
| `minicrawl_crawl` | Crawl a website starting from a URL, with configurable depth and page limit. |
| `minicrawl_map` | Discover all URLs on a website (parses HTML links + sitemap.xml). |
| `minicrawl_batch` | Scrape multiple URLs concurrently in one call. |

## Requirements

- **pi** (the coding agent) — installed globally or locally
- **MiniCrawl server** (or any Firecrawl-compatible API) running on `localhost:3000`

### Quick Start: MiniCrawl

```bash
# Clone and start MiniCrawl (with SearXNG for built-in web search)
git clone https://github.com/your-org/minicrawl
cd minicrawl
docker compose up --build -d

# Verify it's running
curl localhost:3000/health
```

## Installation

### Option 1: Install as a pi package (recommended)

```bash
# From a local directory
pi install /path/to/minicrawl-pi-extension

# Or from git (once pushed)
pi install git:github.com/your-org/minicrawl-pi-extension
```

### Option 2: Manual placement

Copy `minicrawl.ts` into pi's global extensions directory:

```bash
cp minicrawl.ts ~/.pi/agent/extensions/minicrawl.ts
```

Then reload pi with `/reload` or restart it.

### Option 3: Use with `-e` flag (for testing)

```bash
pi -e /path/to/minicrawl-pi-extension/minicrawl.ts
```

## Configuration

By default, the extension connects to `http://localhost:3000` (MiniCrawl's default port).

To connect to a remote or differently-configured MiniCrawl instance, edit the `MINICRAWL_URL` constant at the top of `minicrawl.ts`:

```typescript
const MINICRAWL_URL = "http://localhost:3000";
```

## Usage

Once installed, pi's LLM will automatically discover and use these tools. You can reference them in prompts like:

- "Scrape https://example.com into markdown"
- "Search for the latest Go release notes"
- "Crawl the docs at https://docs.example.com"
- "Map all URLs on https://example.com"
- "Batch scrape these three URLs"

## Tool Details

### `minicrawl_scrape`

Scrapes a single URL with rich, LLM-ready output:

- **Structured metadata** — title, description, language, published date, author, site name
- **Page type classification** — `documentation`, `blog`, `api-ref`, `forum`, `landing`, `web`
- **Section extraction** — headings with line numbers and summaries
- **Content chunking** — content split into ~4K-token chunks aligned to sections
- **Truncation handling** — warns when content exceeds the token budget, lists remaining sections

Parameters:
- `url` (required) — The URL to scrape
- `formats` — Output formats: `"markdown"`, `"html"`, `"metadata"`, `"json"` (default: `["markdown"]`)
- `onlyMainContent` — Extract only the main article content via readability (default: `true`)
- `timeout` — Timeout in milliseconds (max 60000, default 30000)
- `skipTlsVerification` — Skip TLS certificate verification

### `minicrawl_search`

Searches the web with citation-style output and optional full-page scraping.

Parameters:
- `query` (required) — The search query
- `limit` — Max results (default: 5, max: 20)
- `scrape` — Scrape full page content of each result (default: `false`)

### `minicrawl_crawl`

Recursively crawls a website BFS-style with concurrent workers.

Parameters:
- `url` (required) — Starting URL
- `limit` — Max pages to crawl (default: 10)
- `maxDepth` — Max link depth to follow (default: 2)

### `minicrawl_map`

Discovers all URLs on a site by parsing HTML links and sitemap.xml.

Parameters:
- `url` (required) — The website URL to map

### `minicrawl_batch`

Scrapes multiple URLs concurrently in a single call.

Parameters:
- `urls` (required) — Array of URLs to scrape
- `formats` — Output formats (default: `["markdown"]`)

## Development

```bash
# Clone
git clone https://github.com/your-org/minicrawl-pi-extension
cd minicrawl-pi-extension

# No build step needed — pi uses jiti to load TypeScript directly

# Edit and test
pi -e ./minicrawl.ts
```

## License

MIT
