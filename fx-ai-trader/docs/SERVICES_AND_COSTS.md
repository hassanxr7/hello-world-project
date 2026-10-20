# External services, licences, subscriptions and costs

Prices change. The figures below are indications as of writing; check current terms.

| Item | Needed? | Cost | Notes |
|---|---|---|---|
| MetaTrader 4 terminal | Yes | Free via your broker | MetaQuotes licence through the broker. Some brokers have stopped offering new MT4 accounts |
| Broker demo account | Yes (start) | Free | Demo fills are not identical to live fills |
| Broker live account | Only after validation | Spreads, commissions (e.g. ~USD 7 per lot round turn on raw-spread accounts), swaps | Enter your real commission in `risk.commission_per_lot_round_turn` |
| Windows VPS | Recommended for 24/5 operation | Typically ~USD 10–40/month for 2 vCPU / 4 GB | Choose a region near the broker's servers |
| Python and libraries | Yes | Free | Licences below |
| Anthropic API (Claude) | Optional (`llm.mode`) | Pay per token. Default model `claude-opus-5-5`: USD 4 / 1M input tokens, USD 20 / 1M output tokens (thinking tokens bill as output) | A review is ~1–2k input and up to a few thousand output tokens, about USD 0.01–0.06. The default caps are 40 calls and USD 2 per day |
| Economic calendar | Optional | Free CSVs exist (check each site's terms); licensed real-time feeds are paid | Not bundled. The CSV format is in `fxai/news/calendar.py` |
| Historical data | For backtests | Free from your own MT4 export or public datasets | The validation used the public Oanda mirror `github.com/FutureSharks/financial-data` (not redistributed here; check Oanda's terms). Dukascopy offers free tick data with bid/ask (better spreads) |

## Software licences (runtime)

| Package | Licence |
|---|---|
| numpy, pandas, scipy, scikit-learn, joblib, threadpoolctl | BSD-3-Clause |
| cloudpickle, starlette, uvicorn, Jinja2, MarkupSafe, httpx, click, idna | BSD-3-Clause |
| pydantic, pydantic-core, PyYAML, FastAPI, python-multipart, anyio, annotated-types, typing-extensions*, narwhals | MIT (*typing-extensions: PSF) |
| tzdata | Apache-2.0 |
| anthropic (optional) | MIT |
| pytest (dev) | MIT |

No GPU, no paid ML platform and no cloud database are required.
