import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import AdmZip from 'adm-zip';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const MCP_SERVER = process.env.VISA_MCP_PATH
  || new URL('./node_modules/@visa/cli/dist/mcp-server/index.js', import.meta.url).pathname;
const anthropic = new Anthropic();

// ─── Category definitions ────────────────────────────────────────────────────

const CATEGORIES = {
  fashion:  { label: 'Fashion / Apparel',      icon: '👗', keywords: ['Minimal', 'Luxury', 'Streetwear', 'Vintage', 'Bold'], scene: 'couture fashion editorial, model in architectural space', lifestyle: 'street style in urban setting', texture: 'woven fabric detail, thread close-up', mood: 'slow cinematic piano, subtle bass, fashion week atmosphere' },
  beauty:   { label: 'Beauty / Wellness',       icon: '✨', keywords: ['Clean', 'Ethereal', 'Clinical', 'Lush', 'Radiant'],  scene: 'beauty product flatlay, dewy skin close-up, studio light', lifestyle: 'morning skincare routine, soft bathroom light', texture: 'cream swirl, pearl shimmer, soft gradients', mood: 'soft ambient, delicate bell tones, spa tranquility' },
  foodbev:  { label: 'Food & Bev',              icon: '🍽️', keywords: ['Artisan', 'Fresh', 'Indulgent', 'Earthy', 'Vibrant'], scene: 'restaurant hero shot, styled food photography, overhead', lifestyle: 'friends sharing a meal at a sunlit rooftop', texture: 'ingredient overhead pattern, spices and herbs earthy tones', mood: 'warm acoustic guitar, light jazz, upbeat bistro feel' },
  techsaas: { label: 'Tech / SaaS',             icon: '💻', keywords: ['Sleek', 'Futuristic', 'Minimal', 'Bold', 'Human'],   scene: 'clean modern desk setup, glowing UI on screen, product mockup', lifestyle: 'remote worker in a bright modern cafe on laptop', texture: 'geometric grid, hexagonal pattern, dark background with light nodes', mood: 'minimal electronic, subtle arpeggios, focused productivity' },
  music:    { label: 'Music / Entertainment',   icon: '🎵', keywords: ['Raw', 'Dreamy', 'Hype', 'Underground', 'Iconic'],    scene: 'concert stage with dramatic spotlights, performer silhouette', lifestyle: 'backstage candid moment, fans in an electric crowd', texture: 'vinyl record macro close-up, audio waveform visualization', mood: 'lo-fi hip hop, vinyl crackle, late night chill beat' },
  crypto:   { label: 'Crypto / Web3',           icon: '⛓️', keywords: ['Cyber', 'Decentralized', 'Neon', 'Minimal', 'Bold'], scene: 'dark server room, glowing blockchain nodes, digital grid', lifestyle: 'crypto trader at multiple glowing screens, night city backdrop', texture: 'circuit board macro, hexagonal grid, dark background neon glow', mood: 'dark synth, pulsing bass, digital underground atmosphere' },
  fitness:  { label: 'Fitness / Health',         icon: '💪', keywords: ['Gritty', 'Clean', 'Athletic', 'Zen', 'Powerful'],   scene: 'athlete in powerful motion, dramatic gym environment, golden hour', lifestyle: 'outdoor workout at sunrise, yoga in nature', texture: 'athletic fabric close-up, carbon fiber texture, muscle definition macro', mood: 'driving electronic, punchy drums, motivational high energy' },
  creative: { label: 'Creative / Agency',        icon: '🎨', keywords: ['Avant-Garde', 'Playful', 'Refined', 'Experimental', 'Bold'], scene: 'design studio interior, large format prints on white wall', lifestyle: 'creative team brainstorming, sketchbooks and laptops scattered', texture: 'paint strokes macro, paper grain, ink splatter abstract', mood: 'eclectic indie, playful keys, artsy studio vibes' },
};

// ─── Visa CLI client (HTTP or MCP stdio) ─────────────────────────────────────

const VISA_API_BASE = 'https://auth.visacli.sh';
const VISA_CLI_VERSION = '1.15.0';

async function callMcpTool(toolName, args) {
  // On Vercel (or any env with VISA_SESSION_TOKEN), use direct HTTP — no child process needed
  if (process.env.VISA_SESSION_TOKEN) {
    return callVisaHttp(toolName, args);
  }
  // Local dev: use MCP stdio transport
  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_SERVER],
    env: { ...process.env },
  });
  const client = new Client({ name: 'visa-premiere', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await client.callTool({ name: toolName, arguments: args });
  } finally {
    await client.close();
  }
}

async function callVisaHttp(toolName, args) {
  // Map MCP tool names → catalog shortcut IDs
  const TOOL_MAP = {
    generate_image: args.tier === 'fast' ? 'fal-flux-schnell' : 'fal-flux-pro',
    generate_music: 'suno-music',
  };
  const toolId = TOOL_MAP[toolName] || toolName;

  // Strip MCP-specific args the catalog doesn't understand
  const { tier, user_context, ...params } = args;

  const res = await fetch(`${VISA_API_BASE}/v1/shortcuts/${toolId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VISA_SESSION_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Visa-CLI-Version': VISA_CLI_VERSION,
    },
    body: JSON.stringify({ ...params, user_context: user_context || toolName }),
  });
  const data = await res.json();
  if (!data.success && data.error) throw new Error(data.error);
  // Wrap in MCP-compatible shape so parseToolResult + extractUrl work unchanged
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function parseToolResult(result) {
  if (!result?.content) return null;
  for (const item of result.content) {
    if (item.type === 'text') {
      try { return JSON.parse(item.text); } catch { return item.text; }
    }
  }
  return null;
}

function extractUrl(result) {
  const data = parseToolResult(result);
  return data?.urls?.[0] ?? data?.data?.imageUrl ?? data?.data?.audioUrl ?? data?.url ?? null;
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function heroPrompt(cat, vibe, brand) {
  return `${brand} brand campaign, ${vibe} aesthetic, ${cat.scene}, editorial photography, cinematic lighting, ultra detailed, atmospheric, professional`;
}

function lifestylePrompt(cat, vibe, brand) {
  return `${brand} brand lifestyle, ${vibe} style, ${cat.lifestyle}, candid photography, natural light, authentic, aspirational`;
}

function texturePrompt(cat, vibe, brand) {
  return `Abstract brand texture for ${brand}, ${vibe} visual language, ${cat.texture}, seamless pattern, macro photography, brand identity material`;
}

function musicPrompt(cat, vibe) {
  return `Brand soundtrack, ${vibe} ${cat.label} business, ${cat.mood}, no lyrics, ambient background music, professional, loop-friendly`;
}

const SHOP_CONTEXT = {
  fashion:  { noun: 'Collection', items: ['Oversized Linen Shirt — $95', 'Tailored Wide-Leg Trouser — $135', 'Structured Blazer — $210', 'Slip Dress — $115', 'Merino Crew Knit — $145', 'Leather Tote — $265'] },
  beauty:   { noun: 'Products', items: ['Barrier Repair Serum — $68', 'Cloud Moisturiser — $54', 'Gentle Enzyme Cleanser — $42', 'Peptide Eye Cream — $78', 'SPF 50 Fluid — $38', 'Overnight Mask — $62'] },
  foodbev:  { noun: 'Menu', items: ['Signature Tasting Plate — $28', 'Chef\'s Daily Bowl — $18', 'Small Batch Cold Brew — $7', 'Weekend Brunch Set — $34', 'Seasonal Salad — $16', 'House-Made Pastry — $9'] },
  techsaas: { noun: 'Plans', items: ['Starter — Free forever', 'Growth — $29/mo', 'Pro — $79/mo', 'Team — $149/mo', 'Business — $299/mo', 'Enterprise — Custom'] },
  music:    { noun: 'Shop', items: ['Limited Edition Vinyl — $38', 'Tour Hoodie — $65', 'Signed Poster Print — $28', 'Backstage Pass Bundle — $120', 'Digital Album Download — $12', 'Exclusive Merch Box — $95'] },
  crypto:   { noun: 'Products', items: ['Genesis Access Pass — 0.08 ETH', 'Premium NFT Drop — 0.25 ETH', 'DAO Membership — 500 tokens', 'Staking Tier 1 — 1000 tokens', 'Yield Vault Entry — 0.5 ETH', 'OG Whitelist Spot — Free mint'] },
  fitness:  { noun: 'Plans', items: ['Drop-In Class — $22', '10-Class Pack — $180', 'Monthly Unlimited — $89/mo', 'Annual Membership — $799/yr', 'PT Session (60min) — $95', 'Online Programme — $49/mo'] },
  creative: { noun: 'Services', items: ['Brand Identity — from $2,500', 'Website Design — from $4,000', 'Campaign Creative — from $3,500', 'Social Strategy — from $1,200/mo', 'Art Direction — from $1,800', 'Brand Sprint (5 days) — $5,000'] },
};

const ABOUT_CONTEXT = {
  fashion:  'fashion label redefining how people dress with intention',
  beauty:   'skincare and wellness brand built on science, simplicity, and self-care',
  foodbev:  'food and beverage concept rooted in seasonal ingredients and honest craft',
  techsaas: 'software platform helping teams move faster without the overhead',
  music:    'music and entertainment project pushing the boundaries of sound and culture',
  crypto:   'Web3 project building tools for the decentralised economy',
  fitness:  'fitness and health studio helping people move better and feel stronger',
  creative: 'creative agency turning bold ideas into work that moves people',
};

function sitePrompt({ cat, categoryKey, keywords, brandName, heroUrl, lifestyleUrl, textureUrl, colors }) {
  const vibe = keywords.join(', ');
  const brand = brandName || 'Our Brand';
  const colorVars = (colors || []).map((c, i) => `  --color-${i + 1}: ${c};`).join('\n');
  const shop = SHOP_CONTEXT[categoryKey] || SHOP_CONTEXT.fashion;
  const aboutCtx = ABOUT_CONTEXT[categoryKey] || 'brand with a clear point of view';

  return `You are an expert web designer and frontend developer. Generate a complete, single-file HTML landing page for the following brand. Return ONLY the raw HTML — no markdown, no code fences, no explanation. All CSS in a <style> tag, all JS in a <script> tag.

BRAND BRIEF
-----------
Brand Name: ${brand}
Category: ${cat.label}
Aesthetic Keywords: ${vibe}
About: ${brand} is a ${vibe.toLowerCase()} ${aboutCtx}. Founded with a clear vision, ${brand} exists to serve people who value craft, intention, and quality over noise. Every decision — from how we source to how we communicate — reflects this.

ASSETS (use these exact URLs)
-----------
Hero Image (16:9): ${heroUrl}
Lifestyle Image (4:3): ${lifestyleUrl}
Texture / Pattern (1:1): ${textureUrl}

BRAND COLOR PALETTE
-----------
:root {
${colorVars}
}
${colors?.length ? `Primary: ${colors[0]}   Accent: ${colors[1] || colors[0]}` : ''}

REQUIRED SECTIONS
-----------
1. NAV — sticky, brand name left, links: About, ${shop.noun}, Story, Contact. (A floating audio toggle will be injected separately — do NOT add audio elements yourself.)

2. HERO — full-viewport, heroUrl as CSS background-image with gradient overlay for readability. Brand name as H1. A punchy one-line tagline that captures the ${vibe} aesthetic. Primary CTA button → #shop.

3. ABOUT — Two-column layout: lifestyleUrl on one side, text on the other. Write 3 paragraphs (4-5 sentences each) in the brand's voice:
   - Para 1: Origin story of ${brand} — why it was founded, what gap it fills, the founding belief
   - Para 2: How ${brand} approaches its craft/product/service differently — the ${vibe} philosophy in practice
   - Para 3: The customer ${brand} is built for — who they are, what they value, why ${brand} belongs in their life

4. SHOP (id="shop") — "${shop.noun}" section with a grid of exactly 6 items:
${shop.items.map((item, i) => `   ${i + 1}. ${item}`).join('\n')}
   Each item card: textureUrl as a subtle background accent, item name, price/tier, an "Add to Cart" or relevant CTA button. Cards should have hover effects.

5. CTA — Full-width bold section. Headline that creates urgency. Email signup input + button. Use brand accent color as background.

6. FOOTER — Brand name, nav links, social icons (Instagram, Twitter/X, TikTok as inline SVG), tagline, © ${new Date().getFullYear()} ${brand}.

TECHNICAL REQUIREMENTS
-----------
- Fully responsive, mobile-first, zero external dependencies (no CDN links except the one Google Font @import)
- One Google Font @import that matches the ${vibe} aesthetic
- CSS custom properties for all colors
- smooth-scroll on anchor links
- IntersectionObserver fade-ins are optional — if used, ALL sections must be visible by default (opacity:1, transform:none) so content shows even if JS fails
- Product/service cards: image accent, name, price, CTA button with hover state
- Mobile nav hamburger menu
- All images: loading="lazy", meaningful alt text
- Design must feel like a real ${cat.label} brand site — not a template. Match the ${vibe} energy in every detail

JAVASCRIPT RULES (critical)
-----------
- Wrap ALL JavaScript in a single IIFE: (function() { ... })(); — no variables or functions at the top level
- This prevents SyntaxError crashes from duplicate identifiers
- Keep JS minimal — only nav toggle and smooth scroll are required

CSS EFFICIENCY (critical — output has a token budget)
-----------
- Write compact, non-repetitive CSS. Use shorthand properties wherever possible.
- Use CSS custom properties and shared class names to avoid duplicating rules.
- Do NOT write long comments in the CSS. Keep selectors concise.
- The HTML body with all 6 sections MUST be complete. If CSS runs long, cut comments — never cut HTML sections.
- Every section (nav, hero, about, shop, cta, footer) and the audio element MUST appear in the final output.
- Output starts with <!DOCTYPE html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/moodboard', async (req, res) => {
  const { category, keywords, brandName } = req.body;
  const cat = CATEGORIES[category];
  if (!cat) return res.status(400).json({ error: 'Invalid request' });

  const vibe = keywords.join(', ');
  const brand = brandName?.trim() || 'the brand';
  const userCtx = `Brand Moodboard: ${cat.label} — ${vibe}${brandName ? ' — ' + brandName : ''}`;

  try {
    const [heroResult, lifestyleResult, textureResult, musicResult] = await Promise.all([
      callMcpTool('generate_image', { prompt: heroPrompt(cat, vibe, brand), tier: 'balanced', aspect_ratio: '16:9', user_context: userCtx }),
      callMcpTool('generate_image', { prompt: lifestylePrompt(cat, vibe, brand), tier: 'balanced', aspect_ratio: '4:3', user_context: userCtx }),
      callMcpTool('generate_image', { prompt: texturePrompt(cat, vibe, brand), tier: 'balanced', aspect_ratio: '1:1', user_context: userCtx }),
      callMcpTool('generate_music', { prompt: musicPrompt(cat, vibe), instrumental: true, user_context: userCtx }),
    ]);

    res.json({
      heroUrl: extractUrl(heroResult),
      lifestyleUrl: extractUrl(lifestyleResult),
      textureUrl: extractUrl(textureResult),
      musicUrl: extractUrl(musicResult),
      category: cat.label,
      icon: cat.icon,
      brandName: brandName?.trim() || '',
      keywords,
      totalCost: 0.22,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function injectAudio(html, musicUrl) {
  if (!musicUrl) return html;
  const snippet = `
<audio id="bgAudio" src="${musicUrl}" loop preload="none"></audio>
<button id="audioToggle" aria-label="Toggle background music" style="position:fixed;bottom:24px;right:24px;z-index:9999;width:46px;height:46px;border-radius:50%;border:none;background:rgba(0,0,0,0.65);color:#fff;font-size:1.25rem;cursor:pointer;backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.4);">🔇</button>
<script>
(function(){
  var audio = document.getElementById('bgAudio');
  var btn = document.getElementById('audioToggle');
  btn.addEventListener('click', function(){
    if (audio.paused) {
      audio.play().then(function(){ btn.textContent = '🔊'; }).catch(function(){});
    } else {
      audio.pause();
      btn.textContent = '🔇';
    }
  });
})();
</script>`;
  return html.includes('</body>') ? html.replace('</body>', snippet + '\n</body>') : html + snippet;
}

app.post('/api/buildsite', async (req, res) => {
  const { category, keywords, brandName, heroUrl, lifestyleUrl, textureUrl, colors, musicUrl } = req.body;
  const cat = CATEGORIES[category];
  if (!cat) return res.status(400).json({ error: 'Invalid category' });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      messages: [{ role: 'user', content: sitePrompt({ cat, categoryKey: category, keywords, brandName, heroUrl, lifestyleUrl, textureUrl, colors }) }],
    });

    const html = injectAudio(message.content[0].text, musicUrl);
    res.json({ html });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deploy', async (req, res) => {
  const { html, brandName } = req.body;
  const token = process.env.NETLIFY_TOKEN;
  if (!token) return res.status(400).json({ error: 'NETLIFY_TOKEN not set' });
  if (!html) return res.status(400).json({ error: 'No HTML provided' });

  try {
    // Create zip with index.html + _headers to force correct MIME type
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from(html, 'utf8'));
    zip.addFile('_headers', Buffer.from('/*\n  Content-Type: text/html; charset=UTF-8\n', 'utf8'));
    const zipBuffer = zip.toBuffer();

    // Create a new Netlify site
    const slug = (brandName || 'my-brand').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
    const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${slug}-${Date.now()}` }),
    });
    const site = await siteRes.json();
    if (!site.id) throw new Error(site.message || 'Failed to create Netlify site');

    // Deploy the zip
    const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/zip' },
      body: zipBuffer,
    });
    const deploy = await deployRes.json();
    const rawUrl = deploy.deploy_url || deploy.url || site.url;
    if (!rawUrl) throw new Error(deploy.message || 'Deploy failed');
    const url = rawUrl.replace(/^http:\/\//, 'https://');

    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3002, () => console.log('Visa Premiere running at http://localhost:3002'));
