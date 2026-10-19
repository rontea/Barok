import type { CoderThreadMessage, CoderThreadSummary } from '../components/CoderChatPanel';

/**
 * Agent timelines are presentation history, not input to Coder Chat intent or
 * task analysis. Keep them out of JSON requests and browser storage; the
 * server archives them under the project's .react-engine directory.
 */
export const compactCoderThreadMessage = (message: CoderThreadMessage) => {
  const { agentEvents: _agentEvents, images, content, ...metadata } = message;
  const compactImages = images?.map(({ url: _url, ...image }) => image);
  const compactContent = (typeof content === 'string' ? content : '')
    .replace(/!\[(.*?)\]\(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+\)/g, '[image omitted]')
    .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]');

  return {
    ...metadata,
    content: compactContent,
    ...(compactImages?.length ? { images: compactImages } : {}),
  };
};

export const compactCoderThread = (thread: CoderThreadMessage[]) =>
  thread.map(compactCoderThreadMessage);

export const compactCoderThreadSummary = (thread: CoderThreadSummary): CoderThreadSummary => ({
  ...thread,
  messages: compactCoderThread(thread.messages),
});

export const compactCoderThreadState = <T extends { threads: CoderThreadSummary[] }>(state: T): T => ({
  ...state,
  threads: state.threads.map(compactCoderThreadSummary),
});
