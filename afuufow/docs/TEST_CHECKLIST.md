# Manual test checklist (run on a real Windows 10/11 machine)

Tick each box; write down what you saw. "Expected" is the pass condition. Tests marked ☁ need your Azure key.

## A. Install / lifecycle
- [ ] Install, launch from Start menu; tray icon appears. *Expected:* setup wizard on first run.
- [ ] Close the window. *Expected:* tray icon stays; Task Manager shows Afuufow still running.
- [ ] Turn on *Start after I sign in*, sign out and in. *Expected:* Afuufow starts hidden in the tray (no window) and listening/camera states match your last settings.
- [ ] Task Manager → end the Afuufow main process while in use. *Expected:* nothing else breaks; start again from the Start menu (a crash inside the app triggers an automatic relaunch after repeated errors).
- [ ] Uninstall. *Expected:* Start-menu entry, Add/Remove entry and startup entry gone; the data-deletion question appears.

## B. Greeting and personality ☁
- [ ] Say "Afuufow". *Expected:* exactly "Mudane Hassan Mohamed, Boss Hassan XR, waan taaganahay." in a clear male Somali voice.
- [ ] Say "Afuufow" again within 10 minutes. *Expected:* no repeated greeting.
- [ ] Say "Fariiso." *Expected:* "Waan fadhiistay Boss. Maxaan qabtaa? Shaqo ii dir."
- [ ] While it is speaking say "Aamus" / "Jooji" / "Sug". *Expected:* speech stops at once.

## C. Voice quality (record your own results)
- [ ] 20 Somali commands, 20 mixed Somali–English commands in your normal room, then with music/TV on. Note how many were understood and the delay. *Expected:* honest numbers; failures give a Somali clarification, not a wrong action.
- [ ] Speak while it speaks. *Expected:* it does not react to its own voice; a real "Jooji" interrupts.
- [ ] Unplug the microphone / block it in Privacy settings / disconnect the internet. *Expected:* a clear Somali message each time; typed commands still work.

## D. Automation
- [ ] "Chrome fur", "Notepad fur", "Downloads-ka fur". *Expected:* opens; the action log says *verified*. Try an app that is not installed → "ma helin".
- [ ] "Ii raadi file-ka <a file in Documents>". *Expected:* names listed; nothing outside approved folders.
- [ ] "Google-ka ka raadi …". *Expected:* results page; log says *unverified* (external browser).
- [ ] "Gal YouTube oo ii shid heesta <song>". *Expected:* plays in the Afuufow window; "Jooji muuqaalka" pauses, "Sii wad" resumes, "Codka hoos u dhig" lowers Windows volume by 10 %.
- [ ] Ambiguous song name. *Expected:* a short question with options.
- [ ] "Screenshot qaad". *Expected:* PNG in Pictures\Afuufow. "Shaashadda akhri" with a text window in front reads it.
- [ ] "Ii qor email English ah oo ku saabsan kulan berri", then "ku dheji" with a mail window focused. *Expected:* draft on screen/clipboard; paste either verified or honestly "unverified".
- [ ] Start a slow action and say "Jooji" / press the Cancel button / Ctrl+Alt+Esc. *Expected:* log status *cancelled*; no success message.

## E. WhatsApp
- [ ] Settings → Integrations → Open WhatsApp, scan QR. Status test says ready.
- [ ] Add two contacts "Ahmed Ali", "Ahmed Jama" (+ one unapproved). "Ahmed u dir fariintan: test". *Expected:* it asks which Ahmed; answer "midka labaad"; the message appears in the right chat; the result says *sent* (not "delivered") until the phone receives it.
- [ ] "Ahmed Ali u qor: test, ha dirin". *Expected:* text in the box, not sent.
- [ ] "Ahmed Ali u dir test, ii akhri ka hor intaadan dirin". *Expected:* it reads it, you say "haa", it sends.
- [ ] Enable fast-send for one contact and *Fast* mode: "u qor …" sends at once; revoke it: it asks again.
- [ ] Say a name that is not a contact. *Expected:* refusal, nothing sent. Repeat the same text within a minute: it asks before sending again.
- [ ] Log out of WhatsApp Web in the app. *Expected:* a QR message, nothing sent.

## F. Face and visitors
- [ ] Enroll your face in dim light and bright light. *Expected:* hints; progress reaches 10.
- [ ] Turn the camera on and sit down. *Expected:* greeting once; leave for the configured time and return: greeting only after the cool-down.
- [ ] Hold up a photo of yourself. *Expected:* "looks like a photo", no greeting (a video replay is not stopped: known limit).
- [ ] Cover half the lens / poor light. *Expected:* "uncertain" notice, no greeting, no visitor questions.
- [ ] Turn the camera off. *Expected:* the Windows camera light goes out immediately; tray says Off.
- [ ] Let another person sit down (owner absent) with visitor questions on. *Expected:* the fixed intro and the consent notice, then it listens; their answer appears under Visitors as *self-reported*; commands from them are ignored.
- [ ] Repeat but the visitor says "ma doonayo". *Expected:* recorded as declined, no transcript, not asked again.
- [ ] Come back and look at the camera. *Expected:* it reports the visit only after recognising you (and does not read details aloud if someone else is visible). Lock/unlock Windows beforehand: the unlock appears in the separate Windows list.
- [ ] Visitors: add a note, mark as known and enroll their face separately, delete the event (snapshot gone).

## G. Memory and privacy
- [ ] Add a fact, close and reopen Afuufow. *Expected:* it persists. Export, correct, delete.
- [ ] Retention 0 days for conversation: history is not kept.
- [ ] Privacy → everything off: confirm no cloud use (Azure test says "disabled").
- [ ] Delete all my data. *Expected:* app restarts as new.

## H. Sensitive actions
- [ ] With a PIN set, ask for an action planned by the AI that deletes a file in an approved folder ("tir tir file-ka …"). *Expected:* PIN prompt, then a yes/no; the file goes to the Recycle Bin. Without the PIN nothing happens.
- [ ] Ask it to pay/disable Defender/run a command. *Expected:* refused and logged.

## I. Task agent (Open Interpreter)
- [ ] Agent page → install the engine. *Expected:* progress bar, "Installed v0.0.56". (A wrong hash must abort: do not edit the pinned hash to test this.)
- [ ] Enter the API key, allow cloud AI, enable, press **Test**. *Expected:* OK with a one-word answer. With a wrong key: a clear "key rejected" message, not success.
- [ ] Say/type "wakiilka: tus faylasha galka shaqada". *Expected:* it runs without a question (read-only listing in an approved folder) and answers in Somali, prefixed "Wakiilku wuxuu sheegay".
- [ ] "wakiilka: u guur [fayl] galka Archive". *Expected:* the exact command is shown, you are asked; "haa" moves the file; check in Explorer.
- [ ] "wakiilka: tirtir [fayl]". *Expected:* question names DELETING; "maya" keeps the file; "haa" deletes it. A folder or a file outside approved folders needs Hello/PIN first.
- [ ] "wakiilka: bixi biilka …". *Expected:* Hello/PIN required, then a yes; "maya" cancels. Say "jooji" mid-question: it counts as no and the task stops.
- [ ] Say "haa" in a *stranger's* voice (voice ID on): it must not approve.
- [ ] Press **Jooji** during a long task: the engine process disappears from Task Manager within seconds.
