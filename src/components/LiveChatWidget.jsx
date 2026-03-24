import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "../apiConfig";

function nextId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Floating live chat: Socket.IO ↔ Telegram (admin replies via Telegram "Reply").
 */
const LiveChatWidget = forwardRef(function LiveChatWidget({ role, name = "", phone = "" }, ref) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState(() => [
    {
      id: "welcome",
      from: "admin",
      text: "Hi there! 👋 How can we help you today?",
      ts: Date.now(),
    },
  ]);
  const [conn, setConn] = useState("connecting");
  const [sendBusy, setSendBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  const socketRef = useRef(null);
  const listRef = useRef(null);
  const profileRef = useRef({ role, name, phone });
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    openChatPanel() {
      setOpen(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          inputRef.current?.focus();
        });
      });
    },
  }));

  useEffect(() => {
    profileRef.current = { role, name, phone };
  }, [role, name, phone]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, open, scrollToBottom]);

  useEffect(() => {
    const url = getSocketUrl();
    const socket = io(url, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1200,
      reconnectionDelayMax: 12000,
    });
    socketRef.current = socket;

    const onConnect = () => {
      setConn("connected");
      setBanner(null);
    };
    const onDisconnect = () => {
      setConn("disconnected");
      setSendBusy(false);
      setBanner("You’re offline — we’ll reconnect automatically.");
    };
    const onConnectError = () => {
      setConn("disconnected");
      setSendBusy(false);
      setBanner("Can’t reach chat server. Retrying…");
    };

    const onAdminReply = (text) => {
      const t = String(text || "").trim();
      if (!t) return;
      setMessages((prev) => [...prev, { id: nextId(), from: "admin", text: t, ts: Date.now() }]);
    };

    const onChatError = (payload) => {
      setSendBusy(false);
      const msg = typeof payload?.message === "string" ? payload.message : "Message could not be sent.";
      setBanner(msg);
    };

    const onChatDelivered = () => {
      setSendBusy(false);
      setBanner(null);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("admin_reply", onAdminReply);
    socket.on("chat_error", onChatError);
    socket.on("chat_delivered", onChatDelivered);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("admin_reply", onAdminReply);
      socket.off("chat_error", onChatError);
      socket.off("chat_delivered", onChatDelivered);
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
  }, []);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sendBusy) return;
    const sock = socketRef.current;
    if (!sock || !sock.connected) {
      setBanner("Not connected yet. Wait a moment or refresh the page.");
      return;
    }

    const { role: r, name: n, phone: p } = profileRef.current;
    const userBubble = { id: nextId(), from: "user", text, ts: Date.now() };
    setMessages((prev) => [...prev, userBubble]);
    setDraft("");
    setSendBusy(true);
    window.setTimeout(() => setSendBusy(false), 25000);
    sock.emit("user_message", {
      role: String(r || "User"),
      name: String(n || "Guest").trim() || "Guest",
      phone: String(p || "").trim(),
      text,
    });
  }

  return (
    <div
      className="pointer-events-none fixed bottom-0 right-0 z-[10050] flex flex-col items-end gap-2 p-3 sm:p-4 text-left"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      {open ? (
        <div
          ref={panelRef}
          id="vyaharam-live-chat-panel"
          tabIndex={-1}
          className="pointer-events-auto flex max-h-[min(100dvh-5.5rem,32rem)] w-[min(calc(100vw-1.5rem),22rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl sm:w-[24rem]"
          role="dialog"
          aria-modal="true"
          aria-label="VYAHARAM live support chat"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-red-600 to-red-500 px-3 py-2.5 text-white sm:px-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold tracking-tight sm:text-base">VYAHARAM Live Support</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-red-50">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${conn === "connected" ? "animate-pulse bg-emerald-400" : "bg-amber-300"}`}
                  aria-hidden
                />
                {conn === "connected" ? "Online" : conn === "connecting" ? "Connecting…" : "Reconnecting…"}
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg bg-white/15 px-2.5 py-1 text-sm font-bold text-white transition hover:bg-white/25"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              ✕
            </button>
          </header>

          {banner ? (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 sm:text-sm">
              {banner}
            </div>
          ) : null}

          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-3 sm:px-4"
            style={{ maxHeight: "min(52vh, 22rem)" }}
          >
            {messages.map((m) =>
              m.from === "admin" ? (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm leading-snug text-slate-800 shadow-sm ring-1 ring-slate-200/80">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[92%] rounded-2xl rounded-br-md bg-gradient-to-br from-red-600 to-red-500 px-3 py-2 text-sm leading-snug font-medium text-white shadow-md">
                    {m.text}
                  </div>
                </div>
              ),
            )}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white p-2 sm:p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Type a message…"
                maxLength={3800}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-red-500/30 placeholder:text-slate-400 focus:border-red-400 focus:bg-white focus:ring-2"
                disabled={sendBusy}
                aria-label="Message"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sendBusy || !draft.trim()}
                className="shrink-0 rounded-xl bg-gradient-to-br from-red-600 to-red-500 px-3 py-2 text-sm font-extrabold text-white shadow-md transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-red-500 text-2xl text-white shadow-xl ring-4 ring-red-500/25 transition hover:scale-105 hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400 sm:h-16 sm:w-16"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close live support" : "Open live support"}
        aria-expanded={open}
        aria-controls={open ? "vyaharam-live-chat-panel" : undefined}
      >
        <span className="relative flex h-10 w-10 items-center justify-center sm:h-11 sm:w-11">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/40 opacity-40" aria-hidden />
          <span className="relative text-[1.35rem] sm:text-[1.5rem]" aria-hidden>
            💬
          </span>
        </span>
      </button>
    </div>
  );
});

LiveChatWidget.displayName = "LiveChatWidget";

export default LiveChatWidget;
