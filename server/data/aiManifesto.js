/**
 * AI Investment Manifesto — 5 structural themes.
 *
 * Sourced from an April-2026 video thesis by the app owner. Seed is
 * idempotent (upsert-by-slug), so re-running does not duplicate rows
 * and lets non-destructive seeds top up missing constituents.
 *
 * IMPORTANT — tickers here are ONLY the ones the source thesis explicitly
 * names. Don't pad with "similar" tickers: the point of this data is to
 * mirror one investor's stated view, not to be a general AI basket.
 *
 * Disclaimer: this is NOT investment advice. The UI surfaces this text
 * prominently; do not remove it.
 */

const DISCLAIMER =
  'This thesis is one investor\'s view, not investment advice. ' +
  'Tickers, scores, and commentary reflect a snapshot in time and will ' +
  'decay. Do your own research before acting on any of it.';

export const AI_MANIFESTO_THEMES = [
  {
    slug: 'semiconductor-scarcity',
    name: 'Semiconductor Scarcity',
    tagline: 'Real supply bottleneck across HBM, CPUs, advanced packaging, and power.',
    order: 1,
    thesisMd:
`**Thesis.** AI demand is growing **exponentially** while semiconductor supply can only grow linearly (fabs take years to build). The bottleneck shows up in four layers, all at once:

- **HBM memory** — Samsung, Micron, SK Hynix capacity is sold out.
- **CPUs / system chips** — agentic AI stacks need server-class CPUs (Nvidia Grace, Intel Xeon). TSMC capacity for these is constrained; Intel benefits because it can produce CPUs.
- **Advanced packaging (CoWoS)** — TSMC effectively monopolises this. Doubled capacity, still not enough.
- **Power delivery** — 800W racks are the new floor; IC design for that is a separate shortage.

**Signal.** Anthropic/Claude run-rate went from $9M to $30M in four months; OpenAI token volume +150% in six months; rental GPU hours (Blackwell) repriced from $2.75/hr to $4.08/hr. Demand is not theoretical.`,
    disclaimer: DISCLAIMER,
    constituents: [
      { symbol: 'NVDA', rationale: 'Designs the GPUs at the centre of the shortage; demand outruns supply.' },
      { symbol: 'AMD',  rationale: 'Second source for AI accelerators; customers accept ~25% non-Nvidia mix.' },
      { symbol: 'TSM',  rationale: 'Sole advanced-packaging (CoWoS) provider at scale — effective monopoly.' },
      { symbol: 'INTC', rationale: 'Has CPU fab capacity that Nvidia Grace-class demand is pulling on.' },
      { symbol: 'MU',   rationale: 'HBM3/HBM3e — hyperscaler allocations locked a year out.' },
      { symbol: 'SNDK', rationale: 'Memory-adjacent; benefits from broader memory tightness.' },
    ],
  },
  {
    slug: 'ai-networking',
    name: 'AI Networking / Interconnect',
    tagline: 'Per-GPU compute is a solved problem. The new bottleneck is bandwidth between them.',
    order: 2,
    thesisMd:
`**Thesis.** With Blackwell/Blackwell Ultra, the old "compute per GPU" story is giving way to a **bandwidth** story. Vera Rubin doubles total rack bandwidth (260 TB/s) and multiplies NVLink fan-out. Each new generation needs **5–9× more networking components per GPU node**.

- Nvidia's own networking revenue grew 162% YoY; $8.2B last quarter, +13% QoQ.
- 75% of customers take Nvidia's whole stack — but 25% go outside, which is where Marvell and Broadcom win.
- Copper isn't going away (NVLink), but optical (CPO) is the growth vector.

**Signal.** When Nvidia reports, watch the **networking** line independently of datacenter — that's the leading indicator.`,
    disclaimer: DISCLAIMER,
    constituents: [
      { symbol: 'NVDA', rationale: 'NVLink/MVLink switches; networking is the fastest-growing segment.' },
      { symbol: 'MRVL', rationale: 'Custom ASIC/interconnect silicon for the non-Nvidia 25%.' },
      { symbol: 'AVGO', rationale: 'Tomahawk/Jericho switch silicon; custom accelerators for hyperscalers.' },
    ],
  },
  {
    slug: 'ai-energy',
    name: 'Energy for AI',
    tagline: 'Getting GPUs is easy. Getting the grid to power them is the real bottleneck.',
    order: 3,
    thesisMd:
`**Thesis.** Per-rack power draw is exploding — H200 at 70 kW, GB200 NVL72 at 120 kW, Vera Rubin at 200 kW, Rubin Ultra projected at **600 kW**. But **70% of existing data centres were built for 4–9 kW racks**, and only 2% can handle 50+ kW today.

New grid connections in the US take **3–7 years**. Workarounds:

- **Behind-the-meter** generation (months to 1 year).
- **Bloom Energy**-style fuel cells (~3 months).
- **Bitcoin-miner retrofits** (IREN et al.) — weeks to months.

**Signal.** China has ~2× surplus generation capacity; US reserve margin is ~15%. This is structural, not a cycle.`,
    disclaimer: DISCLAIMER,
    constituents: [
      { symbol: 'BE',   rationale: 'Solid-oxide fuel cells — fastest path to bankable AI-DC power.' },
      { symbol: 'IREN', rationale: 'Bitcoin miner retrofitting existing grid capacity to AI compute.' },
    ],
  },
  {
    slug: 'inference',
    name: 'Inference Boom',
    tagline: 'The training phase was R&D. Inference is where the money gets made.',
    order: 4,
    thesisMd:
`**Thesis.** Model **training** consumed enormous compute with poor ROI and made the big-AI-lab capex numbers look crazy. **Inference** is different:

- Output tokens dominate input tokens 10:1 in production workloads.
- Inference is **memory-bandwidth bound**, not FLOPS-bound — which is why Micron and SanDisk are repricing.
- Workloads shift from the companies that built the models to the companies that **deploy** them (Anthropic/Claude is the current leader).

**Signal.** Watch HBM pricing + LPDDR allocations — when memory vendors raise guidance, inference demand is real.`,
    disclaimer: DISCLAIMER,
    constituents: [
      { symbol: 'MU',   rationale: 'HBM is the critical path for inference latency.' },
      { symbol: 'SNDK', rationale: 'Memory density plays into inference serving cost.' },
      { symbol: 'NVDA', rationale: 'Still the inference platform of choice for new deployments.' },
    ],
  },
  {
    slug: 'photonics',
    name: 'Silicon Photonics / CPO',
    tagline: 'Copper runs out of headroom. Light is how the next-gen AI rack talks to itself.',
    order: 5,
    thesisMd:
`**Thesis.** As AI architectures grow and inference scales, copper interconnect can't keep up. **Silicon photonics** and **co-packaged optics (CPO)** move the light-to-electrons conversion onto the chip package.

- Optical-module revenue growing ~12× 2025→2026.
- Nvidia committed ~$4B into the optics supply chain — invested in Coherent, invested in Lumentum, and Marvell pulls in dollars here too.
- Energy efficiency and token/sec/watt improve materially once optics are inside the rack.

**Signal.** Applied Optoelectronics (AAOI) went from $28 → $159 over the last year as investors priced in the CPO shift. Valuations are stretched in parts — find the laggards inside the theme.`,
    disclaimer: DISCLAIMER,
    constituents: [
      { symbol: 'AAOI', rationale: 'Small-cap photonics name with the fastest revenue growth in the set.' },
      { symbol: 'COHR', rationale: 'Coherent — Nvidia direct investment; CPO transceiver supplier.' },
      { symbol: 'LITE', rationale: 'Lumentum — Nvidia direct investment; datacom optics.' },
      { symbol: 'MRVL', rationale: 'Custom electro-optic silicon for hyperscaler CPO programs.' },
    ],
  },
];

/**
 * Upsert every theme + its constituents by slug. Safe to call repeatedly.
 * @param {{ Theme: any, ThemeConstituent: any }} models
 */
export async function seedAiManifesto({ Theme, ThemeConstituent }) {
  for (const t of AI_MANIFESTO_THEMES) {
    const [theme] = await Theme.findOrCreate({
      where: { slug: t.slug },
      defaults: {
        slug: t.slug,
        name: t.name,
        tagline: t.tagline,
        thesisMd: t.thesisMd,
        disclaimer: t.disclaimer,
        order: t.order,
      },
    });

    // Keep the text fields fresh on re-runs — thesis copy may be edited.
    await theme.update({
      name: t.name,
      tagline: t.tagline,
      thesisMd: t.thesisMd,
      disclaimer: t.disclaimer,
      order: t.order,
    });

    for (const c of t.constituents) {
      const [row] = await ThemeConstituent.findOrCreate({
        where: { themeId: theme.id, symbol: c.symbol },
        defaults: { themeId: theme.id, symbol: c.symbol, rationale: c.rationale, weight: 1.0 },
      });
      if (row.rationale !== c.rationale) {
        await row.update({ rationale: c.rationale });
      }
    }
  }
  const tCount = await Theme.count();
  const cCount = await ThemeConstituent.count();
  console.log(`  Seeded ${tCount} themes with ${cCount} constituents.`);
}
