# 🎬 Visa Premiere

**Your brand's opening night.**

A one-click landing page builder for merchants powered by [Visa CLI](https://auth.visacli.sh). Pick a vibe, generate a full AI moodboard, and deploy a live branded site — all in under 3 minutes.

## What it does

1. **Pick a category** — Fashion, Beauty, Food & Bev, Tech/SaaS, Music, Crypto/Web3, Fitness, Creative
2. **Choose your aesthetic** — tap 1–3 keyword chips (Minimal, Luxury, Artisan, etc.)
3. **Name your brand** (optional)
4. **Generate Moodboard** — AI creates a hero image, lifestyle shot, texture, color palette, and brand soundtrack (~90s, ~$0.22)
5. **Not My Vibe?** — regenerate up to 3x with the same category and keywords
6. **Premiere Your Site** — Claude writes a full responsive landing page using your moodboard assets, then deploys it live to Netlify (~30s)

Every generated site includes:
- Hero, About Us, Shop/Services, CTA, Footer
- Category-specific inventory (6 boilerplate items per category)
- 3-paragraph brand story written in your voice
- Floating 🔊/🔇 background music toggle (your Suno-generated brand track)

## Setup

**Requirements:**
- Node.js 18+
- [Visa CLI](https://auth.visacli.sh) installed and authenticated
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- Netlify personal access token ([app.netlify.com](https://app.netlify.com) → User Settings → Access tokens)

```bash
git clone https://github.com/mmashiat/visa-premiere
cd visa-premiere
npm install

export ANTHROPIC_API_KEY=your_key_here
export NETLIFY_TOKEN=your_token_here

node server.js
# Open http://localhost:3002
```

## Cost per session

| Step | Tool | Cost |
|------|------|------|
| Hero image | FLUX Pro balanced | $0.04 |
| Lifestyle image | FLUX Pro balanced | $0.04 |
| Texture image | FLUX Pro balanced | $0.04 |
| Brand soundtrack | Suno v4 | $0.10 |
| **Moodboard total** | | **~$0.22** |
| Site generation | Claude Sonnet | ~$0.03 |
| Netlify deploy | Free | $0.00 |
| **Full session** | | **~$0.25** |

## Architecture

```
visa-premiere/
├── server.js        # Express backend — Visa CLI MCP + Anthropic SDK
├── public/
│   └── index.html   # Single-file frontend, vanilla JS, no build step
└── package.json
```

**Endpoints:**
- `POST /api/moodboard` — generates 4 assets in parallel via Visa CLI MCP
- `POST /api/buildsite` — Claude writes HTML; server injects audio + toggle
- `POST /api/deploy` — zips HTML, deploys to Netlify, returns live URL

## Powered by

- [Visa CLI](https://auth.visacli.sh) — AI generation via micropayments
- [Anthropic Claude](https://anthropic.com) — site generation
- [Suno](https://suno.com) — brand soundtrack
- [FLUX](https://fal.ai) — image generation
- [Netlify](https://netlify.com) — deployment
