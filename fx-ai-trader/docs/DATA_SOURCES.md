# Market and event data: what is used, what exists, and what this system cannot see

Checked on 2026-10-21. Prices and terms change, and several were **not verifiable** from public
pages. They are marked as such. Confirm the licence for your use before buying or building on
any source.

## What the system uses today

| Use | Source | Quality notes |
|---|---|---|
| Live decisions and execution | Your broker's MT4 quotes and bars, exported by the EA | The prices you actually trade on. MT4 bars are built from **bid** prices. The EA reports the spread at each snapshot, not per historical bar. Data path latency is about 0.5–1 s (EA timer, then the state file), which is irrelevant for decisions on completed M15–H4 bars |
| Research (development, validation, "known") | Oanda M1 **mid** prices, public mirror `FutureSharks/financial-data`; EURUSD, GBPUSD, USDCAD, AUDUSD, 2005 to 2020-05 | One provider's prices. No bid/ask, so spreads are **modelled** (`fxai/backtest/costs.py`). No JPY, CHF or NZD pairs. Nothing after 2020-05-14 |
| Final holdout (plan v2, stage 3) | Your broker's history via `FXAI_ExportHistory.mq4` | Exactly your broker's prices. History depth is broker-dependent: H1 usually covers years, M1 often only months |

## What this system does not have, and does not pretend to have

- **No consolidated order book or traded volume.** Spot FX is over-the-counter. Any "order book"
  or "volume" comes from a single venue or a single broker's clients. In MT4, tick "volume" is
  the number of price changes, not traded size. None of the strategies use order flow, and the
  dashboard never claims institutional or order-book insight.
- **No news or sentiment feed.** The economic calendar is read only from a CSV file you
  configure. Without one, the dashboard and the scan say "no verified economic calendar
  configured" and events are not assessed.

## Candidate sources

| Source | What it is | Coverage | Quality | Latency | Cost / licence | Fit here |
|---|---|---|---|---|---|---|
| **Your broker (MT4 history, export script)** | Bars and spreads of the account you trade | Broker-dependent depth | The ground truth for your costs and fills | Live | Free | **Required** for the final holdout and the demo forward test |
| **Dukascopy historical data feed** | Tick **bid/ask** with volumes from Dukascopy's own ECN | Majors from the mid-2000s; many pairs incl. JPY/CHF/NZD | Real quoted spreads (Dukascopy's, not your broker's) | Historical; ticks available up to the previous hour | Free to download. Third-party tools exist, but the official terms of use were **not verified** here; check redistribution and automated-download rules | **Best free upgrade for research**: real spreads, more pairs, data after 2020 |
| **TrueFX (Integral)** | Top-of-book tick bid/ask, millisecond timestamps | Since 2009, majors | Interbank-style top of book | Historical by month; real-time feed | Free account. Commercial-use terms **not verified** | An independent second source for robustness checks |
| **OANDA v20 REST API** | Candles with bid, ask and mid components | Many pairs; history depth per granularity **not verified** | Single provider, documented API | Real-time and historical | Requires an OANDA account (practice accounts exist); max 5,000 candles per request | Extends the current research data past 2020-05 with bid/ask |
| **CME FX futures (e.g. 6E, M6E) via Databento** | Exchange market-by-order (full depth) and trades | GLBX.MDP3 coverage from 2010 | Regulated exchange data: genuine order book and traded volume | Historical and live | Usage-based; historical listed "from $0.50/GB" (schema-dependent; live use adds CME licensing) | The only real order-book data near FX. Futures are not spot (basis, roll, sessions); justified only by a pre-registered order-flow hypothesis |
| **LSEG Tick History / Bloomberg** | Institutional multi-venue tick and quote history | Very broad | High | Real-time and historical | Enterprise contracts; quote on request (not public) | Out of proportion for this system |
| **Polygon.io (rebranded "Massive")** | Forex aggregates and quotes via REST/WebSocket | Many pairs | Aggregated vendor data | Real-time and historical | Individual plans are non-commercial; commercial use needs a business plan; prices **not verified** | Possible alternative to Dukascopy/TrueFX |

### Economic calendars

| Source | Notes | Cost |
|---|---|---|
| **Trading Economics API** | Licensed calendar with push updates at release time | Official page: priced by features, volume and redistribution. Third-party listings (June 2026) quote about USD 149–299 per month billed yearly, but another listing shows USD 199 per month billed monthly. **Confirm with the vendor** |
| Forex Factory, Investing.com | No official API; scraping would likely break their terms | Not supported |
| Other API vendors with calendar endpoints | Exist on paid tiers | Not evaluated in detail |

Even with a licensed feed, `fxai` uses events only as an entry **blackout** (`news.*`
settings), never as trade signals, because no event strategy has been validated.

## Recommendation, in order

1. **Export your broker's history now** (H1/H4/D1 from 2020-06, plus whatever M1 the broker
   provides). Plan v2 needs it as the untouched final holdout, and it costs nothing.
2. **For any new research, add Dukascopy (or TrueFX) bid/ask data** to get real spreads, more
   pairs and post-2020 history. Pre-register any new idea before running it. Data from 2020-06
   on has not been used by this project, and it should be spent only once, on a final test.
3. **Add a licensed calendar only if you want news blackouts.** A small adapter that writes the
   CSV format in `fxai/news/calendar.py` is all that is needed.
4. **Buy futures order-book data only for a specific, pre-registered order-flow hypothesis.**

## Sources consulted

- Databento futures data and pricing model: <https://databento.com/futures>, M6E catalog <https://databento.com/catalog/cme/GLBX.MDP3/futures/M6E>
- Trading Economics API and pricing: <https://www.tradingeconomics.com/api>, <https://de.tradingeconomics.com/api/pricing.aspx>, third-party summary <https://apis.io/plans/tradingeconomics/tradingeconomics-plans-pricing/>
- Dukascopy feed via third-party tools (official terms not found): <https://github.com/theorycraft-trading/dukascopy>, <https://pypi.org/project/tickterial>
- TrueFX via third-party R package documentation: <https://rdrr.io/cran/TFX>, <https://truefx.r-forge.r-project.org/>
- OANDA v20 candles via the oandapyV20 library docs: <https://oanda-api-v20.readthedocs.io/en/latest/contrib/factories/instrumentscandlesfactory.html>
- Polygon/Massive plan terms via an integration guide: <https://help.boomi.com/docs/Atomsphere/Connect/MCPConnectors/polygon>
