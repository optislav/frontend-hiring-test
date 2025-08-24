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
    <div className={css.item}>
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
  query GetMessages {
    messages {
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

const MessagesList = () => {
  const { data, subscribeToMore, loading } = useQuery<MessagesQueryData>(GET_MESSAGES);

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
return (
  <div className={css.container}>
    {loading ? (
      <span className={css.bigLoader} aria-label="Loading messages..." />
    ) : (
      <Virtuoso
        ref={virtuosoHandleRef}
        className={css.list}
        data={data?.messages.edges.map((edge) => edge.node)}
        itemContent={getItem}
        initialScrollTop={Infinity} // TODO: first unread message
      />
    )}
  </div>
)
}

export const Chat: React.FC = () => {
  const [sendMessage] = useMutation(SEND_MESSAGE_MUTATION, {
    update(cache, { data }) {
      if (!data?.sendMessage) return;
      const real = data.sendMessage;
      cache.updateQuery<MessagesQueryData>({ query: GET_MESSAGES }, (prev) => {
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
  
  return (
    <div className={css.root}>
      <MessagesList />
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
        }}
        className={css.footer}
      >
        <input
          type="text"
          value={textMsg}
          onChange={(e) => setTextMsg(e.target.value)}
          className={css.textInput}
          placeholder="Message text"
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
};
