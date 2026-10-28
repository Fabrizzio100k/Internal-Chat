export type GroupMember = {
  id: string;
  username: string;
  avatar?: string | null;
  role: "ADMIN" | "MEMBER";
};

export type GroupInfo = {
  name: string;
  myRole: "ADMIN" | "MEMBER";
  members: GroupMember[];
};
