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

const Item: React.FC<Message> = ({ text, sender }) => {
  return (
    <div className={css.item}>
      <div
        className={cn(
          css.message,
          sender === MessageSender.Admin ? css.out : css.in
        )}
      >
        {text}
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

export const Chat: React.FC = () => {
  const { data, subscribeToMore } = useQuery(gql`
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
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  `);
  const [sendMessage] = useMutation(gql`
    mutation SendMessage($text: String!) {
      sendMessage(text: $text) {
        id
        text
        status
        updatedAt
        sender
      }
    }
  `);
  const [textMsg, setTextMsg] = useState('')
  
  useEffect(() => {
    const unsubscribe = subscribeToMore({
      document: MESSAGE_ADDED_SUBSCRIPTION,
      updateQuery: (prev, { subscriptionData }) => {
        if (!subscriptionData.data) return prev;
        const newMessage = subscriptionData.data.messageAdded;
        const newEdge = { node: newMessage, cursor: newMessage.id };

        const edges = [...prev.messages.edges, newEdge];
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
    return () => unsubscribe();
  }, [subscribeToMore]);
  const virtuosoHandleRef = useRef<VirtuosoHandle>(null);
  return (
    <div className={css.root}>
      <div className={css.container}>
        <Virtuoso ref={virtuosoHandleRef} className={css.list} data={data?.messages.edges.map((edge) => edge.node)} itemContent={getItem} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage({ variables: { text: textMsg } });
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
