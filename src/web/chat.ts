/**
 * A card's conversation on this machine, for the card view: what the hub keeps (its copy,
 * #0018), and while this tab sends a message, the reply as it streams in.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChatDto, ChatMessageDto, ChatSummaryResponse } from "../core/api.ts";
import { api, type ChatContext } from "./api.ts";
import { useHub } from "./hub.tsx";

/** What this tab's message has brought so far, until the run ends and the copy is read again. */
export interface LiveReply {
  /** Messages the hub saved for this send (yours, and its own lines). */
  saved: ChatMessageDto[];
  /** The agent's reply so far, block by block. */
  text: string[];
  /** What the agent is doing now ("Reading src/http.ts"). */
  activity: string | undefined;
}

export interface CardChat {
  /** Undefined until loaded. */
  chat: ChatDto | undefined;
  /** Set while this tab's message is being answered. */
  live: LiveReply | undefined;
  /** Sends a message; resolves with an error message when it couldn't be sent or failed. */
  send: (text: string, context: ChatContext) => Promise<string | undefined>;
  summarize: (context: ChatContext) => Promise<ChatSummaryResponse>;
}

export function useCardChat(project: string, id: string): CardChat {
  const hub = useHub();
  const [chat, setChat] = useState<ChatDto>();
  const [live, setLive] = useState<LiveReply>();
  const sending = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const version = (hub.chatVersions[`${project}/${id}`] ?? 0) + hub.reconnects;

  const load = useCallback(async () => {
    try {
      setChat(await api.chat(project, id));
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
    async (text: string, context: ChatContext): Promise<string | undefined> => {
      if (sending.current) return "The agent is still answering.";
      sending.current = true;
      const controller = new AbortController();
      abort.current = controller;
      let reply: LiveReply = { saved: [], text: [], activity: undefined };
      setLive(reply);
      let failure: string | undefined;
      try {
        for await (const event of api.sendChat(
          project,
          id,
          { text, ...context },
          controller.signal,
        )) {
          if (event.type === "message")
            reply = { ...reply, saved: [...reply.saved, event.message] };
          else if (event.type === "text")
            reply = { ...reply, text: [...reply.text, event.text], activity: undefined };
          else if (event.type === "activity") reply = { ...reply, activity: event.text };
          else if (event.type === "error") failure = `No reply: ${event.error}`;
          setLive(reply);
        }
      } catch (error) {
        if (controller.signal.aborted) return undefined;
        failure = (error as Error).message;
      } finally {
        sending.current = false;
        abort.current = null;
      }
      await load();
      setLive(undefined);
      return failure;
    },
    [project, id, load],
  );

  const summarize = useCallback(
    (context: ChatContext) => api.summarize(project, id, context),
    [project, id],
  );

  return { chat, live, send, summarize };
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
