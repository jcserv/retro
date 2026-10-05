import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { RoomStore } from "./roomStore";

export const RoomStoreContext = createContext<RoomStore | null>(null);

export function useRoomStore(): RoomStore {
  const store = useContext(RoomStoreContext);
  if (!store) throw new Error("useRoomStore must be used inside a Room page");
  return store;
}
