#!/usr/bin/env node
// Writes fixtures/notebooks/demo-sales.ipynb, the notebook the walkthrough and the
// README use: Markdown with LaTeX, a pandas table, a matplotlib-style PNG (drawn on
// a Chromium canvas, so no Python is needed), an SVG chart, a stream, a warning,
// a traceback with ANSI colours and VS Code execution timings.
//
//   node scripts/showcase/demo-notebook.mjs
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const out = fileURLToPath(new URL('../../fixtures/notebooks/demo-sales.ipynb', import.meta.url))
const regions = [['North', 412_300], ['South', 298_750], ['East', 356_100], ['West', 471_900], ['Central', 187_400]]

async function barChartPng() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const data = await page.evaluate((rows) => {
    const c = document.createElement('canvas')
    c.width = 640; c.height = 320
    const g = c.getContext('2d')
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 640, 320)
    g.font = '14px sans-serif'; g.fillStyle = '#222'
    g.fillText('Revenue by region, Q3 (USD)', 210, 24)
    const max = Math.max(...rows.map((r) => r[1]))
    g.strokeStyle = '#999'; g.beginPath(); g.moveTo(60, 40); g.lineTo(60, 280); g.lineTo(620, 280); g.stroke()
    rows.forEach(([name, value], i) => {
      const h = (value / max) * 220
      const x = 90 + i * 105
      g.fillStyle = '#1f77b4'; g.fillRect(x, 280 - h, 60, h)
      g.fillStyle = '#222'; g.font = '12px sans-serif'
      g.fillText(name, x + 4, 298)
      g.fillText(`${Math.round(value / 1000)}k`, x + 12, 274 - h)
    })
    return c.toDataURL('image/png').split(',')[1]
  }, regions)
  await browser.close()
  return data
}

function svgLine() {
  const months = [182, 196, 205, 221, 214, 238, 251, 263, 279]
  const pts = months.map((v, i) => `${40 + i * 45},${200 - (v - 170) * 1.6}`).join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="230" viewBox="0 0 440 230">
  <rect width="440" height="230" fill="#ffffff"/>
  <text x="120" y="20" font-family="sans-serif" font-size="13" fill="#222">Monthly orders, Jan to Sep</text>
  <line x1="40" y1="205" x2="420" y2="205" stroke="#999"/>
  <polyline points="${pts}" fill="none" stroke="#d62728" stroke-width="2.5"/>
  ${months.map((v, i) => `<circle cx="${40 + i * 45}" cy="${200 - (v - 170) * 1.6}" r="3.5" fill="#d62728"/>`).join('')}
</svg>`
}

const table = (head, rows) => `<div>
<table border="1" class="dataframe">
  <thead><tr style="text-align: right;"><th></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>
${rows.map((r) => `    <tr><th>${r[0]}</th>${r.slice(1).map((v) => `<td>${v}</td>`).join('')}</tr>`).join('\n')}
  </tbody>
</table>
</div>`

let t = Date.parse('2026-10-30T09:00:00.000Z')
const timing = (ms) => {
  const start = new Date(t).toISOString(); t += ms
  const end = new Date(t).toISOString(); t += 400
  return { execution: { 'iopub.execute_input': start, 'iopub.status.busy': start, 'shell.execute_reply': end, 'iopub.status.idle': end } }
}
const md = (id, source) => ({ id, cell_type: 'markdown', metadata: {}, source })
const code = (id, n, ms, source, outputs) => ({ id, cell_type: 'code', execution_count: n, metadata: timing(ms), source, outputs })
const text = (s) => s.split(/(?<=\n)/)

export async function demoNotebook() {
  const png = await barChartPng()
  const cells = [
    md('intro', text('# Quarterly sales review\n\nAn agent cleaned the Q3 orders, rebuilt the regional totals and checked the growth rate. Growth is\n$g_t = \\dfrac{S_t - S_{t-1}}{S_{t-1}}$, where $S_t$ is the revenue of month $t$.')),
    code('load', 1, 840, text('import pandas as pd\n\norders = pd.read_csv("sales_q3.csv", parse_dates=["date"])\nprint(f"Loaded {len(orders):,} orders from sales_q3.csv")'), [
      { output_type: 'stream', name: 'stdout', text: ['Loaded 1,248 orders from sales_q3.csv\n'] },
    ]),
    md('clean-h', text('## 1. Clean the data\n\n- Drop the 14 test orders.\n- Fill missing `discount` with 0.')),
    code('clean', 2, 120, text('orders = orders[~orders["is_test"]].fillna({"discount": 0})\norders.head()'), [
      { output_type: 'execute_result', execution_count: 2, metadata: {}, data: {
        'text/html': text(table(['order', 'date', 'region', 'units', 'price', 'discount'], [
          [0, 10231, '2026-07-01', 'North', 3, '129.00', '0.00'],
          [1, 10232, '2026-07-01', 'West', 1, '899.00', '0.10'],
          [2, 10233, '2026-07-02', 'East', 12, '19.50', '0.00'],
          [3, 10234, '2026-07-02', 'South', 2, '249.00', '0.05'],
          [4, 10235, '2026-07-03', 'Central', 5, '64.90', '0.00'],
        ])),
        'text/plain': ['   order        date   region  units  price  discount\n0  10231  2026-07-01  North      3  129.0      0.00'],
      } },
    ]),
    md('region-h', text('## 2. Revenue by region')),
    code('region', 3, 310, text('revenue = (orders.assign(total=orders.units * orders.price * (1 - orders.discount))\n                  .groupby("region")["total"].sum().sort_values(ascending=False))\nrevenue.to_frame()'), [
      { output_type: 'execute_result', execution_count: 3, metadata: {}, data: {
        'text/html': text(table(['total'], [['West', '471,900'], ['North', '412,300'], ['East', '356,100'], ['South', '298,750'], ['Central', '187,400']])),
        'text/plain': ['region\nWest     471900\nNorth    412300'],
      } },
    ]),
    code('plot', 4, 1450, text('ax = revenue.reindex(["North", "South", "East", "West", "Central"]).plot.bar(title="Revenue by region, Q3 (USD)")\nax.figure.savefig("revenue.png")'), [
      { output_type: 'display_data', metadata: {}, data: { 'image/png': png, 'text/plain': ['<Figure size 640x320 with 1 Axes>'] } },
    ]),
    md('growth-h', text('## 3. Growth\n\nAverage monthly growth over the quarter:\n\n$$\\bar g = \\frac{1}{n}\\sum_{t=1}^{n} \\frac{S_t - S_{t-1}}{S_{t-1}} \\approx 4.6\\%$$')),
    code('trend', 5, 260, text('from IPython.display import SVG\nSVG(filename="orders_by_month.svg")'), [
      { output_type: 'display_data', metadata: {}, data: { 'image/svg+xml': text(svgLine()), 'text/plain': ['<IPython.core.display.SVG object>'] } },
    ]),
    md('checks-h', text('## 4. Checks')),
    code('warn', 6, 90, text('monthly = orders.resample("M", on="date")["units"].sum()'), [
      { output_type: 'stream', name: 'stderr', text: ['FutureWarning: \'M\' is deprecated and will be removed in a future version, please use \'ME\' instead.\n'] },
    ]),
    code('check', 7, 40, text('assert orders["region_code"].notna().all(), "every order needs a region code"'), [
      { output_type: 'error', ename: 'KeyError', evalue: "'region_code'", traceback: [
        '\u001b[0;31m---------------------------------------------------------------------------\u001b[0m',
        '\u001b[0;31mKeyError\u001b[0m                                  Traceback (most recent call last)',
        '\u001b[0;32m<ipython-input-7>\u001b[0m in \u001b[0;36m<module>\u001b[0;34m\u001b[0m\n\u001b[0;32m----> 1\u001b[0;31m \u001b[0;32massert\u001b[0m \u001b[0morders\u001b[0m\u001b[0;34m[\u001b[0m\u001b[0;34m"region_code"\u001b[0m\u001b[0;34m]\u001b[0m\u001b[0;34m.\u001b[0m\u001b[0mnotna\u001b[0m\u001b[0;34m(\u001b[0m\u001b[0;34m)\u001b[0m\u001b[0;34m.\u001b[0m\u001b[0mall\u001b[0m\u001b[0;34m(\u001b[0m\u001b[0;34m)\u001b[0m\u001b[0;34m\u001b[0m\u001b[0m',
        "\u001b[0;31mKeyError\u001b[0m: 'region_code'",
      ] },
    ]),
    md('next-h', text('## 5. Next steps\n\n1. Add `region_code` in the export job.\n2. Re-run the checks.\n3. Share the regional totals with finance.')),
  ]
  return {
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.12.7' },
      title: 'Quarterly sales review',
    },
    nbformat: 4,
    nbformat_minor: 5,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(out, JSON.stringify(await demoNotebook(), null, 1) + '\n')
  console.log('wrote', out)
}
