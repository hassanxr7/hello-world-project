#!/usr/bin/env bash
# Fetch the public Oanda M1 dataset used by the validation report (EURUSD, GBPUSD,
# USDCAD, AUDUSD, 2015-2020) from github.com/FutureSharks/financial-data using a
# blobless sparse checkout (~400 MB on disk). Check Oanda's terms before use.
# Usage: bash scripts/fetch_oanda_data.sh /path/to/target
set -euo pipefail
TARGET="${1:-data/financial-data}"
if [ ! -d "$TARGET/.git" ]; then
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/FutureSharks/financial-data "$TARGET"
fi
cd "$TARGET"
git ls-tree -r --name-only HEAD \
  | grep -E "currencies/oanda/(EUR_USD|GBP_USD|USD_CAD|AUD_USD)/20(1[5-9]|20)/" > .fxai_files.txt
# shellcheck disable=SC2046
git -c core.sparseCheckout=false checkout HEAD -- $(cat .fxai_files.txt)
echo "Data ready. Use: python -m fxai validate --data-root $TARGET/pyfinancialdata/data/currencies/oanda"
