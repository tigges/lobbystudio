import css from "./styles.css";

type Source = { page: string; slug: string; heading: string; anchor: string; chunkId: number };
type Message = {
  id?: number;
  role: "visitor" | "bot" | "staff" | "system";
  kind: string;
  text: string;
  sources: Source[];
  options: string[];
  feedback: number | null;
  authorName: string | null;
};
type Session = {
  conversationId: string;
  versionNumber: number;
  status: string;
  practice: { name: string; phone: string };
  messages: Message[];
};

const script = document.currentScript as HTMLScriptElement | null;
const BASE = script ? new URL(script.src).origin : location.origin;
const TENANT = script?.dataset.tenant ?? "default";
const ACCENT = script?.dataset.accent;
const STORE = `dental-bot:${TENANT}`;
const POLL_MS = 4000;
const RATEABLE = new Set(["answer", "fallback", "cannot_handle", "handover"]);

const ICON_CHAT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ICON_UP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H3V10h4zm0 0 4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7"/></svg>';
const ICON_DOWN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h4v11h-4zm0 0-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.9 3H17"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function visitorId(): string {
  const key = `${STORE}:visitor`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function sourceHref(s: Source) {
  return `${BASE}/${s.slug === "contact" ? "" : s.slug}#${s.anchor}`;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

class Widget {
  private root: ShadowRoot;
  private panel!: HTMLDivElement;
  private log!: HTMLDivElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private banner!: HTMLDivElement;
  private versionEl!: HTMLSpanElement;
  private titleEl!: HTMLElement;
  private launcher!: HTMLButtonElement;
  private stars!: HTMLDivElement;
  private session: Session | null = null;
  private busy = false;
  private lastId = 0;
  private pollTimer: number | null = null;

  constructor() {
    const host = el("div", { id: "dental-bot-widget" });
    document.body.appendChild(host);
    this.root = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = css + (ACCENT ? `:host{--accent:${ACCENT}}` : "");
    this.root.appendChild(style);
    this.buildLauncher();
    this.buildPanel();
    if (sessionStorage.getItem(`${STORE}:open`) === "1") void this.open();
  }

  private buildLauncher() {
    this.launcher = el("button", { class: "launcher", "aria-label": "Open chat" });
    this.launcher.innerHTML = `${ICON_CHAT}<span>Ask us</span>`;
    this.launcher.addEventListener("click", () => void this.open());
    this.root.appendChild(this.launcher);
  }

  private buildPanel() {
    this.panel = el("div", { class: "panel", role: "dialog", "aria-label": "Chat with the practice" }) as HTMLDivElement;
    this.panel.hidden = true;

    const header = el("div", { class: "header" });
    const avatar = el("div", { class: "avatar" }, "");
    const title = el("div", { class: "title" });
    this.titleEl = el("strong", {}, "Chat");
    title.append(this.titleEl, el("span", {}, "Answers from our website"));
    this.versionEl = el("span", { class: "version", title: "Serving version" }, "v–");
    const close = el("button", { class: "icon-btn", "aria-label": "Close chat" }, "×");
    close.addEventListener("click", () => this.close());
    header.append(avatar, title, this.versionEl, close);

    this.banner = el("div", { class: "banner" }) as HTMLDivElement;
    this.banner.hidden = true;
    this.log = el("div", { class: "log", "aria-live": "polite" }) as HTMLDivElement;

    const exits = el("div", { class: "exits" });
    const book = el("button", { class: "chip" }, "Book a check-up");
    book.addEventListener("click", () => void this.send({ action: "book" }));
    const talk = el("button", { class: "chip" }, "Talk to the practice");
    talk.addEventListener("click", () => void this.send({ action: "handover" }));
    exits.append(book, talk);

    const composer = el("form", { class: "composer" });
    this.input = el("textarea", { rows: "1", placeholder: "Type your question…", "aria-label": "Message" });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        composer.requestSubmit();
      }
    });
    this.sendBtn = el("button", { class: "send", type: "submit", "aria-label": "Send" });
    this.sendBtn.innerHTML = ICON_SEND;
    composer.append(this.input, this.sendBtn);
    composer.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.input.value = "";
      void this.send({ text });
    });

    const footer = el("div", { class: "footer" });
    footer.append(el("span", {}, "Demo practice · not medical advice"));
    this.stars = el("div", { class: "stars", "aria-label": "Rate this chat" }) as HTMLDivElement;
    this.stars.append(el("span", {}, "Rate chat"));
    for (let i = 1; i <= 5; i++) {
      const star = el("button", { class: "star", "aria-label": `${i} star${i > 1 ? "s" : ""}` }, "★");
      star.addEventListener("click", () => void this.rate(i));
      this.stars.append(star);
    }
    footer.append(this.stars);

    this.panel.append(header, this.banner, this.log, exits, composer, footer);
    this.root.appendChild(this.panel);
  }

  async open(opts: { action?: "book" } = {}) {
    this.panel.hidden = false;
    this.launcher.hidden = true;
    sessionStorage.setItem(`${STORE}:open`, "1");
    if (!this.session) await this.start();
    if (opts.action) await this.send({ action: opts.action });
    this.input.focus();
  }

  close() {
    this.panel.hidden = true;
    this.launcher.hidden = false;
    sessionStorage.removeItem(`${STORE}:open`);
  }

  private async start() {
    try {
      this.session = await api<Session>("/api/session", {
        tenant: TENANT,
        visitorId: visitorId(),
        conversationId: localStorage.getItem(`${STORE}:conversation`),
      });
    } catch {
      this.renderMessage({ role: "system", kind: "error", text: "The chat is unavailable right now. Please phone the practice.", sources: [], options: [], feedback: null, authorName: null });
      return;
    }
    localStorage.setItem(`${STORE}:conversation`, this.session.conversationId);
    this.titleEl.textContent = this.session.practice.name;
    (this.root.querySelector(".avatar") as HTMLElement).textContent = this.session.practice.name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2);
    this.versionEl.textContent = `v${this.session.versionNumber}`;
    this.log.replaceChildren();
    for (const m of this.session.messages) this.renderMessage(m);
    this.setStatus(this.session.status);
  }

  private setStatus(status: string) {
    if (!this.session) return;
    this.session.status = status;
    const handed = status === "handed_over";
    this.banner.hidden = !handed;
    this.banner.textContent = handed ? `You're talking to the ${this.session.practice.name} team. They'll reply here.` : "";
    if (handed && this.pollTimer === null) this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
    if (!handed && this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll() {
    if (!this.session || this.busy) return;
    try {
      const res = await api<{ status: string; messages: Message[] }>(
        `/api/conversations/${this.session.conversationId}/messages?tenant=${encodeURIComponent(TENANT)}&after=${this.lastId}`,
      );
      for (const m of res.messages) if (m.role !== "visitor") this.renderMessage(m);
      if (res.messages.length) this.lastId = Math.max(this.lastId, ...res.messages.map((m) => m.id ?? 0));
      this.setStatus(res.status);
    } catch {
      /* transient; next poll retries */
    }
  }

  private renderMessage(m: Message): { row: HTMLDivElement; bubble: HTMLDivElement } {
    if (m.id) this.lastId = Math.max(this.lastId, m.id);
    const row = el("div", { class: `row ${m.role}` }) as HTMLDivElement;
    if (m.role === "staff") row.append(el("div", { class: "author" }, `${m.authorName ?? "Practice team"} · ${this.session?.practice.name ?? ""}`));
    const bubble = el("div", { class: "bubble" }, m.text) as HTMLDivElement;
    row.append(bubble);
    this.log.append(row);
    if (m.role === "bot") this.decorate(row, m);
    this.scroll();
    return { row, bubble };
  }

  private decorate(row: HTMLDivElement, m: Message) {
    row.querySelector(".meta")?.remove();
    row.querySelector(".options")?.remove();
    if (m.options.length) {
      const opts = el("div", { class: "options" });
      for (const o of m.options) {
        const chip = el("button", { class: "chip" }, o);
        chip.addEventListener("click", () => {
          opts.querySelectorAll("button").forEach((b) => ((b as HTMLButtonElement).disabled = true));
          void this.send({ text: o });
        });
        opts.append(chip);
      }
      row.append(opts);
    }
    const meta = el("div", { class: "meta" });
    const byPage = new Map<string, Source[]>();
    for (const s of m.sources) byPage.set(s.slug, [...(byPage.get(s.slug) ?? []), s]);
    for (const group of byPage.values()) {
      const first = group[0]!;
      const a = el("a", { class: "source", href: sourceHref(first), target: "_top" }, `Source: ${first.page}`);
      a.title = group.map((s) => s.heading).join(" · ");
      meta.append(a);
    }
    if (m.id && RATEABLE.has(m.kind)) {
      for (const [value, icon, label] of [
        [1, ICON_UP, "Helpful"],
        [-1, ICON_DOWN, "Not helpful"],
      ] as const) {
        const b = el("button", { class: "thumb", "aria-label": label, "aria-pressed": String(m.feedback === value) });
        b.innerHTML = icon;
        b.addEventListener("click", () => {
          const next = m.feedback === value ? 0 : value;
          m.feedback = next === 0 ? null : next;
          meta.querySelectorAll(".thumb").forEach((t, i) => t.setAttribute("aria-pressed", String(m.feedback === (i === 0 ? 1 : -1))));
          void api("/api/feedback", { tenant: TENANT, conversationId: this.session!.conversationId, messageId: m.id, value: next });
        });
        meta.append(b);
      }
    }
    if (meta.childElementCount) row.append(meta);
    this.scroll();
  }

  private scroll() {
    this.log.scrollTop = this.log.scrollHeight;
  }

  private async rate(n: number) {
    if (!this.session) return;
    this.stars.querySelectorAll(".star").forEach((s, i) => s.classList.toggle("on", i < n));
    (this.stars.firstChild as HTMLElement).textContent = "Thanks";
    await api("/api/feedback", { tenant: TENANT, conversationId: this.session.conversationId, rating: n }).catch(() => {});
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.sendBtn.disabled = busy;
  }

  async send(input: { text?: string; action?: "book" | "handover" }) {
    if (!this.session) await this.start();
    if (!this.session || this.busy) return;
    this.setBusy(true);
    const label = input.text ?? (input.action === "book" ? "Book a check-up" : "Talk to the practice");
    this.renderMessage({ role: "visitor", kind: "text", text: label, sources: [], options: [], feedback: null, authorName: null });

    const segments = new Map<string, { row: HTMLDivElement; bubble: HTMLDivElement; message: Message }>();
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ tenant: TENANT, conversationId: this.session.conversationId, ...input }),
      });
      if (!res.ok || !res.body) throw new Error(`${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!event || !data) continue;
          this.handleEvent(event, JSON.parse(data), segments);
        }
      }
    } catch {
      this.renderMessage({
        role: "bot",
        kind: "error",
        text: `Sorry, something went wrong. Please call us on ${this.session.practice.phone}.`,
        sources: [],
        options: [],
        feedback: null,
        authorName: null,
      });
    } finally {
      for (const s of segments.values()) s.bubble.classList.remove("streaming");
      this.setBusy(false);
    }
  }

  private handleEvent(
    event: string,
    data: any,
    segments: Map<string, { row: HTMLDivElement; bubble: HTMLDivElement; message: Message }>,
  ) {
    if (event === "segment_start") {
      const message: Message = { role: "bot", kind: data.kind, text: "", sources: [], options: [], feedback: null, authorName: null };
      const { row, bubble } = this.renderMessage(message);
      bubble.classList.add("streaming");
      segments.set(data.id, { row, bubble, message });
    } else if (event === "delta") {
      const s = segments.get(data.id);
      if (!s) return;
      s.message.text += data.text;
      s.bubble.textContent = s.message.text;
      this.scroll();
    } else if (event === "segment_end") {
      const s = segments.get(data.id);
      if (!s) return;
      s.bubble.classList.remove("streaming");
      s.message.sources = data.sources;
      s.message.options = data.options;
      this.decorate(s.row, s.message);
    } else if (event === "done") {
      for (const { segmentId, messageId } of data.messages as { segmentId: string; messageId: number }[]) {
        const s = segments.get(segmentId);
        if (!s) continue;
        s.message.id = messageId;
        this.lastId = Math.max(this.lastId, messageId);
        this.decorate(s.row, s.message);
      }
      this.setStatus(data.status);
    } else if (event === "error") {
      throw new Error(data.message ?? "error");
    }
  }
}

declare global {
  interface Window {
    DentalBot?: { open: (opts?: { action?: "book" }) => void };
  }
}

function boot() {
  const widget = new Widget();
  window.DentalBot = { open: (opts) => void widget.open(opts) };
  document.dispatchEvent(new CustomEvent("dental-bot:ready"));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
