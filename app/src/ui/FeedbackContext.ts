import { createContext } from "react";
export const FeedbackContext = createContext<{
  error: string;
  clear: () => void;
  retry: (() => void) | null;
  busy: boolean;
}>({ error: "", clear: () => {}, retry: null, busy: false });
