import { gql } from "@apollo/client";

export const MESSAGE_ADDED_SUBSCRIPTION = gql`
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

export const MESSAGE_UPDATED_SUBSCRIPTION = gql`
  subscription OnMessageUpdated {
    messageUpdated {
      id
      status
      updatedAt
    }
  }
`;

export const GET_MESSAGES = gql`
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

export const SEND_MESSAGE_MUTATION = gql`
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