# Demo: Afuufow + Open Interpreter (engine dhab ah, moodel la qoray)

> Xaqiiqo: **engine-ka Open Interpreter, ACP, weydiinta oggolaanshaha, iyo faylasha waa kuwo dhab ah.** Kaliya jawaabaha **moodelka AI waa la qoray** (scripted) si demo-gu u noqdo mid joogto ah oo bilaash ah. Moodel dhab ah (Claude/OpenAI) wuxuu go'aamiyaa amarrada laftiisa; Afuufow oggolaanshaha ayuu weydiiyaa isla sidaas.


### 1. Akhris fudud (su'aal looma baahna)

Faylasha ka hor: `Archive, duugan.tmp, invoice.pdf, warbixin.txt | Archive: (maran)`

**Hassan:** Wakiilka: tus faylasha galka shaqada

**Afuufow:** Wakiilku wuxuu sheegay: Waxaa jira 3 fayl iyo galka Archive. (0 oggolaaday, 0 la diiday, 1 akhris fudud)

Codka Afuufow (TTS):
> 🔊 Wakiilku wuxuu sheegay: Waxaa jira 3 fayl iyo galka Archive. (0 oggolaaday, 0 la diiday, 1 akhris fudud)

Faylasha kadib: `Archive, duugan.tmp, invoice.pdf, warbixin.txt | Archive: (maran)`

_Liiska galka la oggolaaday waa akhris fudud, sidaas darteed si toos ah ayuu u socday._


### 2. U guur fayl (oggolaansho: haa)

Faylasha ka hor: `Archive, duugan.tmp, invoice.pdf, warbixin.txt | Archive: (maran)`

**Hassan:** Wakiilka: u guur invoice.pdf galka Archive

**Afuufow (shaashadda):** Amarka: mv '/tmp/afu-demo-ncpY67/Afuufow Workspace/invoice.pdf' '/tmp/afu-demo-ncpY67/Afuufow Workspace/Archive/invoice.pdf'

**Hassan:** haa

**Afuufow:** Wakiilku wuxuu sheegay: Waan u guuray invoice.pdf galka Archive. (1 oggolaaday, 0 la diiday, 0 akhris fudud)

Codka Afuufow (TTS):
> 🔊 Wakiilku wuxuu rabaa inuu fuliyo amar. Ma oggol tahay?
> 🔊 Wakiilku wuxuu sheegay: Waan u guuray invoice.pdf galka Archive. (1 oggolaaday, 0 la diiday, 0 akhris fudud)

Faylasha kadib: `Archive, duugan.tmp, warbixin.txt | Archive: invoice.pdf`

_Faylka dhab ahaan wuu guuray (eeg liiska kadib)._


### 3. Tirtirid (oggolaansho: maya)

Faylasha ka hor: `Archive, duugan.tmp, warbixin.txt | Archive: invoice.pdf`

**Hassan:** Wakiilka: tirtir faylka duugan.tmp

**Afuufow (shaashadda):** Amarka: rm '/tmp/afu-demo-ncpY67/Afuufow Workspace/duugan.tmp'

**Hassan:** maya

**Afuufow:** Wakiilku wuxuu sheegay: Ma tirtirin faylka sababtoo ah waad diidday. (0 oggolaaday, 1 la diiday, 0 akhris fudud)

Codka Afuufow (TTS):
> 🔊 Wakiilku wuxuu rabaa inuu fuliyo amar: TIRTIRID. Ma oggol tahay?
> 🔊 Wakiilku wuxuu sheegay: Ma tirtirin faylka sababtoo ah waad diidday. (0 oggolaaday, 1 la diiday, 0 akhris fudud)

Faylasha kadib: `Archive, duugan.tmp, warbixin.txt | Archive: invoice.pdf`

_Waxaa la weydiiyay TIRTIRID; jawaabta maya awgeed faylka wuu hadhay._


### 4. Lacag-bixin (xaqiijin xooggan + maya)

Faylasha ka hor: `Archive, duugan.tmp, warbixin.txt | Archive: invoice.pdf`

**Hassan:** Wakiilka: bixi biilka koronto

**Afuufow:** Tallaabadan waxay u baahan tahay Windows Hello ama PIN-kaaga.

**Afuufow (shaashadda):** Amarka: echo checkout > '/tmp/afu-demo-ncpY67/Afuufow Workspace/paid.txt'

**Hassan:** maya

**Afuufow:** Wakiilku wuxuu sheegay: Ma bixin lacagta. (0 oggolaaday, 1 la diiday, 0 akhris fudud)

Codka Afuufow (TTS):
> 🔊 Tallaabadan waxay u baahan tahay Windows Hello ama PIN-kaaga.
> 🔊 Wakiilku wuxuu rabaa inuu fuliyo amar: LACAG-BIXIN. Waxay u baahan tahay Windows Hello ama PIN-kaaga. Ma oggol tahay?
> 🔊 Wakiilku wuxuu sheegay: Ma bixin lacagta. (0 oggolaaday, 1 la diiday, 0 akhris fudud)

Faylasha kadib: `Archive, duugan.tmp, warbixin.txt | Archive: invoice.pdf`

_Amarka lacag-bixinta wuxuu u baahday Windows Hello/PIN (xaqiijin xooggan) iyo "haa"; waa la diiday, wax lama fulin._
