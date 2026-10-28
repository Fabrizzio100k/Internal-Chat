export type DeviceSessionItem = {
  id: string;
  deviceName: string;
  deviceType: "desktop" | "mobile" | "tablet";
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  isCurrent: boolean;
};
