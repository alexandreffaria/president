/**
 * A card's conversation on this machine, for the card view: what the hub keeps (its copy,
 * #0018), and while this tab sends a message, the reply as it streams in.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChatAsk, ChatDto, ChatMessageDto, ChatSummaryResponse } from "../core/api.ts";
import { api, type ChatContext, RequestError } from "./api.ts";
import { useHub } from "./hub.tsx";

/** What this tab's message has brought so far, until the run ends and the copy is read again. */
export interface LiveReply {
  /** Messages the hub saved for this send (yours, and its own lines). */
  saved: ChatMessageDto[];
  /** The agent's reply so far, block by block. */
  text: string[];
  /** What the agent is doing now ("Reading src/http.ts"). */
  activity: string | undefined;
  /**
   * The stream broke after the hub accepted the message, and the hub couldn't be read since:
   * what arrived stays on screen until the hub's copy can be read again (on reconnect).
   */
  lost?: boolean;
}

/** Why a message got no reply here. */
export interface SendFailure {
  error: string;
  /** The hub refused it before saving it: the text goes back in the message box. */
  notSent: boolean;
}

export interface CardChat {
  /** Undefined until loaded. */
  chat: ChatDto | undefined;
  /** Set while this tab's message is being answered (and after its stream broke). */
  live: LiveReply | undefined;
  /**
   * Sends a message, or a panel button's request (Teach me, More info); resolves with what
   * went wrong when it couldn't be sent or failed.
   */
  send: (
    message: string | { ask: ChatAsk },
    context: ChatContext,
  ) => Promise<SendFailure | undefined>;
  summarize: (context: ChatContext) => Promise<ChatSummaryResponse>;
  /**
   * Ends the conversation without a summary (202611111ky9); throws when refused. Resolves
   * with what `reopen` takes to undo it.
   */
  close: () => Promise<string>;
  /** Undoes a `close`: the conversation is "not summarized" again as it was before. */
  reopen: (closed: string) => Promise<void>;
}

export const LOST_CONNECTION =
  "Lost the connection to president; the reply will show when it's back.";

export function useCardChat(project: string, id: string): CardChat {
  const hub = useHub();
  const [chat, setChat] = useState<ChatDto>();
  const [live, setLive] = useState<LiveReply>();
  const sending = useRef(false);
  /** Bumped by every send: a read of the copy started before it is out of date. */
  const sends = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const version = (hub.chatVersions[`${project}/${id}`] ?? 0) + hub.reconnects;

  const load = useCallback(async () => {
    const before = sends.current;
    try {
      const copy = await api.chat(project, id);
      // A send started meanwhile: this copy may already hold its "you" message, which the
      // send shows itself (twice otherwise); the send reads the copy again when it ends.
      if (sending.current || sends.current !== before) return;
      setChat(copy);
      // A reply whose stream broke is in the copy now.
      setLive(undefined);
    } catch {
      // The card view shows the card's own load errors; the panel just stays as it was.
    }
  }, [project, id]);

  // While this tab's reply streams in, its events already show what the hub saves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refetch trigger
  useEffect(() => {
    if (!sending.current) void load();
  }, [load, version]);

  // Leaving the card stops reading the stream; the run goes on and its reply is saved.
  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (
      message: string | { ask: ChatAsk },
      context: ChatContext,
    ): Promise<SendFailure | undefined> => {
      if (sending.current) return { error: "The agent is still answering.", notSent: true };
      sending.current = true;
      sends.current++;
      const controller = new AbortController();
      abort.current = controller;
      let reply: LiveReply = { saved: [], text: [], activity: undefined };
      setLive(reply);
      let failure: SendFailure | undefined;
      try {
        for await (const event of api.sendChat(
          project,
          id,
          { ...(typeof message === "string" ? { text: message } : message), ...context },
          controller.signal,
        )) {
          if (event.type === "message")
            reply = { ...reply, saved: [...reply.saved, event.message] };
          else if (event.type === "text")
            reply = { ...reply, text: [...reply.text, event.text], activity: undefined };
          else if (event.type === "activity") reply = { ...reply, activity: event.text };
          else if (event.type === "error")
            failure = { error: `No reply: ${event.error}`, notSent: false };
          setLive(reply);
        }
      } catch (error) {
        if (controller.signal.aborted) return undefined;
        failure =
          error instanceof RequestError
            ? { error: error.message, notSent: true }
            : { error: LOST_CONNECTION, notSent: false };
      } finally {
        sending.current = false;
        abort.current = null;
      }
      try {
        const copy = await api.chat(project, id);
        // Both at once, so the reply never shows twice or not at all in between.
        setChat(copy);
        setLive(undefined);
      } catch {
        // The hub is out of reach: keep what arrived on screen; the reconnect reads the copy.
        setLive(failure?.notSent ? undefined : { ...reply, activity: undefined, lost: true });
      }
      return failure;
    },
    [project, id],
  );

  const summarize = useCallback(
    (context: ChatContext) => api.summarize(project, id, context),
    [project, id],
  );

  const close = useCallback(async () => {
    const res = await api.closeChat(project, id);
    setChat(res.chat);
    return res.closed;
  }, [project, id]);

  const reopen = useCallback(
    async (closed: string) => {
      setChat(await api.reopenChat(project, id, closed));
    },
    [project, id],
  );

  return { chat, live, send, summarize, close, reopen };
}

/** Whether the window is at least `px` wide, following resizes. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false);
}
