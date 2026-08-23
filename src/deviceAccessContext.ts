import {
  createContext,
  useContext,
} from "react";

import type {
  AuthorizedDevice,
  DeviceAccessRequest,
} from "./deviceAccessFirestore";

export type DeviceAccessContextValue = {
  uid: string;
  device: AuthorizedDevice;
  request: DeviceAccessRequest | null;
  isMemberDevice: boolean;
  requestAdminAccess: () => boolean;
};

export const DeviceAccessContext =
  createContext<
    DeviceAccessContextValue | undefined
  >(undefined);

export function useDeviceAccess() {
  const value =
    useContext(
      DeviceAccessContext
    );

  if (value === undefined) {
    throw new Error(
      "useDeviceAccessはDeviceAccessGateの内側で使用してください。"
    );
  }

  return value;
}
