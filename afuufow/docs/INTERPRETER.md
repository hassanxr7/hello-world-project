# Wakiilka hawlaha — Open Interpreter ku dhex dhisan Afuufow
# Task agent — Open Interpreter inside Afuufow

*(Somali first, English summary at the end of each section.)*

## 1. Waa maxay? / What it is
Afuufow hadda wuxuu leeyahay **wakiil hawleed** oo ku shaqeeya awoodda **Open Interpreter**: wuxuu qaban karaa hawlo badan oo isku xiran (kala saar faylasha, magac-bedel badan, qor oo fuli amarro, raadi webka), halkii Afuufow uu ku koobnaan lahaa amarro keliya ah ("Chrome fur").
Waxaad ku bilaabaysaa: **“Wakiilka: kala saar faylasha Downloads nooc ahaan”** (ama “agent: …”, “open interpreter …”), ama badhanka **🛠 Wakiil** ee bogga Guriga. Afuufow wuu kuu hadlayaa, wuxuuna ku jawaabayaa **qoraal iyo cod Soomaali** ah.

*Afuufow can now hand multi-step computer jobs to the Open Interpreter engine. Start with "wakiilka: …" / "agent: …" or the 🛠 Agent button; answers come back in Somali text and voice.*

## 2. Licence iyo sida loo dhex geliyay / Licence and how it is integrated
* Repo: <https://github.com/openinterpreter/openinterpreter> (inspected at commit `ac1fcc8`, release `rust-v0.0.56`).
* **Licence: Apache-2.0** (`LICENSE` file present, copyright notice in `NOTICE`; the project is a fork of OpenAI Codex, also Apache-2.0). Apache-2.0 permits use, modification and redistribution with notice. The notice is kept in `docs/licenses/OPEN_INTERPRETER_NOTICE.txt` and `THIRD_PARTY_NOTICES.md`.
* **Important correction to the usual picture:** this is **not** the old Python "open-interpreter" package. It is a **Rust coding agent** (~8,700 files, ~100 MB of source, ~250 MB binary) with a terminal UI, an exec mode and an **Agent Client Protocol (ACP)** server.
* **Why its source is not copied into Afuufow:** it cannot be merged into an Electron/TypeScript app; it has to be built with Rust/Bazel. Instead Afuufow runs the **official release binary as a separate process** and talks to it over ACP (`interpreter acp`, JSON-RPC over stdio). This keeps the licences and updates separate and lets Afuufow keep full control of **every approval**.
* The engine is **not bundled in the installer** (it would add 250 MB). Afuufow downloads the pinned release from GitHub Releases on request, checks its **SHA-256** (pinned in `src/main/interpreter/engine.ts`, taken from the release's own checksum file for that exact tag; a mismatch aborts and deletes the file) and unpacks it under `%APPDATA%\Afuufow\interpreter\`. It uses its **own private config** there; your own `~/.openinterpreter` is never read or changed.

## 3. Rakibid / Installation (user steps)
1. Rakib Afuufow (installer-ka GitHub Actions).
2. Fur bogga **🛠 Wakiilka (Agent)**:
   1. **Engine-ka:** guji **Soo deji oo rakib** (~261 MB; fiiri sida loo dhammeeyo bar-socodka).
   2. **Moodelka AI (cloud):** dooro bixiyaha (**Anthropic** ama **OpenAI**), qor magaca moodelka (default `claude-sonnet-5-5`; si dhaqso badan oo rahsan: `claude-haiku-5-5`), geli **API key** (furahan waa mid gooni ah oo ka duwan akoonka claude.ai/ChatGPT), oo fur **Oggolow cloud AI**.
   3. **Ammaan iyo xad:** fur **Fur wakiilka**; dooro galka shaqada (default `Documents\Afuufow Workspace`), xadka waqtiga iyo weydiimaha.
   4. **Tijaabo:** guji **Tijaabi wakiilka** (kharash yar; wuxuu u dirayaa hal erey oo Soomaali ah oo wuxuu diidayaa amar kasta).
3. Ku dheh ama ku qor: **“Wakiilka: tus faylasha galka shaqada”**.

*English: install Afuufow → Agent page → download engine → choose provider/model + API key + allow cloud AI → enable → test → say "wakiilka: …".*

## 4. Oggolaansho iyo ammaan / Permissions and safety
Waa shuruucda aad codsatay (tirtirid, fariin, lacag) iyo wax dheeraad ah. Waxaa lagu xoojiyay **saddex lakab**:

| Lakab | Maxay sameysaa |
|---|---|
| **Engine-ka lafteeda** | Galka shaqada waxaa loo calaamadeeyay `trust_level = "untrusted"`: Open Interpreter wuxuu **weydiiyaa amar kasta** ka hor intuusan fulin (ACP `session/request_permission`). Sandbox: `workspace-write`, shabakadda sandbox-ka waa xiran tahay, raadinta webka waa laga joojiyay ilaa aad furto. |
| **Afuufow (`src/core/agent/approval.ts`)** | Amar kasta wuu eegaa oo wuxuu go'aamiyaa inta xaqiijin ee loo baahan yahay (hoos). Wuxuu **weligii** dooran la'yahay "oggolow fadhigan oo dhan": oggolaansho kasta waa mid keliya. |
| **Ilaalinta “prompt injection”** | Marka wakiilku taabto webka (raadin/soo dejin), **tallaabo kasta oo wax beddesha** waxay u baahan tahay xaqiijin xooggan. Wax ka yimid webka/faylasha waa “aan la aamini karin”; wakiilka waa laga reebay inuu fariimo diro. |

| Nooca amarka | Maxaa dhaca |
|---|---|
| Liis/akhris fudud (`ls`, `dir`, `Get-ChildItem`…) **gudaha galka la oggolaaday**, aan bar/pipe/variable lahayn | Si toos ah ayuu u socdaa (hal-hal ayaa la tiriyaa) |
| Beddel caadi ah gudaha galka la oggolaaday (guur, koobi, samee) | Waxaa la weydiiyaa: **haa/maya** (cod ama badhan) |
| **Tirtirid** hal fayl gudaha galka la oggolaaday | **haa/maya**, iyadoo la sheegayo “TIRTIRID” iyo amarka dhabta ah |
| Tirtirid **galal oo dhan**, meel ka baxsan galka la oggolaaday, **lacag-bixin**, **fariin diris**, xog gaar ah (furayaal/password), soo dejin+fulin koodh, rakibid software, beddelka nidaamka, ama amar aan la aqoon | **Windows Hello ama PIN** *iyo* kadib **haa** |
| Aad u halis badan (format disk, `rm -rf /`, `diskpart`, tirtirka `C:\Windows`…) | **Waa la diiday si buuxda**; lama weydiiyo |
| Jawaab la'aan 2 daqiiqo, cilad, joojin, “jooji”, codka qof kale | = **maya** |

**Daacadnimo:** kala-saarista amarrada qoraalka shell-ka **ma noqon karto mid dhammaystiran** (amar waa la qarin karaa). Sidaa darteed asalku waa “weydii wax walba”, waxaad **aragtaa amarka dhabta ah** ka hor inta aadan oggolaan, kala-saaruhuna wuxuu go'aamiyaa oo keliya *inta xaqiijin*. Waxa wakiilku sheego waa **warbixintiisa** (“Wakiilku wuxuu sheegay: …”), ma aha wax Afuufow xaqiijiyay.

*English: three layers — the engine is configured to ask before EVERY command; Afuufow classifies each command and demands yes / Windows Hello+yes / refusal; and after any web access every state-changing step needs strong verification. Single-use approvals only. The classifier cannot be complete, so you always see the real command first, and the agent's closing message is reported as its own claim.*

## 5. Kharashka / Costs
* **Open Interpreter lafteeda: bilaash** (Apache-2.0). Afuufow: bilaash.
* **API-ga moodelka** waxaa lagu bixiyaa **tokenka** bixiyahaaga. Qiimaha Anthropic (cached 2026-10-06, per 1M tokens, input / output): **Haiku 5.5 $0.10 / $0.50** (≤100K prompt), **Sonnet 5.5 $2 / $10**, Opus 5.5 $4 / $20. Qiimaha OpenAI: eeg boggooda qiimaha (lama xaqiijin halkan).
* **Qiyaas (ma aha cabbir dhab ah):** codsi kasta oo engine-ku u diro moodelka wuxuu ku jiraa ≈ **7.5K token** (prompt-ka engine-ka + qalabka, la cabbiray: 22.7K + 7.5K xarfood ÷ 4) oo koraya markasta oo amarro la fuliyo. Hawl caadi ah (~10 wareeg) ≈ **100–150K token oo gelitaan** + ~3K soo-saar ⇒ **≈ $0.012–0.02 (Haiku 5.5)** ama **≈ $0.2–0.3 (Sonnet 5.5)** hal hawl, iyadoo aan caching la tirin. Raadinta webka, fayl weyn oo la akhriyo, ama hawlo dhaadheer way kordhiyaan. Xadka waqtiga/weydiimaha ee bogga Wakiilka ayaa xadidaya waqtiga; **ma jiro xad lacageed oo Afuufow dhigo**, ku dhig xad bixiyahaaga (Anthropic Console / OpenAI limits).
* **Codka Soomaaliga:** Azure Speech si gooni ah (eeg `HARDWARE_AND_COSTS.md`). **Wada sheekaysiga/chat-ka caadi ah** wuxuu isticmaalaa moodelka Afuufow (Ollama bilaash ama cloud) — wakiilku wuxuu isticmaalaa mid kale oo la dooray.

*English: engine free; you pay the model API per token. Measured first request ≈ 7.5K tokens; a typical 10-turn task ≈ 100–150K input tokens ⇒ roughly $0.01–0.02 with Haiku 5.5, $0.2–0.3 with Sonnet 5.5 (estimates, no caching). No spend cap is enforced by Afuufow — set one at your provider.*

## 6. Waxa la tijaabiyay / What was tested
| Waxa la tijaabiyay | Meel |
|---|---|
| ACP client (JSON-RPC, deduping the engine's repeated final message, one-time approvals only, no client capabilities, error replies) · kala-saaraha khatarta (~35 xaalad: tirtirid, lacag, fariin, xog gaar ah, netexec, rakibid, nidaam, halis weyn, waddooyin leh meel bannaan, taint-ka webka) · xirmada/stop/timeout/engine dhimasho | **Unit** (37 test) iyo engine been abuur ah |
| Afuufow oo dhan (parser → tool → weydiinta → jawaabta Soomaaliga): haa/maya/mid aan cad ahayn/amar kale intaan la sugayo/jooji/xaqiijin xooggan/codka qof kale | **Unit** (17 test) |
| **Engine dhab ah** (release `rust-v0.0.56` Linux, SHA-256 la hubiyay) iyo moodel la qoray: weydiin kasta oo amar, "maya" waxay ka ilaalinaysaa faylka, "haa" wuu socdaa, akhris fudud su'aal la'aan, joojin, furaha API-ga oo la diiday la sharaxayo, galka leh meel bannaan | **Integration** (14 test) — **Linux** iyo **Windows dhab ah (GitHub Actions run #21, ✅)**: soo dejinta + SHA-256 + `tar.exe`, engine-ka, weydiin-ka-hor-amarka, haa/maya, akhris fudud, joojin. Tijaabadani waxay heshay laba cilad oo Windows-ka u gaar ah (`kind: search` iyo backslash-yo labalaab ah) oo la hagaajiyay. |
| Demo buuxa (Assistant + engine dhab ah + moodel la qoray) | `docs/DEMO_AGENT_TRANSCRIPT.md` |

## 7. Waxa AAN la tijaabin / NOT verified
* **Moodel dhab ah** (Claude/OpenAI) oo hawlo dhab ah qabta: waxaan lahayn furaha API-ga, sidaa darteed **tayada go'aamada moodelka ma cabbirin**, mana cabbirin inta uu **Soomaaliga** fahmo (waxay ku xiran tahay moodelka; Claude/GPT-ka waaweyn way fiican yihiin, moodelo yaryar way liitaan karaan).
* **Windows dhab ah oo gacanta ah:** CI-Windows wuxuu xaqiijiyay engine-ka iyo weydiimaha (PowerShell 7 `pwsh.exe -Command …`), laakiin ma aha qof dhab ah oo gacanta ku isticmaalay. Sandbox-ka Windows (wuxuu kaga duwan yahay Linux/macOS; Open Interpreter laftiisu wuxuu u soo jeediyaa WSL haddii sandbox xooggan loo baahan yahay) iyo sida amarrada loo cinwaaniyo (`title`) Windows-ka waa in la hubiyo shaqo-ku-dhex-jirka.
* **Browser (Playwright MCP):** doorashada waxaa lagu daray sida **tijaabo**; engine-ka dhabta ah ee aan tijaabiyay **ma muujin qalabka MCP-ga** moodelka (server-ka waa la aqoonsaday `enabled`, laakiin qalabka lama soo bandhigin) — sidaa darteed **lama xaqiijin** waxay shaqayso iyo in kale. Fur webka iyo soo dejinta waxaa wali lagu qaban karaa amarro (iyagoo oggolaansho u baahan) iyo qalabka Afuufow (YouTube, raadin).
* Shabakadda engine-ka: waxaan hubiyay inuu u dirayo codsiyada moodelka kaliya ee aan u habeeyay; **ma baadhin si buuxda** wicitaannada kale (tusaale telemetry, plugin catalogue, update-check). Waxaan damiyay `check_for_update_on_startup`, plugins, apps, memories, multi_agent. Haddii aad rabto xakameyn buuxda, xir shabakadda engine-ka xayeysiiska Windows Firewall ee `interpreter.exe` marka laga reebo bixiyaha moodelkaaga.
* Dhawr amar oo xasaasi ah (fariin/lacag) waxaa laga yaabaa in wakiilku sameeyo si aan amar-shell ahayn (tusaale browser MCP); kuwaas waxay mari doonaan oggolaansho MCP (`default_tools_approval_mode = "prompt"`), laakiin kala-saarista Afuufow ee kuwaas waa u nugul tahay.

## 8. Ka saarid / Removal
Bogga Wakiilka → **Ka saar** (waxay tirtirtaa `%APPDATA%\Afuufow\interpreter\`). Faylasha galka shaqada ma taabanayso.
