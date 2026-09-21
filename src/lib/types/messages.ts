export const MESSAGES_PAGE_SIZE = 50;

export type AttachmentDTO = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

export type MessageDTO = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: Date;
  sender: { id: string; username: string };
  attachments: AttachmentDTO[];
};

export type ListMessagesResult = {
  messages: MessageDTO[];
  hasMore: boolean;
};


export type SendMessageResult = {
  success: boolean;
  error?: string;
  messageId?: string;
};
