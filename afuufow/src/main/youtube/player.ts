import { BrowserWindow, shell } from 'electron';
import type { YouTubeController, YtCandidate, YtPlayback } from '../../core/platform';
import { sleep, throwIfAborted } from '../../core/util';
import { searchYouTube } from './search';

const STATE_JS = `(() => {
  const v = document.querySelector('video');
  const p = document.querySelector('.html5-video-player');
  return {
    has: !!v,
    paused: v ? v.paused : true,
    ended: v ? v.ended : false,
    position: v ? v.currentTime : 0,
    volume: v ? v.volume : 1,
    ready: v ? v.readyState : 0,
    ad: !!(p && p.classList.contains('ad-showing')),
    title: (document.querySelector('h1.ytd-watch-metadata, #title h1, h1.title') || {}).textContent || document.title.replace(/ - YouTube$/, ''),
    consent: location.hostname.startsWith('consent.') || !!document.querySelector('form[action*="consent"]'),
  };
})()`;

interface PageState {
  has: boolean;
  paused: boolean;
  ended: boolean;
  position: number;
  volume: number;
  ready: number;
  ad: boolean;
  title: string;
  consent: boolean;
}

/**
 * Plays YouTube in an app-owned window so playback can be verified from the page itself (the <video> element), instead of
 * guessing after handing a URL to an external browser. The window uses its own persistent profile.
 */
export class YouTubePlayer implements YouTubeController {
  private win: BrowserWindow | null = null;
  constructor(
    private getKey: () => string | null,
    private mode: () => 'app' | 'browser',
    private useApi: () => boolean,
  ) {}

  search(query: string, kind: 'song' | 'video' | 'any', signal?: AbortSignal): Promise<YtCandidate[]> {
    return searchYouTube(query, kind, signal, fetch, this.useApi() ? this.getKey() : null);
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const w = new BrowserWindow({
      width: 960,
      height: 600,
      title: 'Afuufow — YouTube',
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:youtube', autoplayPolicy: 'no-user-gesture-required', sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    w.webContents.setUserAgent(w.webContents.getUserAgent().replace(/\s?Electron\/\S+/, ''));
    w.on('closed', () => (this.win = null));
    this.win = w;
    return w;
  }

  private async state(): Promise<PageState | null> {
    if (!this.win || this.win.isDestroyed()) return null;
    try {
      return (await this.win.webContents.executeJavaScript(STATE_JS)) as PageState;
    } catch {
      return null;
    }
  }

  private toPlayback(s: PageState): YtPlayback {
    return { playing: s.has && !s.paused && !s.ended && s.ready >= 3, paused: s.paused, adShowing: s.ad, title: String(s.title ?? '').trim(), position: s.position, volume: s.volume };
  }

  async play(videoId: string, signal?: AbortSignal): Promise<YtPlayback> {
    const url = `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;
    if (this.mode() === 'browser') {
      await shell.openExternal(url);
      return { playing: false, paused: false, adShowing: false, title: '', position: 0, volume: 1 }; // cannot observe an external browser
    }
    const w = this.ensure();
    if (!w.isVisible()) w.show();
    await w.loadURL(url);
    // verify: wait until the video element is really advancing
    const deadline = Date.now() + 15_000;
    let last: PageState | null = null;
    let firstPos = -1;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const s = await this.state();
      if (s) {
        last = s;
        if (s.consent) {
          w.show();
          break; // needs the owner to press "Accept" once
        }
        if (s.has && s.ad) return this.toPlayback(s);
        if (s.has && s.paused) await w.webContents.executeJavaScript(`document.querySelector('video').play().catch(()=>{})`).catch(() => undefined);
        if (s.has && !s.paused && s.ready >= 3) {
          if (firstPos < 0) firstPos = s.position;
          else if (s.position > firstPos + 0.8) return this.toPlayback(s);
        }
      }
      await sleep(400, signal);
    }
    return last ? { ...this.toPlayback(last), playing: false } : { playing: false, paused: true, adShowing: false, title: '', position: 0, volume: 1 };
  }

  async status(): Promise<YtPlayback | null> {
    const s = await this.state();
    return s && s.has ? this.toPlayback(s) : null;
  }

  async control(action: 'pause' | 'resume' | 'volumeUp' | 'volumeDown' | 'setVolume' | 'next' | 'stop', arg?: number): Promise<YtPlayback | null> {
    if (!this.win || this.win.isDestroyed()) return null;
    const js: Record<string, string> = {
      pause: `document.querySelector('video').pause()`,
      resume: `document.querySelector('video').play()`,
      volumeUp: `(v=>{v.volume=Math.min(1,v.volume+0.1)})(document.querySelector('video'))`,
      volumeDown: `(v=>{v.volume=Math.max(0,v.volume-0.1)})(document.querySelector('video'))`,
      setVolume: `(v=>{v.volume=${Math.max(0, Math.min(1, (arg ?? 50) / 100))}})(document.querySelector('video'))`,
      next: `document.querySelector('.ytp-next-button')?.click()`,
      stop: `(v=>{v.pause();v.currentTime=0})(document.querySelector('video'))`,
    };
    try {
      await this.win.webContents.executeJavaScript(js[action]!);
    } catch {
      return null;
    }
    await sleep(350);
    const s = await this.state();
    return s ? this.toPlayback(s) : null;
  }
}
