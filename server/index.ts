import { ApolloServer } from "@apollo/server";
import { GraphQLScalarType } from "graphql";
import { createServer } from "http";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import express from "express";
import { expressMiddleware } from "@apollo/server/express4";
import bodyParser from "body-parser";
import cors from "cors";
import { PubSub } from "graphql-subscriptions";
import {
  type Message,
  MessageSender,
  MessageStatus,
  type Resolvers,
} from "../__generated__/resolvers-types";
import { delay } from "./delay";

const PORT = 4000;
const SIMULATE_NETWORK_PING_DELAY = 800;
const pubsub = new PubSub();

const MESSAGE_ADDED = "MESSAGE_ADDED";
const MESSAGE_UPDATED = "MESSAGE_UPDATED";

const messages: Message[] = Array.from(Array(150), (_, index) => ({
  id: String(index),
  text: `Message number ${index}`,
  status: MessageStatus.Read,
  updatedAt: new Date().toISOString(),
  sender: index % 2 ? MessageSender.Admin : MessageSender.Customer,
}));

const publishMessage = (index: number, message: Message, status: MessageStatus) => {
  const updatedAt = new Date().toISOString();
  messages[index].status = status;
  messages[index].updatedAt = updatedAt;
  pubsub.publish(MESSAGE_UPDATED, {
    messageUpdated: {
      ...message,
      updatedAt,
      status,
    },
  });
}

const updateMessage = async (message: Message) => {
  const messageIndex = messages.findIndex((m) => m.id === message.id)
  if (messageIndex === -1) return

  await delay(1000);
  publishMessage(messageIndex, message, MessageStatus.Sent)

  await delay(15000);
  publishMessage(messageIndex, message, MessageStatus.Read)
};

const typeDefs = `#graphql
  scalar MessagesCursor

  enum MessageStatus {
    Sending
    Sent
    Read
  }

  enum MessageSender {
    Admin
    Customer
  }

  type Message {
    id: ID!
    text: String!
    status: MessageStatus!
    updatedAt: String!
    sender: MessageSender!
  }

  type MessageEdge {
    node: Message!
    cursor: MessagesCursor!
  }

  type MessagePageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: MessagesCursor
    endCursor: MessagesCursor
  }

  type MessagePage {
    edges: [MessageEdge!]!
    pageInfo: MessagePageInfo!
  }

  type Query {
    messages(first: Int, after: MessagesCursor, before: MessagesCursor): MessagePage!
  }

  type Mutation {
    sendMessage(text: String!): Message!
  }

  type Subscription {
    messageAdded: Message!
    messageUpdated: Message!
  }
`;

const resolvers: Resolvers = {
  Query: {
    messages: (_, { first, after, before }) => {
      // Convert cursors to indexes
      const afterIndex = after
        ? messages.findIndex((msg) => msg.id === after)
        : -1;
      const beforeIndex = before
        ? messages.findIndex((msg) => msg.id === before)
        : messages.length;

      // Filter and paginate the data
      const slicedMessages = messages.slice(afterIndex + 1, beforeIndex);
      const limit = first || 10;
      const startIndex = Math.max(0, slicedMessages.length - limit);
      const paginatedMessages = slicedMessages.slice(startIndex);

      // Create edges
      const edges = paginatedMessages.map((message) => ({
        node: message,
        cursor: message.id,
      }));

      // Calculate pageInfo
      const startCursor = edges.length > 0 ? edges[0].cursor : null;
      const endCursor =
        edges.length > 0 ? edges[edges.length - 1].cursor : null;

      return {
        edges,
        pageInfo: {
          startCursor,
          endCursor,
          hasNextPage: beforeIndex < messages.length,
          hasPreviousPage: startIndex > 0,
        },
      };
    },
  },
  Mutation: {
    sendMessage: async (_, { text }) => {
      const messageAdded = {
        id: `${messages.length + 1}`,
        text,
        status: MessageStatus.Sending,
        updatedAt: new Date().toISOString(),
        sender: MessageSender.Admin,
      };

      messages.push(messageAdded);

      pubsub.publish(MESSAGE_ADDED, { messageAdded });

      updateMessage(messageAdded);

      if (messages.length % 2) {
        // The subscription event will arrive before the mutation response
        await delay(4000);
      }

      return messageAdded;
    },
  },
  Subscription: {
    messageAdded: {
      subscribe: () => pubsub.asyncIterableIterator([MESSAGE_ADDED]),
    },
    messageUpdated: {
      subscribe: () => pubsub.asyncIterableIterator([MESSAGE_UPDATED]),
    },
  },
  MessagesCursor: new GraphQLScalarType({
    name: "MessagesCursor",
    parseValue(value) {
      return value;
    },
    serialize(value) {
      return value;
    },
    parseLiteral(ast) {
      return "value" in ast ? ast.value : null;
    },
  }),
};

// Create schema, which will be used separately by ApolloServer and
// the WebSocket server.
const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create an Express app and HTTP server; we will attach the WebSocket
// server and the ApolloServer to this HTTP server.
const app = express();
const httpServer = createServer(app);


const wsServer = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (request, socket, head) => {
  const url = request.url || "";
  if (url.startsWith("/graphql")) {
    setTimeout(() => {
      wsServer.handleUpgrade(request, socket, head, (ws) => {
        wsServer.emit("connection", ws, request);
      });
    }, SIMULATE_NETWORK_PING_DELAY);
  } else {
    socket.destroy();
  }
});

const serverCleanup = useServer({ schema }, wsServer);

// Set up ApolloServer.
const server = new ApolloServer({
  schema,
  plugins: [
    // Proper shutdown for the HTTP server.
    ApolloServerPluginDrainHttpServer({ httpServer }),

    // Proper shutdown for the WebSocket server.
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});

await server.start();
app.use(
  "/graphql",
  cors<cors.CorsRequest>(),
  bodyParser.json(),
  (req, _res, next) => setTimeout(next, SIMULATE_NETWORK_PING_DELAY),
  expressMiddleware(server)
);

// Now that our HTTP server is fully set up, actually listen.
httpServer.listen(PORT, () => {
  console.log(`🚀 Query endpoint ready at http://localhost:${PORT}/graphql`);
  console.log(
    `🚀 Subscription endpoint ready at ws://localhost:${PORT}/graphql`
  );
});

const asyncReplyMessage = () => {
  const timeout = setTimeout(() => {
    clearTimeout(timeout);
    if (messages[messages.length - 1]?.sender === MessageSender.Admin) {
      const index = messages.length + 1;

      const messageAdded: Message = {
        id: `${index}`,
        text: `Message number ${index}`,
        status: MessageStatus.Sent,
        updatedAt: new Date().toISOString(),
        sender: MessageSender.Customer,
      };

      messages.push(messageAdded)
      pubsub.publish(MESSAGE_ADDED, { messageAdded });
    }

    asyncReplyMessage();
  }, 30000);
};

asyncReplyMessage();
