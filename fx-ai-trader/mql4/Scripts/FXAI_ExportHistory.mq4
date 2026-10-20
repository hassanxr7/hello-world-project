//+------------------------------------------------------------------+
//| FXAI_ExportHistory.mq4                                           |
//| Exports broker bar history to CSV for the Python backtester:     |
//|   <Common>\Files\FXAI\export\<SYMBOL>_<TF>.csv                   |
//| Columns: time (server time, "YYYY.MM.DD HH:MM"), open, high,     |
//| low, close, volume, spread (points; 0 if the broker stores none).|
//| MT4 bars are BID prices. Load with fxai.backtest.data.load_mt4_export
//| and pass your broker's server UTC offset.                        |
//| Tip: open each chart and press Home repeatedly (or raise         |
//| Tools > Options > Charts > Max bars in history) to load history. |
//+------------------------------------------------------------------+
#property copyright "fxai"
#property version   "1.00"
#property strict
#property show_inputs

input string Symbols      = "EURUSD,GBPUSD,USDJPY,USDCAD,AUDUSD,USDCHF,NZDUSD";
input string SymbolSuffix = "";
input ENUM_TIMEFRAMES Timeframe = PERIOD_M1;
input int    MaxBars      = 5000000;

void OnStart()
{
   FolderCreate("FXAI", FILE_COMMON);
   FolderCreate("FXAI\\export", FILE_COMMON);
   string p[];
   int n = StringSplit(Symbols, ',', p);
   for(int i = 0; i < n; i++)
   {
      string sym = p[i] + SymbolSuffix;
      if(!SymbolSelect(sym, true)) { Print("skip ", sym, ": not found"); continue; }
      MqlRates r[];
      ArraySetAsSeries(r, false);
      int got = CopyRates(sym, Timeframe, 0, MaxBars, r);
      if(got <= 0) { Print("skip ", sym, ": no history (error ", GetLastError(), ")"); continue; }
      string tf = IntegerToString(Timeframe);
      string fname = "FXAI\\export\\" + p[i] + "_" + tf + ".csv";
      int h = FileOpen(fname, FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_COMMON, ',');
      if(h == INVALID_HANDLE) { Print("cannot open ", fname); continue; }
      FileWrite(h, "time", "open", "high", "low", "close", "volume", "spread");
      int digits = (int)MarketInfo(sym, MODE_DIGITS);
      for(int k = 0; k < got - 1; k++)   // skip the still-forming last bar
         FileWrite(h, TimeToString(r[k].time, TIME_DATE | TIME_MINUTES), DoubleToString(r[k].open, digits),
                   DoubleToString(r[k].high, digits), DoubleToString(r[k].low, digits),
                   DoubleToString(r[k].close, digits), IntegerToString(r[k].tick_volume), IntegerToString(r[k].spread));
      FileClose(h);
      PrintFormat("exported %d bars of %s to Common\\Files\\%s", got - 1, sym, fname);
   }
}
