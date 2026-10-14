export type GroupMember = { id: string; username: string; role: "ADMIN" | "MEMBER" };

export type GroupInfo = {
  name: string;
  myRole: "ADMIN" | "MEMBER";
  members: GroupMember[];
};
