import { ApolloClient, HttpLink, split, InMemoryCache } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition, relayStylePagination } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

const PORT = 4000;

const httpLink = new HttpLink({
  uri: (operation) =>
    `http://localhost:${PORT}/graphql?op=${operation.operationName}`,
});

const wsLink = new GraphQLWsLink(
  createClient({
    url: `ws://localhost:${PORT}/graphql`,
  })
);

const link = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === "OperationDefinition" &&
      definition.operation === "subscription"
    );
  },
  wsLink,
  httpLink
);

const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        messages: relayStylePagination(),
      },
    },
  },
});

export const client = new ApolloClient({
  link,
  cache,
});
