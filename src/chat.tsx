import React, { useEffect, useRef, useState } from "react";
import { ItemContent, Virtuoso, VirtuosoHandle } from "react-virtuoso";
import cn from "clsx";
import { useMutation, useQuery } from "@apollo/client";

import css from "./chat.module.css";
import { MESSAGE_ADDED_SUBSCRIPTION, MESSAGE_UPDATED_SUBSCRIPTION, GET_MESSAGES, SEND_MESSAGE_MUTATION } from "./queries";
import {
  MessageSender,
  MessageStatus,
  type Message,
} from "../__generated__/resolvers-types";


// TODO: generate from schema
type MessageEdgeType = { __typename?: "MessageEdge"; node: Message; cursor: string };
type MessagesQueryData = {
  __typename?: "Query";
  messages: {
    __typename?: "MessagePage";
    edges: MessageEdgeType[];
    pageInfo: {
      __typename?: "MessagePageInfo";
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor?: string | null;
      endCursor?: string | null;
    };
  };
};
type MessageAddedData = { messageAdded: Message };
type MessageUpdatedData = { messageUpdated: Pick<Message, "id" | "status" | "updatedAt"> };

const Item: React.FC<Message> = ({ text, sender, status }) => {
  return (
    // Invert each item back, since we invert the scroller below
    // See: https://github.com/petyosi/react-virtuoso/discussions/1177#discussioncomment-11815508
    <div className={css.item} style={{ transform: "scaleY(-1)" }}>
      <div
        className={cn(
          css.message,
          sender === MessageSender.Admin ? css.out : css.in
        )}
      >
        {status === MessageStatus.Sending && (
          <span className={css.loader} aria-label="Sending" />
        )}
        {sender === MessageSender.Admin && (
          status === MessageStatus.Sent ? (
            <span className={css.status} aria-label="Sent">✓</span>
          ) : status === MessageStatus.Read ? (
            <span className={`${css.status} ${css.read}`} aria-label="Read">✓✓</span>
          ) : null
        )}
        <span>{text}</span>
      </div>
    </div>
  );
};

const getItem: ItemContent<Message, unknown> = (_, data) => {
  return <Item {...data} />;
};


const PAGE_SIZE = 20;

export const Chat: React.FC = () => {
  const { data, subscribeToMore, loading, fetchMore } = useQuery<MessagesQueryData>(
    GET_MESSAGES,
    {
      variables: { first: PAGE_SIZE },
      notifyOnNetworkStatusChange: true,
    }
  );

  useEffect(() => {
    const unsubscribeAdded = subscribeToMore<MessageAddedData>({
      document: MESSAGE_ADDED_SUBSCRIPTION,
      updateQuery: (prev, { subscriptionData }) => {
        if (!subscriptionData.data) return prev;
        const newMessage = subscriptionData.data.messageAdded;
        // Remove temp messages from previously optimistically sent
        const withoutTemps = prev.messages.edges.filter(
          (e: MessageEdgeType) => !(String(e.node.id).startsWith("temp-") && e.node.text === newMessage.text)
        );
        const exists = withoutTemps.some(
          (e: MessageEdgeType) => e.node.id === newMessage.id
        );
        if (exists) {
          return { ...prev, messages: { ...prev.messages, edges: withoutTemps } };
        }
        const newEdge: MessageEdgeType = { __typename: "MessageEdge", node: newMessage, cursor: newMessage.id };

        const edges = [...withoutTemps, newEdge];
        return { // TODO: immer.js
          ...prev,
          messages: {
            ...prev.messages,
            edges,
            pageInfo: {
              ...prev.messages.pageInfo,
              endCursor: newMessage.id,
            },
          },
        };
      },
    });

    const unsubscribeUpdated = subscribeToMore<MessageUpdatedData>({
      document: MESSAGE_UPDATED_SUBSCRIPTION,
      updateQuery: (prev, { subscriptionData }) => {
        if (!subscriptionData.data) return prev;
        const updated = subscriptionData.data.messageUpdated;
        const edges = prev.messages.edges.map((edge: MessageEdgeType) =>
          edge.node.id === updated.id
            ? { // TODO: immer.js
                ...edge,
                node: {
                  ...edge.node,
                  status: updated.status,
                  updatedAt: updated.updatedAt,
                },
              }
            : edge
        );
        return {
          ...prev,
          messages: {
            ...prev.messages,
            edges,
          },
        };
      },
    });

    return () => {
      unsubscribeAdded();
      unsubscribeUpdated();
    };
  }, [subscribeToMore]);

  const [isFetchingMore, setIsFetchingMore] = useState(false);
  // Workaround for virtuoso startReached bug
  // https://github.com/petyosi/react-virtuoso/discussions/1177#discussioncomment-11815508
  const handleEndReached = async () => {
    if (isFetchingMore) return;
    const pageInfo = data?.messages.pageInfo;
    const before = pageInfo?.startCursor;
    if (!pageInfo || !pageInfo.hasPreviousPage || !before) return;
    setIsFetchingMore(true);
    try {
      await fetchMore({
        variables: { before, first: PAGE_SIZE },
      });
    } finally {
      setIsFetchingMore(false);
    }
  };

  const [sendMessage] = useMutation(SEND_MESSAGE_MUTATION, {
    update(cache, { data }) {
      if (!data?.sendMessage) return;
      const real = data.sendMessage;
      cache.updateQuery<MessagesQueryData>({ query: GET_MESSAGES, variables: { first: PAGE_SIZE } }, (prev) => {
        if (!prev?.messages) return prev;
        const withoutTemps = prev.messages.edges.filter(
          (e: MessageEdgeType) => !(String(e.node.id).startsWith("temp-") && e.node.text === real.text)
        );
        const already = withoutTemps.some((e: MessageEdgeType) => e.node.id === real.id);
        const edges = already
          ? withoutTemps
          : [...withoutTemps, { __typename: "MessageEdge", node: real, cursor: real.id } as MessageEdgeType];
        return { // TODO: immer.js
          ...prev,
          messages: {
            ...prev.messages,
            edges,
            pageInfo: {
              ...prev.messages.pageInfo,
              endCursor: real.id,
            },
          },
        };
      });
    },
  });


  const virtuosoHandleRef = useRef<VirtuosoHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('')
  const initialLoading = !data && loading;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Temp id for optimistic update
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const nowIso = new Date().toISOString();
    sendMessage({
      variables: { text: inputValue },
      optimisticResponse: {
        sendMessage: {
          __typename: "Message",
          id: tempId,
          text: inputValue,
          status: MessageStatus.Sending,
          updatedAt: nowIso,
          sender: MessageSender.Admin,
        },
      },
    });
    setInputValue('');
    virtuosoHandleRef.current?.scrollToIndex({
      index: 0,
      behavior: 'auto'
    })
    inputRef.current?.focus();
  }
  
  return (
    <div className={css.root}>
      <div className={css.container}>
        {isFetchingMore && (
          <div className={css.loadMoreContainer}>
            <span className={css.loader} aria-label="Loading previous messages..." />
          </div>
        )}
        {initialLoading ? (
          <span className={css.bigLoader} aria-label="Loading messages..." />
        ) : (
          <Virtuoso
            ref={virtuosoHandleRef}
            className={css.list}
            // Reverse the data so the newest message remains visually at the bottom
            data={[...(data?.messages.edges ?? [])].reverse().map((edge) => edge.node)}
            computeItemKey={(_i, item) => item.id}
            itemContent={getItem}
            // Invert the scroller so endReached becomes the visual "top" of the list
            style={{ transform: 'scaleY(-1)' }}
            endReached={handleEndReached}
          />
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className={css.footer}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
          className={css.textInput}
          placeholder="Message text"
          ref={inputRef}
        />
        <button type="submit" disabled={initialLoading || inputValue.trim() === ''}>Send</button>
      </form>
    </div>
  );
};
