//+------------------------------------------------------------------+
//| FXAI_Bridge.mq4                                                  |
//| MT4 execution bridge and FINAL risk gate for the fxai system.    |
//|                                                                  |
//| - Exports account/quotes/positions/history/bars to the terminal  |
//|   Common\Files\FXAI\<login>\ folder (no DLLs, no WebRequest).     |
//| - Executes commands written by the Python service, after its own |
//|   hard risk checks (it never trusts the command blindly).        |
//| - Keeps protecting positions when Python is down: broker-side SL,|
//|   break-even, trailing stop, max holding time, daily-loss halt,  |
//|   persistent emergency stop.                                     |
//| - Never touches orders with a different magic number (manual     |
//|   trades are left alone).                                        |
//|                                                                  |
//| Protocol: docs/PROTOCOL.md   Python mirror: fxai/bridge/ea_emulator.py
//| Attach to ONE chart only (a global-variable lock enforces a      |
//| single active instance per account).                             |
//+------------------------------------------------------------------+
#property copyright "fxai"
#property version   "1.00"
#property strict

#define FXAI_PROTOCOL 1
#define FXAI_EA_VERSION "1.0.0"
#define MAX_EVENTS 30

enum ENUM_FXAI_ZONE   { ZONE_SERVER = 0, ZONE_UTC = 1, ZONE_NEW_YORK = 2, ZONE_LONDON = 3 };
enum ENUM_FXAI_POLICY { POLICY_HOLD_PROTECTED = 0, POLICY_CLOSE_ALL = 1 };

//--- master switches (safe defaults: no new entries, demo only)
sinput string  _s0 = "=== Master switches ===";
input bool     EnableTrading        = false;  // allow NEW entries from Python commands
input bool     AllowLiveAccount     = false;  // allow entries on a real-money account
input int      MagicNumber          = 7340001;
//--- symbols
sinput string  _s1 = "=== Symbols ===";
input string   Symbols              = "EURUSD,GBPUSD,USDJPY,USDCAD,AUDUSD,USDCHF,NZDUSD";
input string   SymbolPrefix         = "";
input string   SymbolSuffix         = "";      // e.g. ".r" or "m"
//--- hard risk limits (the stricter of these and Python's limits applies)
sinput string  _s2 = "=== Hard risk limits ===";
input double   MaxRiskPerTradePct   = 0.25;
input double   MaxTotalRiskPct      = 1.0;
input int      MaxOpenPositions     = 3;
input int      MaxEntriesPerDay     = 20;
input double   MaxDailyLossPct      = 2.0;
input double   RiskTolerancePct     = 10.0;    // slack for price moving between Python's sizing and execution
input int      MaxSpreadPoints      = 50;
input int      MaxQuoteAgeSec       = 30;
input int      MaxSlippagePoints    = 10;
input int      MaxCommandAgeSec     = 15;
input int      PyHeartbeatTimeoutSec= 30;
input ENUM_FXAI_POLICY DailyLossPolicy = POLICY_HOLD_PROTECTED;
input ENUM_FXAI_POLICY EStopPolicy     = POLICY_CLOSE_ALL;
//--- trading day
sinput string  _s3 = "=== Trading day reset ===";
input ENUM_FXAI_ZONE ResetZone      = ZONE_SERVER;
input int      ResetHour            = 0;
//--- position management (runs even when Python is offline)
sinput string  _s4 = "=== Position management ===";
input bool     BreakEvenEnabled     = true;
input double   BreakEvenTriggerR    = 1.0;
input int      BreakEvenOffsetPoints= 10;
input bool     TrailingEnabled      = false;
input double   TrailingStartR       = 1.5;
input double   TrailingATRMult      = 2.0;
input ENUM_TIMEFRAMES TrailingATRTimeframe = PERIOD_H1;
input int      TrailingATRPeriod    = 14;
input int      TrailingStepPoints   = 10;
input double   MaxHoldHours         = 48;
input bool     AllowTwoStepSL       = true;    // market-execution brokers: open, then attach SL immediately
input int      UnprotectedGraceSec  = 10;      // system position without SL -> restore SL or close
input int      MaxEntryRetries      = 2;       // only for errors that mean "definitely not executed"
input int      ReconcileWindowSec   = 60;
//--- data export
sinput string  _s5 = "=== Data export ===";
input string   BarTimeframes        = "M15,H1,H4";
input int      BarsToExport         = 800;
input int      TimerMs              = 500;
input bool     ExportManualOrders   = true;    // include manual trades in state (read-only, for exposure)

//--- globals ------------------------------------------------------------
string   g_dir;                 // FXAI\<login>
string   g_syms[];              // canonical names
string   g_bsyms[];             // broker names
int      g_tfs[];
string   g_tfNames[];
datetime g_lastBar[];           // per symbol*tf
int      g_srvOffset = 0;       // broker server time - GMT (seconds, rounded to 30 min)
datetime g_lastTickLocal = 0;
double   g_lockId = 0;
bool     g_master = false;
long     g_stateSeq = 0;
datetime g_lastStateWrite = 0;
string   g_events[];
// persisted state (GlobalVariables)
int      g_day = 0;
double   g_dse = 0;             // day start equity
double   g_flows = 0;           // net deposits/withdrawals since day start
int      g_entries = 0, g_failed = 0, g_mods = 0, g_partials = 0;
bool     g_halt = false, g_estop = false, g_paused = false;
string   g_haltReason = "";
long     g_lastSeq = 0;
// tag registry (persisted in ea_tags.csv) and pending reconciliation (ea_pending.csv)
string   g_tags[];  int g_tagTickets[];
string   g_pendTag[]; long g_pendSeq[]; string g_pendId[]; datetime g_pendSince[];
// unprotected tracking
int      g_unprotTicket[]; datetime g_unprotSince[];

//+------------------------------------------------------------------+
//| small helpers                                                     |
//+------------------------------------------------------------------+
string GvName(const string key) { return "FXAI_" + IntegerToString(AccountNumber()) + "_" + key; }
string BoolStr(const bool b) { return b ? "true" : "false"; }
string Num(const double v, const int digits = 8) { return DoubleToString(v, digits); }

string Trim(const string s)
{
   int a = 0, b = StringLen(s) - 1;
   while(a <= b && StringGetCharacter(s, a) <= 32) a++;
   while(b >= a && StringGetCharacter(s, b) <= 32) b--;
   if(b < a) return "";
   return StringSubstr(s, a, b - a + 1);
}

string KvText(string s)                 // free text safe for a KV field
{
   StringReplace(s, "|", "/");
   StringReplace(s, "=", ":");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   if(StringLen(s) > 200) s = StringSubstr(s, 0, 200);
   return s;
}

string JsonEsc(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\t", " ");
   return s;
}

void LogEvent(const string level, const string code, const string msg)
{
   PrintFormat("FXAI %s %s: %s", level, code, msg);
   string ev = "{\"t\":" + IntegerToString((long)TimeGMT()) + ",\"level\":\"" + level + "\",\"code\":\"" + code +
               "\",\"msg\":\"" + JsonEsc(msg) + "\"}";
   int n = ArraySize(g_events);
   if(n >= MAX_EVENTS)
   {
      for(int i = 1; i < n; i++) g_events[i - 1] = g_events[i];
      g_events[n - 1] = ev;
   }
   else
   {
      ArrayResize(g_events, n + 1);
      g_events[n] = ev;
   }
}

//--- KV record parsing: k=v|k=v|...|end=1
bool ParseKV(const string line, string &keys[], string &vals[])
{
   string parts[];
   int n = StringSplit(Trim(line), '|', parts);
   ArrayResize(keys, 0);
   ArrayResize(vals, 0);
   bool ended = false;
   for(int i = 0; i < n; i++)
   {
      int p = StringFind(parts[i], "=");
      if(p <= 0) return false;
      string k = StringSubstr(parts[i], 0, p);
      string v = StringSubstr(parts[i], p + 1);
      if(k == "end") { ended = (v == "1"); continue; }
      int m = ArraySize(keys);
      ArrayResize(keys, m + 1);
      ArrayResize(vals, m + 1);
      keys[m] = k;
      vals[m] = v;
   }
   return ended;
}

string KV(string &keys[], string &vals[], const string key, const string dflt = "")
{
   for(int i = 0; i < ArraySize(keys); i++)
      if(keys[i] == key) return vals[i];
   return dflt;
}

//--- files (all under Common\Files, atomic replace via temp + FileMove)
bool AtomicWrite(const string rel, const string content)
{
   string path = g_dir + "\\" + rel;
   string tmp  = path + ".tmp";
   int h = FileOpen(tmp, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return false;
   FileWriteString(h, content);
   FileClose(h);
   for(int i = 0; i < 5; i++)
   {
      if(FileMove(tmp, FILE_COMMON, path, FILE_COMMON | FILE_REWRITE)) return true;
      Sleep(5);
   }
   FileDelete(tmp, FILE_COMMON);
   return false;
}

string ReadFirstLine(const string rel)
{
   string path = g_dir + "\\" + rel;
   if(!FileIsExist(path, FILE_COMMON)) return "";
   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return "";
   string line = FileReadString(h);
   FileClose(h);
   return line;
}

//+------------------------------------------------------------------+
//| time zones and trading day (mirrors fxai/timeutil.py)             |
//+------------------------------------------------------------------+
datetime MakeDate(const int y, const int m, const int d)
{
   MqlDateTime t;
   t.year = y; t.mon = m; t.day = d; t.hour = 0; t.min = 0; t.sec = 0;
   return StructToTime(t);
}

int DowOf(const datetime t) { MqlDateTime s; TimeToStruct(t, s); return s.day_of_week; } // 0 = Sunday (built-in DayOfWeek() takes no args)

datetime NthSunday(const int y, const int m, const int n)
{
   datetime first = MakeDate(y, m, 1);
   int dow = DowOf(first);
   int firstSunday = 1 + (7 - dow) % 7;
   return MakeDate(y, m, firstSunday + 7 * (n - 1));
}

datetime LastSunday(const int y, const int m)
{
   datetime nextFirst = (m == 12) ? MakeDate(y + 1, 1, 1) : MakeDate(y, m + 1, 1);
   datetime last = nextFirst - 86400;
   return last - DowOf(last) * 86400;
}

int ZoneOffsetSec(const datetime gmt)
{
   MqlDateTime s; TimeToStruct(gmt, s);
   if(ResetZone == ZONE_SERVER) return g_srvOffset;
   if(ResetZone == ZONE_UTC) return 0;
   if(ResetZone == ZONE_NEW_YORK)
   {
      datetime a = NthSunday(s.year, 3, 2) + 7 * 3600;   // 02:00 EST
      datetime b = NthSunday(s.year, 11, 1) + 6 * 3600;  // 02:00 EDT
      return (gmt >= a && gmt < b) ? -4 * 3600 : -5 * 3600;
   }
   datetime a2 = LastSunday(s.year, 3) + 3600;           // London: 01:00 UTC
   datetime b2 = LastSunday(s.year, 10) + 3600;
   return (gmt >= a2 && gmt < b2) ? 3600 : 0;
}

int DayIdForGmt(const datetime gmt)
{
   datetime local = gmt + ZoneOffsetSec(gmt) - ResetHour * 3600;
   MqlDateTime s; TimeToStruct(local, s);
   return s.year * 10000 + s.mon * 100 + s.day;
}

datetime DayStartGmt(const datetime gmt)
{
   int off = ZoneOffsetSec(gmt);
   datetime local = gmt + off - ResetHour * 3600;
   MqlDateTime s; TimeToStruct(local, s);
   return MakeDate(s.year, s.mon, s.day) + ResetHour * 3600 - off;
}

string ZoneName()
{
   if(ResetZone == ZONE_UTC) return "UTC";
   if(ResetZone == ZONE_NEW_YORK) return "America/New_York";
   if(ResetZone == ZONE_LONDON) return "Europe/London";
   return "server";
}

string DayIdStr(const int d)
{
   return StringFormat("%04d-%02d-%02d", d / 10000, (d / 100) % 100, d % 100);
}

void UpdateServerOffset()
{
   // Only trust TimeCurrent() while ticks are flowing (it freezes over weekends).
   if(!IsConnected()) return;
   if(g_lastTickLocal > 0 && TimeLocal() - g_lastTickLocal > 120) return;
   long raw = (long)TimeCurrent() - (long)TimeGMT();
   int off = (int)(MathRound(raw / 1800.0) * 1800);
   if(off != g_srvOffset)
   {
      if(g_srvOffset != 0) LogEvent("info", "SERVER_OFFSET", StringFormat("server offset %d -> %d s", g_srvOffset, off));
      g_srvOffset = off;
      GlobalVariableSet(GvName("SRVOFF"), off);
   }
}

datetime ServerNow() { return TimeGMT() + g_srvOffset; }

//+------------------------------------------------------------------+
//| persistence                                                        |
//+------------------------------------------------------------------+
double GvGet(const string key, const double dflt)
{
   string n = GvName(key);
   return GlobalVariableCheck(n) ? GlobalVariableGet(n) : dflt;
}

void SaveCounters()
{
   GlobalVariableSet(GvName("DAY"), g_day);
   GlobalVariableSet(GvName("DSE"), g_dse);
   GlobalVariableSet(GvName("ENT"), g_entries);
   GlobalVariableSet(GvName("FAIL"), g_failed);
   GlobalVariableSet(GvName("MODS"), g_mods);
   GlobalVariableSet(GvName("PART"), g_partials);
   GlobalVariableSet(GvName("HALT"), g_halt ? 1 : 0);
   GlobalVariableSet(GvName("ESTOP"), g_estop ? 1 : 0);
   GlobalVariableSet(GvName("PAUSE"), g_paused ? 1 : 0);
   GlobalVariableSet(GvName("LASTSEQ"), (double)g_lastSeq);
   GlobalVariablesFlush();
}

void LoadCounters()
{
   g_srvOffset = (int)GvGet("SRVOFF", 0);
   g_day       = (int)GvGet("DAY", 0);
   g_dse       = GvGet("DSE", 0);
   g_entries   = (int)GvGet("ENT", 0);
   g_failed    = (int)GvGet("FAIL", 0);
   g_mods      = (int)GvGet("MODS", 0);
   g_partials  = (int)GvGet("PART", 0);
   g_halt      = GvGet("HALT", 0) != 0;
   g_estop     = GvGet("ESTOP", 0) != 0;
   g_paused    = GvGet("PAUSE", 0) != 0;
   g_lastSeq   = (long)GvGet("LASTSEQ", 0);
}

void SaveTags()
{
   string out = "";
   int n = ArraySize(g_tags);
   int start = (int)MathMax(0, n - 500);
   for(int i = start; i < n; i++) out += g_tags[i] + "," + IntegerToString(g_tagTickets[i]) + "\n";
   AtomicWrite("ea_tags.csv", out);
}

void LoadTags()
{
   ArrayResize(g_tags, 0); ArrayResize(g_tagTickets, 0);
   string path = g_dir + "\\ea_tags.csv";
   if(!FileIsExist(path, FILE_COMMON)) return;
   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   while(!FileIsEnding(h))
   {
      string line = Trim(FileReadString(h));
      string p[];
      if(StringSplit(line, ',', p) == 2)
      {
         int n = ArraySize(g_tags);
         ArrayResize(g_tags, n + 1); ArrayResize(g_tagTickets, n + 1);
         g_tags[n] = p[0]; g_tagTickets[n] = (int)StringToInteger(p[1]);
      }
   }
   FileClose(h);
}

int TagTicket(const string tag)
{
   for(int i = ArraySize(g_tags) - 1; i >= 0; i--) if(g_tags[i] == tag) return g_tagTickets[i];
   return 0;
}

void AddTag(const string tag, const int ticket)
{
   int n = ArraySize(g_tags);
   ArrayResize(g_tags, n + 1); ArrayResize(g_tagTickets, n + 1);
   g_tags[n] = tag; g_tagTickets[n] = ticket;
   SaveTags();
}

void SavePending()
{
   string out = "";
   for(int i = 0; i < ArraySize(g_pendTag); i++)
      out += g_pendTag[i] + "," + IntegerToString(g_pendSeq[i]) + "," + g_pendId[i] + "," +
             IntegerToString((long)g_pendSince[i]) + "\n";
   AtomicWrite("ea_pending.csv", out);
}

void LoadPending()
{
   ArrayResize(g_pendTag, 0); ArrayResize(g_pendSeq, 0); ArrayResize(g_pendId, 0); ArrayResize(g_pendSince, 0);
   string path = g_dir + "\\ea_pending.csv";
   if(!FileIsExist(path, FILE_COMMON)) return;
   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   while(!FileIsEnding(h))
   {
      string p[];
      if(StringSplit(Trim(FileReadString(h)), ',', p) == 4)
      {
         int n = ArraySize(g_pendTag);
         ArrayResize(g_pendTag, n + 1); ArrayResize(g_pendSeq, n + 1); ArrayResize(g_pendId, n + 1);
         ArrayResize(g_pendSince, n + 1);
         g_pendTag[n] = p[0]; g_pendSeq[n] = StringToInteger(p[1]); g_pendId[n] = p[2];
         g_pendSince[n] = (datetime)StringToInteger(p[3]);
      }
   }
   FileClose(h);
}

void AddPending(const string tag, const long seq, const string sid)
{
   int n = ArraySize(g_pendTag);
   ArrayResize(g_pendTag, n + 1); ArrayResize(g_pendSeq, n + 1); ArrayResize(g_pendId, n + 1);
   ArrayResize(g_pendSince, n + 1);
   g_pendTag[n] = tag; g_pendSeq[n] = seq; g_pendId[n] = sid; g_pendSince[n] = TimeGMT();
   SavePending();   // persisted BEFORE OrderSend
}

void RemovePending(const string tag)
{
   int n = ArraySize(g_pendTag), j = 0;
   for(int i = 0; i < n; i++)
   {
      if(g_pendTag[i] == tag) continue;
      g_pendTag[j] = g_pendTag[i]; g_pendSeq[j] = g_pendSeq[i]; g_pendId[j] = g_pendId[i];
      g_pendSince[j] = g_pendSince[i]; j++;
   }
   ArrayResize(g_pendTag, j); ArrayResize(g_pendSeq, j); ArrayResize(g_pendId, j); ArrayResize(g_pendSince, j);
   SavePending();
}

//+------------------------------------------------------------------+
//| symbols                                                            |
//+------------------------------------------------------------------+
int TfFromName(const string n)
{
   if(n == "M1") return PERIOD_M1;   if(n == "M5") return PERIOD_M5;   if(n == "M15") return PERIOD_M15;
   if(n == "M30") return PERIOD_M30; if(n == "H1") return PERIOD_H1;   if(n == "H4") return PERIOD_H4;
   if(n == "D1") return PERIOD_D1;
   return -1;
}

bool InitSymbols()
{
   string p[];
   int n = StringSplit(Symbols, ',', p);
   ArrayResize(g_syms, 0); ArrayResize(g_bsyms, 0);
   for(int i = 0; i < n; i++)
   {
      string c = Trim(p[i]);
      if(c == "") continue;
      string b = SymbolPrefix + c + SymbolSuffix;
      if(!SymbolSelect(b, true) || MarketInfo(b, MODE_POINT) <= 0)
      {
         LogEvent("error", "SYMBOL_MISSING", "broker symbol " + b + " not found - check prefix/suffix");
         continue;
      }
      int m = ArraySize(g_syms);
      ArrayResize(g_syms, m + 1); ArrayResize(g_bsyms, m + 1);
      g_syms[m] = c; g_bsyms[m] = b;
   }
   string t[];
   int k = StringSplit(BarTimeframes, ',', t);
   ArrayResize(g_tfs, 0); ArrayResize(g_tfNames, 0);
   for(int j = 0; j < k; j++)
   {
      string nm = Trim(t[j]);
      int tf = TfFromName(nm);
      if(tf < 0) continue;
      int m2 = ArraySize(g_tfs);
      ArrayResize(g_tfs, m2 + 1); ArrayResize(g_tfNames, m2 + 1);
      g_tfs[m2] = tf; g_tfNames[m2] = nm;
   }
   ArrayResize(g_lastBar, ArraySize(g_syms) * ArraySize(g_tfs));
   ArrayInitialize(g_lastBar, 0);
   return ArraySize(g_syms) > 0;
}

string BrokerSymbol(const string canonical)
{
   for(int i = 0; i < ArraySize(g_syms); i++) if(g_syms[i] == canonical) return g_bsyms[i];
   return "";
}

string CanonicalOf(const string broker)
{
   for(int i = 0; i < ArraySize(g_bsyms); i++) if(g_bsyms[i] == broker) return g_syms[i];
   return broker;
}

double ValuePerPriceUnit(const string sym)   // account currency per 1.0 price move per 1 lot
{
   double ts = MarketInfo(sym, MODE_TICKSIZE), tv = MarketInfo(sym, MODE_TICKVALUE);
   if(ts <= 0 || tv <= 0) return 0;
   return tv / ts;
}

//+------------------------------------------------------------------+
//| single-instance lock                                               |
//+------------------------------------------------------------------+
bool HoldLock()
{
   string n = GvName("LOCK"), nt = GvName("LOCKT");
   if(!GlobalVariableCheck(n)) GlobalVariableSet(n, 0);
   double cur = GlobalVariableGet(n);
   if(cur == g_lockId)
   {
      GlobalVariableSet(nt, (double)TimeLocal());
      return true;
   }
   double t = GvGet("LOCKT", 0);
   if(cur == 0 || (double)TimeLocal() - t > 15)
   {
      if(GlobalVariableSetOnCondition(n, g_lockId, cur))
      {
         GlobalVariableSet(nt, (double)TimeLocal());
         LogEvent("info", "LOCK", "this chart is now the active FXAI instance");
         return true;
      }
   }
   return false;
}

//+------------------------------------------------------------------+
//| account / position helpers                                        |
//+------------------------------------------------------------------+
bool SelectSystemOrder(const int pos)
{
   if(!OrderSelect(pos, SELECT_BY_POS, MODE_TRADES)) return false;
   return OrderMagicNumber() == MagicNumber;
}

int CountSystemPositions()
{
   int n = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(SelectSystemOrder(i) && OrderType() <= OP_SELL) n++;
   return n;
}

bool HasSystemPosition(const string bsym)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(SelectSystemOrder(i) && OrderType() <= OP_SELL && OrderSymbol() == bsym) return true;
   return false;
}

double OpenSystemRisk()   // planned loss from entry to current stop, floored at 0
{
   double total = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!SelectSystemOrder(i) || OrderType() > OP_SELL) continue;
      double sl = OrderStopLoss();
      double vpu = ValuePerPriceUnit(OrderSymbol());
      if(sl <= 0) { total += AccountEquity(); continue; }  // unprotected: treat as unlimited
      double dist = (OrderType() == OP_BUY) ? OrderOpenPrice() - sl : sl - OrderOpenPrice();
      total += MathMax(0, dist) * vpu * OrderLots();
   }
   return total;
}

int FindTicketByTag(const string tag)
{
   string needle = "FXAI|" + tag;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderMagicNumber() == MagicNumber &&
         StringFind(OrderComment(), needle) >= 0) return OrderTicket();
   int hn = OrdersHistoryTotal();
   for(int j = hn - 1; j >= 0 && j >= hn - 1000; j--)
      if(OrderSelect(j, SELECT_BY_POS, MODE_HISTORY) && OrderMagicNumber() == MagicNumber &&
         StringFind(OrderComment(), needle) >= 0) return OrderTicket();
   int t = TagTicket(tag);
   if(t > 0 && (OrderSelect(t, SELECT_BY_TICKET))) return t;
   return 0;
}

double DailyLossPct()
{
   if(g_dse <= 0) return 0;
   double pnl = AccountEquity() - g_dse - g_flows;
   return MathMax(0, -pnl) / g_dse * 100.0;
}

void ScanCashFlows()      // deposits/withdrawals/credit since the day start (server time)
{
   datetime startSrv = DayStartGmt(TimeGMT()) + g_srvOffset;
   double flows = 0;
   for(int j = OrdersHistoryTotal() - 1; j >= 0; j--)
   {
      if(!OrderSelect(j, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderType() > OP_SELLSTOP && OrderOpenTime() >= startSrv) flows += OrderProfit();
   }
   g_flows = flows;
}

//+------------------------------------------------------------------+
//| trading primitives                                                 |
//+------------------------------------------------------------------+
bool IsRetryable(const int err)   // definitely NOT executed: safe to retry with a fresh price
{
   return err == 135 || err == 136 || err == 138 || err == 146;
}

bool IsDefiniteReject(const int err)
{
   return err == 129 || err == 130 || err == 131 || err == 132 || err == 133 || err == 134;
}

bool IsAmbiguous(const int err) { return err != 0 && !IsRetryable(err) && !IsDefiniteReject(err); }

bool CloseTicket(const int ticket, const double lots, const string why)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET) || OrderCloseTime() != 0) return false;
   for(int a = 0; a < 3; a++)
   {
      RefreshRates();
      string sym = OrderSymbol();
      int digits = (int)MarketInfo(sym, MODE_DIGITS);
      double px = (OrderType() == OP_BUY) ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
      double vol = (lots > 0 && lots < OrderLots()) ? lots : OrderLots();
      ResetLastError();
      if(OrderClose(ticket, vol, NormalizeDouble(px, digits), MaxSlippagePoints * 3, clrNONE))
      {
         LogEvent("info", "CLOSE", StringFormat("#%d %s (%s)", ticket, sym, why));
         return true;
      }
      int err = GetLastError();
      LogEvent("warning", "CLOSE_FAILED", StringFormat("#%d err %d (%s)", ticket, err, why));
      Sleep(200);
      if(!OrderSelect(ticket, SELECT_BY_TICKET)) return false;
   }
   return false;
}

void CloseAllSystem(const string why)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!SelectSystemOrder(i)) continue;
      int t = OrderTicket();
      if(OrderType() <= OP_SELL) CloseTicket(t, 0, why);
      else if(!OrderDelete(t)) LogEvent("warning", "DELETE_FAILED", StringFormat("#%d err %d", t, GetLastError()));
   }
}

void CancelPendingSystem()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(SelectSystemOrder(i) && OrderType() > OP_SELL)
         if(!OrderDelete(OrderTicket())) LogEvent("warning", "DELETE_FAILED", IntegerToString(GetLastError()));
}

void TriggerEStop(const int policy, const string why)
{
   g_estop = true;
   SaveCounters();
   LogEvent("critical", "ESTOP", why + (policy == POLICY_CLOSE_ALL ? " - closing system positions" : " - holding protected positions"));
   CancelPendingSystem();
   if(policy == POLICY_CLOSE_ALL) CloseAllSystem("emergency stop");
}

//+------------------------------------------------------------------+
//| hard guard for new entries                                         |
//+------------------------------------------------------------------+
double PyHeartbeatAge()
{
   string k[], v[];
   if(!ParseKV(ReadFirstLine("py_heartbeat.txt"), k, v)) return 1e9;
   long gmt = StringToInteger(KV(k, v, "gmt", "0"));
   if(gmt <= 0) return 1e9;
   return (double)((long)TimeGMT() - gmt);
}

string GuardOpen(const string bsym, const int cmd, const double vol, const double sl, const double ref,
                 const double maxdev, const double maxrisk)
{
   if(!EnableTrading) return "EnableTrading is false";
   if(!IsDemo() && !AllowLiveAccount) return "live account and AllowLiveAccount is false";
   if(g_estop) return "emergency stop active";
   if(g_paused) return "paused";
   if(g_halt) return "daily loss halt";
   if(PyHeartbeatAge() > PyHeartbeatTimeoutSec) return "python heartbeat stale";
   if(!IsConnected() || !IsTradeAllowed() || TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) == 0)
      return "terminal not connected or AutoTrading disabled";
   if(g_entries >= MaxEntriesPerDay) return "daily entry cap reached";
   if(CountSystemPositions() >= MaxOpenPositions) return "max open positions";
   if(bsym == "") return "symbol not configured in EA";
   if(HasSystemPosition(bsym)) return "position already open on symbol";
   if(MarketInfo(bsym, MODE_TRADEALLOWED) == 0) return "symbol not tradeable (market closed?)";
   RefreshRates();
   double point = MarketInfo(bsym, MODE_POINT);
   double bid = MarketInfo(bsym, MODE_BID), ask = MarketInfo(bsym, MODE_ASK);
   if(point <= 0 || bid <= 0 || ask <= 0) return "no quote";
   datetime tick = (datetime)MarketInfo(bsym, MODE_TIME);
   if((long)ServerNow() - (long)tick > MaxQuoteAgeSec) return "stale quote";
   if((ask - bid) / point > MaxSpreadPoints) return "spread above EA limit";
   double px = (cmd == OP_BUY) ? ask : bid;
   double closePx = (cmd == OP_BUY) ? bid : ask;
   if(sl <= 0 || (cmd == OP_BUY && sl >= bid) || (cmd == OP_SELL && sl <= ask)) return "invalid or missing stop-loss";
   if(MathAbs(closePx - sl) < MarketInfo(bsym, MODE_STOPLEVEL) * point) return "stop-loss inside broker stop level";
   if(MathAbs(px - ref) / point > maxdev) return "price moved beyond max deviation";
   double minLot = MarketInfo(bsym, MODE_MINLOT), maxLot = MarketInfo(bsym, MODE_MAXLOT), step = MarketInfo(bsym, MODE_LOTSTEP);
   if(step <= 0 || vol < minLot - 1e-9 || vol > maxLot + 1e-9) return "volume outside broker limits";
   double steps = vol / step;
   if(MathAbs(steps - MathRound(steps)) > 1e-6) return "volume not a multiple of lot step";
   double vpu = ValuePerPriceUnit(bsym);
   if(vpu <= 0) return "tick value unavailable";
   double risk = vol * MathAbs(px - sl) * vpu;
   double tol = 1.0 + RiskTolerancePct / 100.0;
   double cap = MathMin(maxrisk > 0 ? maxrisk : 1e18, AccountEquity() * MaxRiskPerTradePct / 100.0) * tol;
   if(risk > cap) return StringFormat("planned risk %.2f > EA cap %.2f", risk, cap);
   if(OpenSystemRisk() + risk > AccountEquity() * MaxTotalRiskPct / 100.0 * tol) return "total risk above EA cap";
   ResetLastError();
   double fm = AccountFreeMarginCheck(bsym, cmd, vol);
   if(fm <= 0 || GetLastError() == 134) return "insufficient free margin";
   return "";
}

//+------------------------------------------------------------------+
//| results                                                            |
//+------------------------------------------------------------------+
void WriteResult(const long seq, const string type, const string status, const string sid, const int ticket,
                 const int err, const int attempts, const string msg)
{
   string r = "v=" + IntegerToString(FXAI_PROTOCOL) + "|seq=" + IntegerToString(seq) + "|type=" + type +
              "|status=" + status + "|id=" + KvText(sid) + "|ticket=" + IntegerToString(ticket) +
              "|err=" + IntegerToString(err) + "|attempts=" + IntegerToString(attempts) + "|msg=" + KvText(msg);
   if(ticket > 0 && OrderSelect(ticket, SELECT_BY_TICKET))
      r += "|price=" + Num(OrderOpenPrice()) + "|volume=" + Num(OrderLots(), 2) + "|sl=" + Num(OrderStopLoss()) +
           "|tp=" + Num(OrderTakeProfit());
   r += "|time=" + IntegerToString((long)ServerNow()) + "|end=1";
   if(!AtomicWrite("res\\" + IntegerToString(seq, 12, '0') + ".res", r))
      LogEvent("error", "RESULT_WRITE", "could not write result " + IntegerToString(seq));
}

//+------------------------------------------------------------------+
//| OPEN                                                               |
//+------------------------------------------------------------------+
void HandleOpen(string &k[], string &v[], const long seq)
{
   string sid = KV(k, v, "id"), tag = KV(k, v, "tag");
   string bsym = BrokerSymbol(KV(k, v, "symbol"));
   int cmd = (KV(k, v, "side") == "BUY") ? OP_BUY : OP_SELL;
   double vol = StringToDouble(KV(k, v, "volume", "0"));
   double sl = StringToDouble(KV(k, v, "sl", "0")), tp = StringToDouble(KV(k, v, "tp", "0"));
   double ref = StringToDouble(KV(k, v, "ref", "0"));
   double maxdev = StringToDouble(KV(k, v, "maxdev", "20")), maxrisk = StringToDouble(KV(k, v, "maxrisk", "0"));
   int slip = (int)MathMin((double)StringToInteger(KV(k, v, "slip", "10")), (double)MaxSlippagePoints);
   if(tag == "" || StringLen(tag) > 16) { WriteResult(seq, "OPEN", "ERROR", sid, 0, 0, 0, "missing tag"); return; }

   int existing = FindTicketByTag(tag);
   if(existing > 0 || TagTicket(tag) > 0)
   {
      WriteResult(seq, "OPEN", "DUPLICATE", sid, existing, 0, 0, "signal already executed");
      return;
   }
   string why = GuardOpen(bsym, cmd, vol, sl, ref, maxdev, maxrisk);
   if(why != "")
   {
      g_failed++; SaveCounters();
      WriteResult(seq, "OPEN", "REJECTED", sid, 0, 0, 0, why);
      LogEvent("warning", "OPEN_REJECTED", sid + ": " + why);
      return;
   }
   AddPending(tag, seq, sid);
   int digits = (int)MarketInfo(bsym, MODE_DIGITS);
   string comment = "FXAI|" + tag;
   int ticket = -1, err = 0, attempts = 0;
   bool twoStep = false;
   while(true)
   {
      attempts++;
      for(int w = 0; w < 10 && IsTradeContextBusy(); w++) Sleep(50);
      RefreshRates();
      double px = (cmd == OP_BUY) ? MarketInfo(bsym, MODE_ASK) : MarketInfo(bsym, MODE_BID);
      ResetLastError();
      ticket = OrderSend(bsym, cmd, vol, NormalizeDouble(px, digits), slip,
                         twoStep ? 0 : NormalizeDouble(sl, digits), twoStep ? 0 : NormalizeDouble(tp, digits),
                         comment, MagicNumber, 0, clrNONE);
      if(ticket > 0) break;
      err = GetLastError();
      if(err == 130 && AllowTwoStepSL && !twoStep) { twoStep = true; continue; }   // stops were pre-validated
      if(IsRetryable(err) && attempts <= MaxEntryRetries)
      {
         if(FindTicketByTag(tag) > 0) break;
         if(GuardOpen(bsym, cmd, vol, sl, ref, maxdev, maxrisk) != "") break;
         Sleep(250);
         continue;
      }
      break;
   }
   if(ticket <= 0)
   {
      int found = FindTicketByTag(tag);
      if(found > 0) ticket = found;
      else if(IsAmbiguous(err))
      {
         WriteResult(seq, "OPEN", "UNKNOWN", sid, 0, err, attempts, "ambiguous result - reconciling, will NOT retry");
         LogEvent("error", "OPEN_AMBIGUOUS", StringFormat("%s err %d", sid, err));
         return;   // stays in the pending list; ReconcilePending() resolves it
      }
      else
      {
         RemovePending(tag);
         g_failed++; SaveCounters();
         WriteResult(seq, "OPEN", "REJECTED", sid, 0, err, attempts, "broker rejected");
         LogEvent("warning", "OPEN_FAILED", StringFormat("%s err %d", sid, err));
         return;
      }
   }
   if(!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      WriteResult(seq, "OPEN", "UNKNOWN", sid, ticket, GetLastError(), attempts, "ticket not selectable");
      return;
   }
   if(OrderStopLoss() <= 0)   // two-step: attach protection now, or close immediately
   {
      bool ok = false;
      for(int a = 0; a < 3 && !ok; a++)
      {
         RefreshRates();
         ok = OrderModify(ticket, OrderOpenPrice(), NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), 0, clrNONE);
         if(!ok) { Sleep(200); if(!OrderSelect(ticket, SELECT_BY_TICKET)) break; }
      }
      if(!ok)
      {
         CloseTicket(ticket, 0, "stop-loss could not be attached");
         RemovePending(tag); AddTag(tag, ticket);
         g_entries++; SaveCounters();
         WriteResult(seq, "OPEN", "REJECTED", sid, ticket, GetLastError(), attempts,
                     "stop-loss could not be attached - position closed immediately");
         LogEvent("critical", "PROTECTION_FAILED", StringFormat("#%d closed: SL could not be set", ticket));
         return;
      }
   }
   ConfirmFill(seq, sid, tag, ticket, attempts);
}

void ConfirmFill(const long seq, const string sid, const string tag, const int ticket, const int attempts)
{
   RemovePending(tag);
   AddTag(tag, ticket);
   if(OrderSelect(ticket, SELECT_BY_TICKET) && OrderStopLoss() > 0)
   {
      GlobalVariableSet(GvName("R_" + IntegerToString(ticket)), MathAbs(OrderOpenPrice() - OrderStopLoss()));
      GlobalVariableSet(GvName("ISL_" + IntegerToString(ticket)), OrderStopLoss());
   }
   g_entries++;
   SaveCounters();
   WriteResult(seq, "OPEN", "FILLED", sid, ticket, 0, attempts, "");
   LogEvent("info", "FILLED", StringFormat("%s -> #%d", sid, ticket));
}

void ReconcilePending()
{
   for(int i = ArraySize(g_pendTag) - 1; i >= 0; i--)
   {
      string tag = g_pendTag[i];
      int t = FindTicketByTag(tag);
      if(t > 0)
      {
         string id = g_pendId[i];
         RemovePending(tag);
         AddTag(tag, t);
         g_entries++; SaveCounters();
         if(OrderSelect(t, SELECT_BY_TICKET) && OrderStopLoss() > 0)
            GlobalVariableSet(GvName("R_" + IntegerToString(t)), MathAbs(OrderOpenPrice() - OrderStopLoss()));
         LogEvent("warning", "RECONCILED", id + " found as #" + IntegerToString(t));
      }
      else if((long)TimeGMT() - (long)g_pendSince[i] > ReconcileWindowSec)
      {
         string id2 = g_pendId[i];
         RemovePending(tag);
         g_failed++; SaveCounters();
         LogEvent("error", "NOT_FOUND", id2 + " not found after reconcile window - not retried");
      }
   }
}

//+------------------------------------------------------------------+
//| other commands                                                     |
//+------------------------------------------------------------------+
void HandleCommand(string &k[], string &v[], const long seq)
{
   string type = KV(k, v, "type");
   long created = StringToInteger(KV(k, v, "created", "0"));
   long ttl = (long)MathMin((double)StringToInteger(KV(k, v, "ttl", IntegerToString(MaxCommandAgeSec))), (double)MaxCommandAgeSec);
   long age = (long)TimeGMT() - created;
   if(type == "OPEN")
   {
      if(age > ttl) { WriteResult(seq, type, "EXPIRED", KV(k, v, "id"), 0, 0, 0, "command age " + IntegerToString(age) + " s"); return; }
      HandleOpen(k, v, seq);
      return;
   }
   if(type == "MODIFY")
   {
      int t = (int)StringToInteger(KV(k, v, "ticket", "0"));
      if(!OrderSelect(t, SELECT_BY_TICKET) || OrderMagicNumber() != MagicNumber || OrderCloseTime() != 0)
      { WriteResult(seq, type, "REJECTED", "", t, 0, 0, "not an open system order"); return; }
      double sl = StringToDouble(KV(k, v, "sl", "0"));
      double tp = StringToDouble(KV(k, v, "tp", DoubleToString(OrderTakeProfit(), 8)));
      double sign = (OrderType() == OP_BUY) ? 1 : -1;
      if(sl <= 0 || (OrderStopLoss() > 0 && (sl - OrderStopLoss()) * sign < 0))
      { WriteResult(seq, type, "REJECTED", "", t, 0, 0, "stop may not be removed or widened"); return; }
      int digits = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
      bool ok = OrderModify(t, OrderOpenPrice(), NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), 0, clrNONE);
      int err = ok ? 0 : GetLastError();
      if(ok) { g_mods++; SaveCounters(); }
      WriteResult(seq, type, ok ? "DONE" : "REJECTED", "", t, err, 1, "");
      return;
   }
   if(type == "CLOSE")
   {
      int t2 = (int)StringToInteger(KV(k, v, "ticket", "0"));
      if(!OrderSelect(t2, SELECT_BY_TICKET) || OrderMagicNumber() != MagicNumber)
      { WriteResult(seq, type, "REJECTED", "", t2, 0, 0, "not a system order"); return; }
      double lots = StringToDouble(KV(k, v, "volume", "0"));
      bool ok2 = CloseTicket(t2, lots, "command");
      if(ok2 && lots > 0) { g_partials++; SaveCounters(); }
      WriteResult(seq, type, ok2 ? "DONE" : "REJECTED", "", t2, ok2 ? 0 : GetLastError(), 1, "");
      return;
   }
   if(type == "CLOSE_ALL")      { CloseAllSystem("command: " + KV(k, v, "reason")); WriteResult(seq, type, "DONE", "", 0, 0, 1, ""); return; }
   if(type == "CANCEL_PENDING") { CancelPendingSystem(); WriteResult(seq, type, "DONE", "", 0, 0, 1, ""); return; }
   if(type == "PAUSE" || type == "RESUME")
   {
      g_paused = (type == "PAUSE"); SaveCounters();
      WriteResult(seq, type, "DONE", "", 0, 0, 1, "");
      return;
   }
   if(type == "ESTOP")
   {
      if(KV(k, v, "action") == "clear")
      {
         if(KV(k, v, "confirm") != "CLEAR" || FileIsExist(g_dir + "\\estop.flag", FILE_COMMON))
         { WriteResult(seq, type, "REJECTED", "", 0, 0, 0, "clear needs confirm CLEAR and no estop.flag file"); return; }
         g_estop = false; SaveCounters();
         LogEvent("warning", "ESTOP_CLEARED", "emergency stop cleared by command");
      }
      else TriggerEStop(KV(k, v, "policy") == "hold" ? POLICY_HOLD_PROTECTED : POLICY_CLOSE_ALL, "command");
      WriteResult(seq, type, "DONE", "", 0, 0, 1, "");
      return;
   }
   if(type == "PING") { WriteResult(seq, type, "DONE", "", 0, 0, 1, "pong"); return; }
   WriteResult(seq, type, "ERROR", "", 0, 0, 0, "unknown command type");
}

void ProcessCommands()
{
   long seqs[];
   ArrayResize(seqs, 0);
   string name;
   long h = FileFindFirst(g_dir + "\\cmd\\*.cmd", name, FILE_COMMON);
   if(h == INVALID_HANDLE) return;
   do
   {
      long s = StringToInteger(StringSubstr(name, 0, StringFind(name, ".")));
      if(s > 0) { int n = ArraySize(seqs); ArrayResize(seqs, n + 1); seqs[n] = s; }
   }
   while(FileFindNext(h, name));
   FileFindClose(h);
   int cnt = ArraySize(seqs);
   for(int i = 1; i < cnt; i++)   // insertion sort (ascending)
   {
      long key = seqs[i]; int j = i - 1;
      while(j >= 0 && seqs[j] > key) { seqs[j + 1] = seqs[j]; j--; }
      seqs[j + 1] = key;
   }
   for(int c = 0; c < cnt; c++)
   {
      long seq = seqs[c];
      string rel = "cmd\\" + IntegerToString(seq, 12, '0') + ".cmd";
      string line = ReadFirstLine(rel);
      string k[], v[];
      if(seq <= g_lastSeq)
      {
         FileDelete(g_dir + "\\" + rel, FILE_COMMON);
         WriteResult(seq, "?", "DUPLICATE", "", 0, 0, 0, "seq already processed");
         continue;
      }
      if(!ParseKV(line, k, v))
      {
         if(line == "") continue;   // being written / locked - try next timer
         FileDelete(g_dir + "\\" + rel, FILE_COMMON);
         LogEvent("error", "BAD_CMD", rel);
         continue;
      }
      g_lastSeq = seq;   // persisted BEFORE acting, so a crash can never replay it
      SaveCounters();
      FileDelete(g_dir + "\\" + rel, FILE_COMMON);
      HandleCommand(k, v, seq);
   }
}

//+------------------------------------------------------------------+
//| protection: runs every timer, independent of Python                |
//+------------------------------------------------------------------+
int UnprotIndex(const int ticket)
{
   for(int i = 0; i < ArraySize(g_unprotTicket); i++) if(g_unprotTicket[i] == ticket) return i;
   return -1;
}

void ManagePositions()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!SelectSystemOrder(i) || OrderType() > OP_SELL) continue;
      int ticket = OrderTicket();
      string sym = OrderSymbol();
      double point = MarketInfo(sym, MODE_POINT);
      int digits = (int)MarketInfo(sym, MODE_DIGITS);
      bool isBuy = (OrderType() == OP_BUY);
      double sign = isBuy ? 1 : -1;
      double px = isBuy ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
      double sl = OrderStopLoss();
      double lvl = MarketInfo(sym, MODE_STOPLEVEL) * point;
      double frz = MarketInfo(sym, MODE_FREEZELEVEL) * point;
      if(point <= 0 || px <= 0) continue;

      //--- unprotected position: restore the original SL or close after a grace period
      if(sl <= 0)
      {
         int u = UnprotIndex(ticket);
         if(u < 0)
         {
            u = ArraySize(g_unprotTicket);
            ArrayResize(g_unprotTicket, u + 1); ArrayResize(g_unprotSince, u + 1);
            g_unprotTicket[u] = ticket; g_unprotSince[u] = TimeLocal();
            LogEvent("critical", "UNPROTECTED", StringFormat("#%d has no stop-loss", ticket));
         }
         double isl = GvGet("ISL_" + IntegerToString(ticket), 0);
         if(isl > 0 && (px - isl) * sign > lvl)
         {
            if(OrderModify(ticket, OrderOpenPrice(), NormalizeDouble(isl, digits), OrderTakeProfit(), 0, clrNONE))
            { LogEvent("warning", "SL_RESTORED", StringFormat("#%d SL restored to %s", ticket, Num(isl, digits))); continue; }
         }
         if(TimeLocal() - g_unprotSince[u] >= UnprotectedGraceSec) CloseTicket(ticket, 0, "unprotected position");
         continue;
      }

      double r = GvGet("R_" + IntegerToString(ticket), 0);
      if(r <= 0) { r = MathAbs(OrderOpenPrice() - sl); GlobalVariableSet(GvName("R_" + IntegerToString(ticket)), r); }
      double prof = (px - OrderOpenPrice()) * sign;
      double newSl = sl;
      if(BreakEvenEnabled && r > 0 && prof >= BreakEvenTriggerR * r)
      {
         double be = NormalizeDouble(OrderOpenPrice() + sign * BreakEvenOffsetPoints * point, digits);
         if((be - newSl) * sign > 0) newSl = be;
      }
      if(TrailingEnabled && r > 0 && prof >= TrailingStartR * r)
      {
         double a = iATR(sym, TrailingATRTimeframe, TrailingATRPeriod, 1);
         if(a > 0)
         {
            double cand = NormalizeDouble(px - sign * TrailingATRMult * a, digits);
            if((cand - newSl) * sign >= TrailingStepPoints * point) newSl = cand;
         }
      }
      // never widen; respect stop and freeze levels
      if((newSl - sl) * sign > point / 2 && (px - newSl) * sign > lvl && !(frz > 0 && MathAbs(px - sl) <= frz))
      {
         if(OrderModify(ticket, OrderOpenPrice(), newSl, OrderTakeProfit(), 0, clrNONE)) { g_mods++; SaveCounters(); }
         else LogEvent("warning", "MODIFY_FAILED", StringFormat("#%d err %d", ticket, GetLastError()));
      }
      if(MaxHoldHours > 0 && (double)(ServerNow() - OrderOpenTime()) >= MaxHoldHours * 3600)
         CloseTicket(ticket, 0, "max holding time");
   }
}

//+------------------------------------------------------------------+
//| day roll, daily loss, emergency stop flag                          |
//+------------------------------------------------------------------+
void DayRoll()
{
   int d = DayIdForGmt(TimeGMT());
   if(d == g_day) return;
   if(g_day == 0)
   {
      // First run (or GlobalVariables lost) mid-day: approximate the day-start equity
      // from balance minus today's closed P&L and cash flows (floating P&L carried
      // over the boundary is unknown and treated as 0). Documented in docs/RISK.md.
      datetime startSrv = DayStartGmt(TimeGMT()) + g_srvOffset;
      double closedToday = 0;
      for(int j = OrdersHistoryTotal() - 1; j >= 0; j--)
         if(OrderSelect(j, SELECT_BY_POS, MODE_HISTORY) && OrderType() <= OP_SELL && OrderCloseTime() >= startSrv)
            closedToday += OrderProfit() + OrderSwap() + OrderCommission();
      ScanCashFlows();
      g_dse = AccountBalance() - closedToday - g_flows;
      // Rebuild the entry count from broker history so a lost counter can't reset the cap.
      int recount = 0;
      for(int i = OrdersTotal() - 1; i >= 0; i--)
         if(SelectSystemOrder(i) && OrderType() <= OP_SELL && OrderOpenTime() >= startSrv) recount++;
      for(int h2 = OrdersHistoryTotal() - 1; h2 >= 0; h2--)
         if(OrderSelect(h2, SELECT_BY_POS, MODE_HISTORY) && OrderMagicNumber() == MagicNumber &&
            OrderType() <= OP_SELL && OrderOpenTime() >= startSrv && StringFind(OrderComment(), "from #") < 0) recount++;
      g_entries = (int)MathMax(g_entries, recount);
   }
   else
   {
      g_dse = AccountEquity();
      g_entries = 0;
   }
   g_day = d;
   g_flows = 0; g_failed = 0; g_mods = 0; g_partials = 0;
   g_halt = false; g_haltReason = "";
   SaveCounters();
   LogEvent("info", "DAY_ROLL", "trading day " + DayIdStr(d) + " start equity " + Num(g_dse, 2));
}

void CheckDailyLoss()
{
   if(g_halt) return;
   double loss = DailyLossPct();
   if(loss >= MaxDailyLossPct)
   {
      g_halt = true;
      g_haltReason = StringFormat("daily loss %.2f%% >= %.2f%%", loss, MaxDailyLossPct);
      SaveCounters();
      LogEvent("critical", "DAILY_LOSS_HALT", g_haltReason);
      CancelPendingSystem();
      if(DailyLossPolicy == POLICY_CLOSE_ALL) CloseAllSystem("daily loss limit");
   }
}

void CheckEStopFlag()
{
   if(g_estop) return;
   string path = g_dir + "\\estop.flag";
   if(!FileIsExist(path, FILE_COMMON)) return;
   string k[], v[];
   int policy = EStopPolicy;
   if(ParseKV(ReadFirstLine("estop.flag"), k, v))
      policy = (KV(k, v, "policy") == "hold") ? POLICY_HOLD_PROTECTED : POLICY_CLOSE_ALL;
   TriggerEStop(policy, "estop.flag present");
}

//+------------------------------------------------------------------+
//| exports                                                            |
//+------------------------------------------------------------------+
string OrderJson(const bool withClose)
{
   string s = "{\"ticket\":" + IntegerToString(OrderTicket()) + ",\"symbol\":\"" + JsonEsc(OrderSymbol()) +
              "\",\"type\":" + IntegerToString(OrderType()) + ",\"lots\":" + Num(OrderLots(), 2) +
              ",\"open_price\":" + Num(OrderOpenPrice()) + ",\"open_time\":" + IntegerToString((long)OrderOpenTime()) +
              ",\"sl\":" + Num(OrderStopLoss()) + ",\"tp\":" + Num(OrderTakeProfit()) +
              ",\"profit\":" + Num(OrderProfit(), 2) + ",\"swap\":" + Num(OrderSwap(), 2) +
              ",\"commission\":" + Num(OrderCommission(), 2) + ",\"magic\":" + IntegerToString(OrderMagicNumber()) +
              ",\"comment\":\"" + JsonEsc(OrderComment()) + "\"";
   if(withClose) s += ",\"close_time\":" + IntegerToString((long)OrderCloseTime()) + ",\"close_price\":" + Num(OrderClosePrice());
   return s + "}";
}

void WriteState()
{
   g_stateSeq++;
   string s = "{\"v\":" + IntegerToString(FXAI_PROTOCOL) + ",\"seq\":" + IntegerToString(g_stateSeq);
   s += ",\"time\":{\"server\":" + IntegerToString((long)ServerNow()) + ",\"gmt\":" + IntegerToString((long)TimeGMT()) +
        ",\"local\":" + IntegerToString((long)TimeLocal()) + ",\"last_server\":" + IntegerToString((long)TimeCurrent()) + "}";
   s += ",\"account\":{\"login\":" + IntegerToString(AccountNumber()) + ",\"server\":\"" + JsonEsc(AccountServer()) +
        "\",\"company\":\"" + JsonEsc(AccountCompany()) + "\",\"currency\":\"" + AccountCurrency() +
        "\",\"leverage\":" + IntegerToString(AccountLeverage()) + ",\"balance\":" + Num(AccountBalance(), 2) +
        ",\"equity\":" + Num(AccountEquity(), 2) + ",\"margin\":" + Num(AccountMargin(), 2) +
        ",\"free_margin\":" + Num(AccountFreeMargin(), 2) + ",\"is_demo\":" + BoolStr(IsDemo()) +
        ",\"trade_allowed\":" + BoolStr(IsTradeAllowed() && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0) +
        ",\"connected\":" + BoolStr(IsConnected()) + "}";
   s += ",\"ea\":{\"version\":\"" + FXAI_EA_VERSION + "\",\"master\":" + BoolStr(g_master) +
        ",\"trading_enabled\":" + BoolStr(EnableTrading) + ",\"live_allowed\":" + BoolStr(AllowLiveAccount) +
        ",\"estop\":" + BoolStr(g_estop) + ",\"paused\":" + BoolStr(g_paused) + ",\"halted\":" + BoolStr(g_halt) +
        ",\"halt_reason\":\"" + JsonEsc(g_haltReason) + "\",\"day_id\":\"" + DayIdStr(g_day) +
        "\",\"day_start_equity\":" + Num(g_dse, 2) + ",\"net_flows\":" + Num(g_flows, 2) +
        ",\"daily_loss_pct\":" + Num(DailyLossPct(), 4) + ",\"entries_today\":" + IntegerToString(g_entries) +
        ",\"failed_today\":" + IntegerToString(g_failed) + ",\"modifications_today\":" + IntegerToString(g_mods) +
        ",\"partial_closes_today\":" + IntegerToString(g_partials) + ",\"py_heartbeat_age\":" + Num(PyHeartbeatAge(), 1) +
        ",\"last_cmd_seq\":" + IntegerToString(g_lastSeq) + ",\"server_offset\":" + IntegerToString(g_srvOffset) +
        ",\"magic\":" + IntegerToString(MagicNumber) + ",\"reset_zone\":\"" + ZoneName() +
        "\",\"reset_hour\":" + IntegerToString(ResetHour) + ",\"bar_timeframes\":\"" + JsonEsc(BarTimeframes) +
        "\",\"bars_to_export\":" + IntegerToString(BarsToExport) + ",\"symbol_prefix\":\"" + JsonEsc(SymbolPrefix) +
        "\",\"symbol_suffix\":\"" + JsonEsc(SymbolSuffix) + "\"" +
        ",\"limits\":{\"risk_per_trade_pct\":" + Num(MaxRiskPerTradePct, 4) + ",\"total_risk_pct\":" + Num(MaxTotalRiskPct, 4) +
        ",\"max_positions\":" + IntegerToString(MaxOpenPositions) + ",\"max_entries\":" + IntegerToString(MaxEntriesPerDay) +
        ",\"daily_loss_pct\":" + Num(MaxDailyLossPct, 4) + "}}";
   s += ",\"symbols\":[";
   for(int i = 0; i < ArraySize(g_bsyms); i++)
   {
      string b = g_bsyms[i];
      if(i > 0) s += ",";
      s += "{\"name\":\"" + JsonEsc(b) + "\",\"canonical\":\"" + g_syms[i] + "\",\"base\":\"" +
           SymbolInfoString(b, SYMBOL_CURRENCY_BASE) + "\",\"profit_ccy\":\"" + SymbolInfoString(b, SYMBOL_CURRENCY_PROFIT) +
           "\",\"bid\":" + Num(MarketInfo(b, MODE_BID)) + ",\"ask\":" + Num(MarketInfo(b, MODE_ASK)) +
           ",\"tick_time\":" + IntegerToString((long)MarketInfo(b, MODE_TIME)) +
           ",\"digits\":" + IntegerToString((int)MarketInfo(b, MODE_DIGITS)) + ",\"point\":" + Num(MarketInfo(b, MODE_POINT), 10) +
           ",\"tick_size\":" + Num(MarketInfo(b, MODE_TICKSIZE), 10) + ",\"tick_value\":" + Num(MarketInfo(b, MODE_TICKVALUE), 8) +
           ",\"contract_size\":" + Num(MarketInfo(b, MODE_LOTSIZE), 2) + ",\"min_lot\":" + Num(MarketInfo(b, MODE_MINLOT), 2) +
           ",\"max_lot\":" + Num(MarketInfo(b, MODE_MAXLOT), 2) + ",\"lot_step\":" + Num(MarketInfo(b, MODE_LOTSTEP), 2) +
           ",\"stop_level\":" + IntegerToString((int)MarketInfo(b, MODE_STOPLEVEL)) +
           ",\"freeze_level\":" + IntegerToString((int)MarketInfo(b, MODE_FREEZELEVEL)) +
           ",\"margin_required\":" + Num(MarketInfo(b, MODE_MARGINREQUIRED), 2) +
           ",\"trade_allowed\":" + BoolStr(MarketInfo(b, MODE_TRADEALLOWED) != 0) +
           ",\"swap_long\":" + Num(MarketInfo(b, MODE_SWAPLONG), 4) + ",\"swap_short\":" + Num(MarketInfo(b, MODE_SWAPSHORT), 4) + "}";
   }
   s += "],\"orders\":[";
   bool first = true;
   for(int o = 0; o < OrdersTotal(); o++)
   {
      if(!OrderSelect(o, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderMagicNumber() != MagicNumber && !ExportManualOrders) continue;
      if(!first) s += ",";
      s += OrderJson(false);
      first = false;
   }
   s += "],\"history\":[";
   first = true;
   datetime since = DayStartGmt(TimeGMT()) + g_srvOffset - 86400;
   int hn = OrdersHistoryTotal(), taken = 0;
   for(int j = hn - 1; j >= 0 && taken < 200 && j >= hn - 500; j--)
   {
      if(!OrderSelect(j, SELECT_BY_POS, MODE_HISTORY)) continue;
      bool flow = OrderType() > OP_SELLSTOP;
      if(OrderCloseTime() < since && !(flow && OrderOpenTime() >= since)) continue;
      if(!flow && OrderMagicNumber() != MagicNumber && !ExportManualOrders) continue;
      if(!first) s += ",";
      s += OrderJson(true);
      first = false; taken++;
   }
   s += "],\"events\":[";
   for(int e = 0; e < ArraySize(g_events); e++) s += (e > 0 ? "," : "") + g_events[e];
   s += "]}";
   if(!AtomicWrite("state.json", s)) LogEvent("warning", "STATE_WRITE", "state.json locked - retry next cycle");
}

void WriteBars()
{
   int ntf = ArraySize(g_tfs);
   for(int i = 0; i < ArraySize(g_bsyms); i++)
      for(int t = 0; t < ntf; t++)
      {
         string b = g_bsyms[i];
         int tf = g_tfs[t];
         ResetLastError();
         datetime last = iTime(b, tf, 1);   // last COMPLETED bar
         if(GetLastError() == 4066 || last == 0) continue;   // history still loading
         int idx = i * ntf + t;
         if(last == g_lastBar[idx]) continue;
         int avail = iBars(b, tf) - 1;
         int n = (int)MathMin(BarsToExport, avail);
         if(n < 50) continue;
         string out = "time,open,high,low,close,volume,spread\n";
         for(int sh = n; sh >= 1; sh--)
            out += IntegerToString((long)iTime(b, tf, sh)) + "," + Num(iOpen(b, tf, sh)) + "," + Num(iHigh(b, tf, sh)) + "," +
                   Num(iLow(b, tf, sh)) + "," + Num(iClose(b, tf, sh)) + "," + IntegerToString((long)iVolume(b, tf, sh)) + ",0\n";
         if(AtomicWrite("bars\\" + g_syms[i] + "_" + g_tfNames[t] + ".csv", out)) g_lastBar[idx] = last;
      }
}

void ShowStatus()
{
   string s = "FXAI Bridge " + FXAI_EA_VERSION + (g_master ? "  [ACTIVE]" : "  [STANDBY - another chart is active]") + "\n";
   s += StringFormat("Trading %s | %s | live allowed %s\n", EnableTrading ? "ENABLED" : "disabled",
                     IsDemo() ? "DEMO" : "REAL", AllowLiveAccount ? "yes" : "no");
   s += StringFormat("Day %s  entries %d/%d  failed %d  mods %d\n", DayIdStr(g_day), g_entries, MaxEntriesPerDay, g_failed, g_mods);
   s += StringFormat("Daily loss %.2f%% / %.2f%%  %s\n", DailyLossPct(), MaxDailyLossPct, g_halt ? "HALTED: " + g_haltReason : "");
   s += StringFormat("Python heartbeat %.0fs  estop %s  paused %s  positions %d", PyHeartbeatAge(),
                     g_estop ? "ACTIVE" : "off", g_paused ? "yes" : "no", CountSystemPositions());
   Comment(s);
}

//+------------------------------------------------------------------+
//| event handlers                                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   if(MaxRiskPerTradePct <= 0 || MaxRiskPerTradePct > 2.0 || MaxTotalRiskPct < MaxRiskPerTradePct ||
      MaxTotalRiskPct > 5.0 || MaxEntriesPerDay < 0 || MaxEntriesPerDay > 20 || MaxOpenPositions < 1 ||
      MaxDailyLossPct <= 0 || MaxDailyLossPct > 10 || ResetHour < 0 || ResetHour > 23)
   {
      Alert("FXAI: risk inputs outside allowed ranges - EA not started");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(IsTesting()) Print("FXAI: the Strategy Tester has no Python service; use the Python backtester instead");
   g_dir = "FXAI\\" + IntegerToString(AccountNumber());
   FolderCreate("FXAI", FILE_COMMON);
   FolderCreate(g_dir, FILE_COMMON);
   FolderCreate(g_dir + "\\cmd", FILE_COMMON);
   FolderCreate(g_dir + "\\res", FILE_COMMON);
   FolderCreate(g_dir + "\\bars", FILE_COMMON);
   MathSrand((int)GetTickCount());
   g_lockId = (double)(GetTickCount() % 1000000) + 1.0 + MathRand() / 32768.0;
   LoadCounters();
   LoadTags();
   LoadPending();
   if(!InitSymbols()) { Alert("FXAI: none of the configured symbols exist at this broker"); return INIT_FAILED; }
   UpdateServerOffset();
   if(!EventSetMillisecondTimer((int)MathMax(100, TimerMs))) { Alert("FXAI: timer could not be created"); return INIT_FAILED; }
   LogEvent("info", "INIT", StringFormat("EA %s started, trading %s, account %s, folder Common\\Files\\%s",
            FXAI_EA_VERSION, EnableTrading ? "ENABLED" : "disabled", IsDemo() ? "DEMO" : "REAL", g_dir));
   if(!IsDemo() && !AllowLiveAccount) LogEvent("warning", "LIVE_BLOCKED", "real-money account: entries blocked (AllowLiveAccount=false)");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(GlobalVariableCheck(GvName("LOCK")) && GlobalVariableGet(GvName("LOCK")) == g_lockId) GlobalVariableSet(GvName("LOCK"), 0);
   SaveCounters();
   Comment("");
}

void OnTick() { g_lastTickLocal = TimeLocal(); }

void OnTimer()
{
   g_master = HoldLock();
   if(!g_master) { ShowStatus(); return; }
   UpdateServerOffset();
   RefreshRates();
   DayRoll();
   ScanCashFlows();
   CheckEStopFlag();
   CheckDailyLoss();
   ManagePositions();          // protection first, always
   ProcessCommands();
   ReconcilePending();
   if(TimeLocal() != g_lastStateWrite)
   {
      g_lastStateWrite = TimeLocal();
      WriteBars();
      WriteState();
   }
   ShowStatus();
}
//+------------------------------------------------------------------+
