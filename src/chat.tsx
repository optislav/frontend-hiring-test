import React, { useEffect, useRef, useState } from "react";
import { ItemContent, Virtuoso, VirtuosoHandle } from "react-virtuoso";
import cn from "clsx";
import {
  MessageSender,
  MessageStatus,
  type Message,
} from "../__generated__/resolvers-types";
import css from "./chat.module.css";
import { gql, useMutation, useQuery } from "@apollo/client";

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
        <span>{text}</span>
      </div>
    </div>
  );
};

const getItem: ItemContent<Message, unknown> = (_, data) => {
  return <Item {...data} />;
};

const MESSAGE_ADDED_SUBSCRIPTION = gql`
  subscription OnMessageAdded {
    messageAdded {
      id
      text
      status
      updatedAt
      sender
    }
  }
`;

const MESSAGE_UPDATED_SUBSCRIPTION = gql`
  subscription OnMessageUpdated {
    messageUpdated {
      id
      status
      updatedAt
    }
  }
`;

const GET_MESSAGES = gql`
  query GetMessages($first: Int, $after: MessagesCursor, $before: MessagesCursor) {
    messages(first: $first, after: $after, before: $before) {
      edges {
        node {
          id
          text
          status
          updatedAt
          sender
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const SEND_MESSAGE_MUTATION = gql`
  mutation SendMessage($text: String!) {
    sendMessage(text: $text) {
      id
      text
      status
      updatedAt
      sender
      __typename
    }
  }
`;

const PAGE_SIZE = 20;

export const Chat: React.FC = () => {
  
  const { data, subscribeToMore, loading, fetchMore } = useQuery<MessagesQueryData>(
    GET_MESSAGES,
    {
      variables: { first: PAGE_SIZE },
      notifyOnNetworkStatusChange: true,
    }
  );
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  useEffect(() => {
    const unsubscribeAdded = subscribeToMore<MessageAddedData>({
      document: MESSAGE_ADDED_SUBSCRIPTION,
      updateQuery: (prev, { subscriptionData }) => {
        if (!subscriptionData.data) return prev;
        const newMessage = subscriptionData.data.messageAdded;
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
        return {
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
            ? {
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

  const virtuosoHandleRef = useRef<VirtuosoHandle>(null);

  const handleEndReached = async () => {
    // Workaround for Virtuoso startReached https://github.com/petyosi/react-virtuoso/discussions/1177#discussioncomment-11815508
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
        return {
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
  const [textMsg, setTextMsg] = useState('')

  const initialLoading = !data && loading;
  
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
        onSubmit={(e) => {
          e.preventDefault();
          const tempId = `temp-${Math.random().toString(36).slice(2)}`;
          const nowIso = new Date().toISOString();
          sendMessage({
            variables: { text: textMsg },
            optimisticResponse: {
              sendMessage: {
                __typename: "Message",
                id: tempId,
                text: textMsg,
                status: MessageStatus.Sending,
                updatedAt: nowIso,
                sender: MessageSender.Admin,
              },
            },
          });
          setTextMsg('');
          virtuosoHandleRef.current?.scrollToIndex({
            index: 0,
            behavior: 'auto'
          })
        }}
        className={css.footer}
      >
        <input
          type="text"
          value={textMsg}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTextMsg(e.target.value)}
          className={css.textInput}
          placeholder="Message text"
        />
        <button type="submit" disabled={initialLoading || textMsg.trim() === ''}>Send</button>
      </form>
    </div>
  );
};
