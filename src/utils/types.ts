import { Room } from '@prisma/client';
import { Context } from 'grammy';

export enum ContentTypeE {
  TEXT = 'TEXT',
  PHOTO = 'PHOTO',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  FILE = 'FILE',
  ANIMATION = 'ANIMATION',
}

export enum TypeTelegramMessageE {
  SINGLE_CHAT = 'SINGLE_CHAT',
  BROADCAST = 'BROADCAST',
  GROUP = 'GROUP',
}

export type TgServiceMessageT = {
  botToken: string;
  chatId: string;
  text?: string;
  fileUrl?: string;
  fileId?: string;
  replyMarkup?: any;
  contentType?: ContentTypeE;
  type?: TypeTelegramMessageE;
};

export type TgServiceEmitArgsT = {
  payload: TgServiceMessageT;
  messageId?: string;
};

export type BotDefaultHandlerArgsT = {
  ctx: Context;
  chatId: number;
  userId: number;
};

export type BotHandlerWrapperT = {
  ctx: Context;
  handler: (args: BotDefaultHandlerArgsT) => Promise<any>;
  middlewares?: (args: BotDefaultHandlerArgsT) => Promise<any>;
  method?: string;
};

export enum BotUserStatusE {
  FREE = 'FREE',
  INPUT_CODE = 'INPUT_CODE',
  INPUT_USERNAME = 'INPUT_USERNAME',
  PARTICIPANT = 'PARTICIPANT',
  INPUT_NEW_ADMIN = 'INPUT_NEW_ADMIN',
  INPUT_NEW_ROOM = 'INPUT_NEW_ROOM',
  DISACTIVATE_ROOM = 'DISACTIVATE_ROOM',
}

export type UserDataStatusT = {
  status: BotUserStatusE | null;
  roomId?: string;
};

export type MessagePayload = Omit<
  TgServiceMessageT,
  'botToken' | 'chatId' | 'type'
>;

export type BotHandlerArgsT = {
  userId: number;
  status: UserDataStatusT;
  payload: MessagePayload;
  sendMessage: (payload: MessagePayload) => void;
};

export type PartlyRoom = Pick<Partial<Room>, 'code' | 'title' | 'description'>;
